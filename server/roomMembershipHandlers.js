const {
  createSessionState,
  createShareInvite,
  findSessionByShareInvite,
  consumeShareInvite,
  addPlayer,
  removePlayer,
  findPlayerByUserId,
  reservePlayerSlot,
  releasePlayerSlot,
  hasOpenPlayerSlot,
  buildSyncPayload,
} = require('./session');
const { worldAt } = require('./rotation');
const { petStageAt, GROWN_AT_SECONDS } = require('./petLevel');
const {
  parseCreateSession,
  parseShareInvite,
  parseJoinSession,
} = require('./payloadParsers');
const { correlationRef } = require('./observability');

function registerRoomMembershipHandlers({
  socket,
  io,
  onPayload,
  sessions,
  socketToSession,
  getSession,
  leaveSession,
  canJoinSession,
  cancelPendingDisconnect,
  totalFocusSeconds,
  setPresence,
  isShuttingDown = () => false,
  createSessionRateLimit,
  shareInviteRateLimit,
  joinSessionRateLimit,
  metrics,
  logger,
  currentWorld = worldAt,
}) {
  const stageForTotal = (seconds) => (
    seconds === null ? 'grown' : petStageAt(seconds)
  );
  const cachedFocus = (seconds) => (
    seconds === null ? GROWN_AT_SECONDS : seconds
  );
  const reportJoinRejection = (reason, sessionId = null, userId = null) => {
    metrics.increment('session_join_rejections_total');
    logger.warn('session_join_rejected', {
      reason,
      room_ref: correlationRef('room', sessionId),
      account_ref: correlationRef('account', userId),
    });
  };

  // create_session: { avatar, displayName, pet }
  // The rotating world and pet stage are server-owned even if older clients
  // still include world or petStage fields in their payloads.
  onPayload(socket, 'create_session', async (payload) => {
    if (!createSessionRateLimit(socket.id)) {
      socket.emit('session_error', { message: 'Too many requests, slow down' });
      return;
    }
    const parsed = parseCreateSession(payload);
    if (!parsed.ok) {
      socket.emit('session_error', { message: 'Invalid avatar' });
      return;
    }
    const { avatar, displayName, pet } = parsed.value;
    const safeWorld = currentWorld();

    const prevSession = socketToSession[socket.id];
    if (prevSession) leaveSession(socket, prevSession);

    const userId = socket.userId || null;
    const focusSeconds = await totalFocusSeconds(userId);
    if (isShuttingDown()) return;
    const session = createSessionState(safeWorld, socket.id);
    const sessionId = session.id;
    sessions[sessionId] = session;

    socket.join(sessionId);
    socketToSession[socket.id] = sessionId;
    addPlayer(session, socket.id, {
      avatar,
      displayName,
      userId,
      pet,
      petStage: pet ? stageForTotal(focusSeconds) : null,
      focusSeconds: cachedFocus(focusSeconds),
    });

    if (userId) setPresence(userId, sessionId, safeWorld);

    metrics.increment('sessions_created_total');
    logger.info('session_created', {
      room_ref: correlationRef('room', sessionId),
      world: safeWorld,
    });

    socket.emit('session_created', { sessionId });
    socket.emit('sync_state', buildSyncPayload(session));
  });

  // create_share_invite: { sessionId }, acknowledgement: { ok, token, expiresAt }
  onPayload(socket, 'create_share_invite', (payload, respond) => {
    const reply = typeof respond === 'function' ? respond : () => {};
    if (!shareInviteRateLimit(socket.id)) {
      reply({ ok: false, message: 'Too many requests, slow down' });
      return;
    }
    const parsed = parseShareInvite(payload);
    if (!parsed.ok) {
      reply({ ok: false, message: 'Invalid session ID' });
      return;
    }
    const { sessionId } = parsed.value;
    const session = getSession(sessionId);
    if (!session) {
      reply({ ok: false, message: 'Session not found' });
      return;
    }
    if (!session.players[socket.id]) {
      reply({ ok: false, message: 'You are not in this session' });
      return;
    }
    if (!hasOpenPlayerSlot(session)) {
      reply({ ok: false, message: 'Session is full' });
      return;
    }

    const invite = createShareInvite(session);
    reply({ ok: true, token: invite.token, expiresAt: invite.expiresAt });
  }, {
    errorEvent: null,
    onInvalid: (respond) => {
      if (typeof respond === 'function') {
        respond({ ok: false, message: 'Invalid request' });
      }
    },
  });

  // join_session: { sessionId | shareToken, avatar, displayName, pet }
  // Authorization, seat reservation, and bearer-token consumption must all
  // finish before the focus-total read yields to a competing join.
  onPayload(socket, 'join_session', async (payload) => {
    const userId = socket.userId || null;
    const requestedSessionId = payload.sessionId;
    if (!joinSessionRateLimit(socket.id)) {
      socket.emit('session_error', { message: 'Too many requests, slow down' });
      reportJoinRejection('rate_limited', requestedSessionId, userId);
      return;
    }
    const parsed = parseJoinSession(payload);
    if (!parsed.ok) {
      const invalidShareToken = parsed.reason === 'share_token';
      const invalidSessionId = parsed.reason === 'session_id';
      socket.emit('session_error', {
        message: invalidShareToken
          ? 'Invite link is invalid or expired'
          : invalidSessionId ? 'Invalid session ID' : 'Invalid avatar',
      });
      reportJoinRejection(
        invalidShareToken
          ? 'invalid_share_token'
          : invalidSessionId ? 'invalid_session_id' : 'invalid_avatar',
        invalidShareToken || invalidSessionId ? null : requestedSessionId,
        userId,
      );
      return;
    }
    const {
      sessionId: parsedSessionId,
      shareToken,
      joiningByLink,
      avatar,
      displayName,
      pet,
    } = parsed.value;

    let session;
    let sessionId;
    if (joiningByLink) {
      session = findSessionByShareInvite(sessions, shareToken);
      sessionId = session?.id;
    } else {
      sessionId = parsedSessionId;
      session = getSession(sessionId);
    }
    if (!session) {
      socket.emit('session_error', {
        message: joiningByLink ? 'Invite link is invalid or expired' : 'Session not found',
      });
      reportJoinRejection(
        joiningByLink ? 'share_invite_not_found' : 'session_not_found',
        sessionId,
        userId,
      );
      return;
    }

    // A refused join must not eject the caller from the room they already hold.
    if (!joiningByLink && !(await canJoinSession(session, userId))) {
      socket.emit('session_error', { message: 'This session is private' });
      reportJoinRejection('private', sessionId, userId);
      return;
    }
    if (isShuttingDown()) return;

    // Reserve synchronously before the focus read. Existing users bypass the
    // new-seat count so reconnecting to a full room remains valid.
    const slot = reservePlayerSlot(session, userId);
    if (!slot.ok) {
      socket.emit('session_error', { message: 'Session is full' });
      reportJoinRejection('full', sessionId, userId);
      return;
    }

    // Claim a bearer invite in the same synchronous section as its seat.
    if (joiningByLink && slot.reserved && !consumeShareInvite(session, shareToken)) {
      releasePlayerSlot(session, userId);
      socket.emit('session_error', { message: 'Invite link is invalid or expired' });
      reportJoinRejection('share_invite_consumed', sessionId, userId);
      return;
    }

    try {
      const focusSeconds = await totalFocusSeconds(userId);
      if (isShuttingDown()) return;
      const petStage = pet ? stageForTotal(focusSeconds) : null;

      // The room may have closed while the database request was in flight.
      if (getSession(sessionId) !== session) {
        socket.emit('session_error', { message: 'Session not found' });
        reportJoinRejection('session_closed_during_join', sessionId, userId);
        return;
      }

      // Only move rooms after admission is authorized and a seat is held.
      const prevSession = socketToSession[socket.id];
      if (prevSession && prevSession !== sessionId) leaveSession(socket, prevSession);

      // Replace the freshest socket for this verified user after the await.
      const oldSocketId = userId ? findPlayerByUserId(session, userId) : null;
      if (oldSocketId && oldSocketId !== socket.id) {
        cancelPendingDisconnect(oldSocketId);
        removePlayer(session, oldSocketId);
        delete socketToSession[oldSocketId];
        io.sockets.sockets.get(oldSocketId)?.leave(sessionId);
        if (session.hostId === oldSocketId) session.hostId = socket.id;
        socket.to(sessionId).emit('player_left', { playerId: oldSocketId });
        metrics.increment('session_reconnects_total');
        logger.info('session_player_reconnected', {
          room_ref: correlationRef('room', sessionId),
          account_ref: correlationRef('account', userId),
          socket_ref: correlationRef('socket', socket.id),
        });
      }

      socket.join(sessionId);
      socketToSession[socket.id] = sessionId;
      const playerCount = addPlayer(session, socket.id, {
        avatar,
        displayName,
        userId,
        pet,
        petStage,
        focusSeconds: cachedFocus(focusSeconds),
      });

      if (userId) setPresence(userId, sessionId, session.world);
      logger.info('session_player_joined', {
        room_ref: correlationRef('room', sessionId),
        socket_ref: correlationRef('socket', socket.id),
        player_count: playerCount,
      });

      socket.to(sessionId).emit('player_joined', {
        playerId: socket.id,
        avatar,
        displayName,
        pet,
        petStage,
      });
      socket.emit('sync_state', buildSyncPayload(session));
    } finally {
      if (slot.reserved) releasePlayerSlot(session, userId);
    }
  });
}

module.exports = { registerRoomMembershipHandlers };
