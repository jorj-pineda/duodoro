const { deleteAccountData } = require('./accountDeletion');
const { parseDeleteAccount } = require('./payloadParsers');
const { correlationRef, safeErrorFields } = require('./observability');

function registerAccountHandlers({
  socket,
  io,
  onPayload,
  supabase,
  presence,
  broadcastPresence,
  removeUserFromLiveSessions,
  prepareAccountDeletion = async () => ({ commit() {}, abort() {} }),
  metrics,
  logger,
  deleteAccount = deleteAccountData,
  schedule = setImmediate,
}) {
  // Identity always comes from auth middleware, never from an event payload.
  socket.on('register_user', () => {
    const userId = socket.userId;
    if (!userId) return;
    const cameOnline = presence.add(userId, socket.id);
    if (cameOnline) broadcastPresence(userId, true);
    logger.info('presence_registered', {
      account_ref: correlationRef('account', userId),
      socket_ref: correlationRef('socket', socket.id),
      came_online: cameOnline,
    });
  });

  onPayload(socket, 'delete_account', async (payload, respond) => {
    if (typeof respond !== 'function') return;
    const parsed = parseDeleteAccount(payload);
    if (!parsed.ok) {
      respond({ ok: false, message: 'Type DELETE to confirm' });
      return;
    }
    if (!socket.userId || socket.accountDeletionPending) {
      respond({ ok: false, message: 'Account deletion is unavailable' });
      return;
    }

    socket.accountDeletionPending = true;
    const userId = socket.userId;
    let prepared;
    try {
      prepared = await prepareAccountDeletion(userId);
      await deleteAccount(supabase, {
        userId,
        email: socket.userEmail,
      });
    } catch (error) {
      prepared?.abort();
      socket.accountDeletionPending = false;
      metrics.increment('account_deletion_failures_total');
      logger.error('account_deletion_failed', {
        account_ref: correlationRef('account', userId),
        ...safeErrorFields(error),
      });
      respond({
        ok: false,
        message: prepared
          ? 'Account deletion could not be confirmed. Please retry before starting another focus session.'
          : 'Could not delete your account. Please try again.',
      });
      return;
    }

    prepared.commit();
    try {
      removeUserFromLiveSessions(userId);
    } catch (error) {
      logger.error('account_deletion_cleanup_failed', safeErrorFields(error));
    }
    respond({ ok: true });

    // Let the acknowledgement reach the requester before terminating every
    // socket for this now-deleted verified account.
    schedule(() => {
      for (const client of io.sockets.sockets.values()) {
        if (client.userId === userId) client.disconnect(true);
      }
    });
  }, {
    errorEvent: null,
    onInvalid: (respond) => {
      if (typeof respond === 'function') {
        respond({ ok: false, message: 'Invalid deletion request' });
      }
    },
  });
}

module.exports = { registerAccountHandlers };
