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
  const unconfirmedUsers = new Set();
  let replayPromise = null;

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

  async function save(payload) {
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

  function replay() {
    if (!queue || !supabase || isStopping()) return Promise.resolve();
    if (replayPromise) return replayPromise;
    replayPromise = (async () => {
      try {
        for await (const payload of queue.entries()) {
          if (isStopping()) break;
          const key = payload.p_recording_key;
          if (active.has(key)) continue;
          active.add(key);
          try {
            const result = await recordFocusSession(supabase, payload, { observe });
            await queue.remove(key);
            metrics.increment('focus_replay_success_total');
            logger.info('focus_replay_completed', {
              room_ref: correlationRef('room', payload.p_room_code),
              outcome: result.inserted ? 'inserted' : 'idempotent',
            });
            onReplaySaved(payload, result);
            await refreshStatuses(payload.p_user_ids);
          } catch (error) {
            metrics.increment('focus_replay_failures_total');
            logger.error('focus_replay_failed', {
              room_ref: correlationRef('room', payload.p_room_code),
              ...safeErrorFields(error),
            });
          } finally {
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

  async function discardForUser(userId) {
    if (!queue) return 0;
    const removed = await queue.removeForUser(userId);
    if (removed) {
      metrics.increment('focus_queue_discarded_total', removed);
      logger.warn('focus_queue_discarded_for_deletion', { count: removed });
    }
    return removed;
  }

  return {
    save,
    replay,
    drain: () => replayPromise || Promise.resolve(),
    statusForUser,
    discardForUser,
  };
}

module.exports = { createFocusRecovery };
