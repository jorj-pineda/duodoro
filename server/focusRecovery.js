const { recordFocusSession } = require('./focusRecorder');
const { correlationRef, safeErrorFields } = require('./observability');

function createFocusRecovery({
  supabase,
  queue = null,
  observe = () => {},
  logger,
  metrics,
  onStatus = () => {},
  onReplaySaved = () => {},
  isStopping = () => false,
}) {
  const active = new Set();
  const inFlightSaves = new Set();
  const deletingUsers = new Set();
  const unconfirmedUsers = new Set();
  let replayPromise = null;
  let activeReplay = null;

  async function statusForUser(userId) {
    if (!queue) return unconfirmedUsers.has(userId) ? 'unconfirmed' : 'clear';
    try {
      if (await queue.hasForUser(userId)) return 'pending';
      return unconfirmedUsers.has(userId) ? 'unconfirmed' : 'clear';
    } catch (error) {
      logger.error('focus_queue_status_failed', safeErrorFields(error));
      return 'unknown';
    }
  }

  async function refreshStatuses(userIds) {
    for (const userId of userIds) {
      onStatus(userId, await statusForUser(userId));
    }
  }

  async function saveOnce(payload) {
    const key = payload.p_recording_key;
    active.add(key);
    let queued = false;
    try {
      if (queue) {
        try {
          await queue.put(payload);
          queued = true;
        } catch (error) {
          metrics.increment('focus_queue_write_failures_total');
          logger.error('focus_queue_write_failed', {
            room_ref: correlationRef('room', payload.p_room_code),
            ...safeErrorFields(error),
          });
        }
      }

      let result;
      try {
        result = await recordFocusSession(supabase, payload, { observe });
      } catch (error) {
        // The queue may recover while Supabase's three attempts run. Make one
        // final durability attempt before reporting an unconfirmed write.
        if (queue && !queued) {
          try {
            await queue.put(payload);
            queued = true;
          } catch (queueError) {
            metrics.increment('focus_queue_write_failures_total');
            logger.error('focus_queue_write_failed', {
              room_ref: correlationRef('room', payload.p_room_code),
              ...safeErrorFields(queueError),
            });
          }
        }
        if (!queued) {
          for (const userId of payload.p_user_ids) {
            unconfirmedUsers.add(userId);
            onStatus(userId, 'unconfirmed');
          }
          throw error;
        }
        metrics.increment('focus_record_deferred_total');
        logger.warn('focus_record_deferred', {
          room_ref: correlationRef('room', payload.p_room_code),
          ...safeErrorFields(error),
        });
        for (const userId of payload.p_user_ids) onStatus(userId, 'pending');
        return { state: 'pending' };
      }

      if (queued) {
        try {
          await queue.remove(key);
        } catch (error) {
          // The database has confirmed the save. An undeleted queue item is
          // harmless: replay will get the idempotent result and remove it.
          metrics.increment('focus_queue_remove_failures_total');
          logger.error('focus_queue_remove_failed', {
            room_ref: correlationRef('room', payload.p_room_code),
            ...safeErrorFields(error),
          });
        }
        await refreshStatuses(payload.p_user_ids);
      }
      return { state: 'saved', result };
    } finally {
      active.delete(key);
    }
  }

  async function save(payload) {
    if (payload.p_user_ids.some((userId) => deletingUsers.has(userId))) {
      return { state: 'discarded' };
    }
    const operation = saveOnce(payload);
    inFlightSaves.add(operation);
    try {
      return await operation;
    } finally {
      inFlightSaves.delete(operation);
    }
  }

  function replay() {
    if (!queue || !supabase || isStopping()) return Promise.resolve();
    if (replayPromise) return replayPromise;
    replayPromise = (async () => {
      try {
        for await (const payload of queue.entries()) {
          if (isStopping()) break;
          if (payload.p_user_ids.some((userId) => deletingUsers.has(userId))) continue;
          const key = payload.p_recording_key;
          if (active.has(key)) continue;
          active.add(key);
          const operation = (async () => {
            const result = await recordFocusSession(supabase, payload, { observe });
            await queue.remove(key);
            metrics.increment('focus_replay_success_total');
            logger.info('focus_replay_completed', {
              room_ref: correlationRef('room', payload.p_room_code),
              outcome: result.inserted ? 'inserted' : 'idempotent',
            });
            onReplaySaved(payload, result);
            await refreshStatuses(payload.p_user_ids);
          })();
          activeReplay = { userIds: payload.p_user_ids, operation };
          try {
            await operation;
          } catch (error) {
            metrics.increment('focus_replay_failures_total');
            logger.error('focus_replay_failed', {
              room_ref: correlationRef('room', payload.p_room_code),
              ...safeErrorFields(error),
            });
          } finally {
            activeReplay = null;
            active.delete(key);
          }
        }
      } catch (error) {
        metrics.increment('focus_queue_read_failures_total');
        logger.error('focus_queue_read_failed', safeErrorFields(error));
      }
    })().finally(() => { replayPromise = null; });
    return replayPromise;
  }

  async function prepareAccountDeletion(userId) {
    if (deletingUsers.has(userId)) throw new Error('Account deletion already in progress');
    deletingUsers.add(userId);
    const removed = [];
    try {
      await Promise.allSettled([...inFlightSaves]);
      if (activeReplay?.userIds.includes(userId)) {
        await Promise.allSettled([activeReplay.operation]);
      }
      if (queue) {
        for await (const payload of queue.entries()) {
          if (payload.p_user_ids.includes(userId)) removed.push(payload);
        }
        for (const payload of removed) await queue.remove(payload.p_recording_key);
      }
    } catch (error) {
      await Promise.allSettled(removed.map((payload) => queue.put(payload)));
      deletingUsers.delete(userId);
      throw error;
    }

    return {
      commit() {
        if (removed.length) {
          metrics.increment('focus_queue_discarded_total', removed.length);
          logger.warn('focus_queue_discarded_for_deletion', { count: removed.length });
          const affected = new Set();
          for (const payload of removed) {
            for (const participantId of payload.p_user_ids) {
              if (participantId === userId) continue;
              unconfirmedUsers.add(participantId);
              affected.add(participantId);
            }
          }
          void refreshStatuses(affected);
        }
      },
      async rollback() {
        try {
          if (queue) {
            for (const payload of removed) await queue.put(payload);
          }
        } finally {
          deletingUsers.delete(userId);
        }
      },
    };
  }

  return {
    save,
    replay,
    drain: () => replayPromise || Promise.resolve(),
    statusForUser,
    prepareAccountDeletion,
  };
}

module.exports = { createFocusRecovery };
