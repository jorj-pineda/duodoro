const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const { createPresenceRegistry } = require('./presence');
const {
  beginFocusRound,
  removePlayer,
  creditFocusRound,
  isInvited,
  findPlayerByUserId,
  releasePlayerSlot,
  markPlayerDisconnected,
  sessionParticipantIds,
  findUserSessions,
  buildSyncPayload,
} = require('./session');
const { fetchTotalFocusSeconds } = require('./focusTotal');
const { createFocusRecovery } = require('./focusRecovery');
const { isPayloadObject, safeSocketHandler } = require('./socketProtocol');
const {
  correlationRef,
  createLogger,
  createMetrics,
  createRpcObserver,
  safeErrorFields,
} = require('./observability');
const { createReadinessChecker } = require('./readiness');
const { fetchFriendIds } = require('./friendLookup');
const { registerAccountHandlers } = require('./accountHandlers');
const { registerSocialHandlers } = require('./socialHandlers');
const { registerPhasePetHandlers } = require('./phasePetHandlers');
const { registerRoomMembershipHandlers } = require('./roomMembershipHandlers');

/** @typedef {import('../shared/socketContract').ClientToServerEvents} ClientToServerEvents */
/** @typedef {import('../shared/socketContract').ServerToClientEvents} ServerToClientEvents */

function createRealtimeApp({
  supabase = null,
  allowedOrigins = ['http://localhost:3000'],
  reconnectGraceMs = 60_000,
  focusQueue = null,
  replayIntervalMs = 30_000,
  logger = createLogger(),
  metrics = createMetrics({ logger }),
} = {}) {
const observeRpc = createRpcObserver({ logger, metrics });

const checkReadiness = createReadinessChecker(supabase, {
  observe: ({ outcome, durationMs, error }) => {
    metrics.increment(`database_readiness_${outcome}_total`);
    metrics.observeDuration('database_readiness_duration_ms', durationMs);
    const fields = {
      dependency: 'database',
      outcome,
      duration_ms: Math.max(0, Math.round(durationMs)),
      ...safeErrorFields(error),
    };
    logger[outcome === 'success' ? 'info' : 'error'](
      'database_readiness_probe',
      fields,
    );
  },
});

const app = express();
let stopping = false;

app.use(cors({ origin: allowedOrigins }));
app.use(helmet());
app.get('/', (_, res) => res.json({ status: 'Duodoro server running', ok: true }));
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/ready', async (_, res) => {
  const result = await checkReadiness();
  res.status(result.ok ? 200 : 503).json(result);
});

const server = http.createServer(app);
/** @type {Server<ClientToServerEvents, ServerToClientEvents>} */
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e5, // 100KB max payload
});

// ── Auth middleware — verify Supabase JWT on every connection ─────────────

// Completed focus seconds for one user, the input to petStageAt(). The read
// itself lives in ./focusTotal so it can be faked in a test; a failed read
// returns null so the caller can keep the current look (grown) rather than
// shrinking everyone to young — a zero and a failure must not render the
// same way.
function totalFocusSeconds(userId) {
  return fetchTotalFocusSeconds(supabase, userId, { observe: observeRpc });
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    metrics.increment('unauthenticated_connections_total');
    logger.info('authentication_not_started', {
      socket_ref: correlationRef('socket', socket.id),
      reason: 'missing_token',
    });
    return next(new Error('Authentication required'));
  }
  if (!supabase) {
    // If Supabase isn't configured, skip JWT verification (dev mode) — but
    // still decode the unverified sub claim so userId-keyed features
    // (presence, reconnect grace) behave like production locally
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      if (typeof payload?.sub === 'string') socket.userId = payload.sub;
    } catch { /* not a JWT — stay anonymous */ }
    logger.warn('authentication_skipped', { mode: 'development' });
    return next();
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      metrics.increment('authentication_rejections_total');
      logger.warn('authentication_rejected', {
        socket_ref: correlationRef('socket', socket.id),
        reason: 'invalid_or_expired',
        ...safeErrorFields(error),
      });
      return next(new Error('Invalid or expired token'));
    }
    socket.userId = user.id;
    socket.userEmail = user.email || null;
    next();
  } catch (err) {
    metrics.increment('authentication_failures_total');
    logger.error('authentication_failed', {
      socket_ref: correlationRef('socket', socket.id),
      ...safeErrorFields(err),
    });
    return next(new Error('Authentication failed'));
  }
});

// sessions[sessionId] = {
//   phase, focusDuration, breakDuration, phaseStartTime, phaseTimer,
//   world, hostId (socketId),
//   players: { [socketId]: { avatar, displayName, userId, pet, petStage } }
// }
const sessions = {};
const socketToSession = {};

// Presence: which users have the app open. Keyed by user with a set of
// sockets, so extra tabs don't evict each other — see presence.js.
const presence = createPresenceRegistry();

// ── Simple per-socket rate limiter ───────────────────────────────────────────
function createRateLimiter(maxPerWindow, windowMs) {
  const counters = new Map(); // socketId -> { count, resetAt }
  const check = (socketId) => {
    const now = Date.now();
    const entry = counters.get(socketId);
    if (!entry || now > entry.resetAt) {
      counters.set(socketId, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= maxPerWindow;
  };
  check.clear = (socketId) => counters.delete(socketId);
  return check;
}

const rateLimits = {
  createSession: createRateLimiter(5, 60_000),   // 5 per minute
  joinSession:   createRateLimiter(10, 60_000),   // 10 per minute
  sendInvite:    createRateLimiter(10, 60_000),   // 10 per minute
  shareInvite:   createRateLimiter(10, 60_000),   // 10 per minute
};

// Register a client-originated event behind one runtime boundary. Socket.IO
// clients are not limited to this repository's TypeScript shapes: they can
// send null, arrays, primitives, or malformed objects. Check the container
// before a handler reads a field, and contain both synchronous exceptions and
// rejected promises so one bad client event cannot take down the process.
function onPayload(socket, event, handler, options = {}) {
  const {
    errorEvent = 'session_error',
    invalidMessage = 'Invalid request',
    onInvalid = null,
  } = options;

  const reportError = (error) => {
    metrics.increment('protocol_handler_failures_total');
    logger.error('protocol_handler_failed', {
      protocol_event: event,
      socket_ref: correlationRef('socket', socket.id),
      ...safeErrorFields(error),
    });
    if (errorEvent) socket.emit(errorEvent, { message: 'Request failed' });
  };

  socket.on(event, safeSocketHandler((payload, ...args) => {
    if (stopping) return;
    if (!isPayloadObject(payload)) {
      metrics.increment('protocol_payload_rejections_total');
      logger.warn('protocol_payload_rejected', {
        protocol_event: event,
        socket_ref: correlationRef('socket', socket.id),
        reason: 'non_object',
      });
      if (onInvalid) onInvalid(...args);
      else if (errorEvent) socket.emit(errorEvent, { message: invalidMessage });
      return;
    }
    return handler(payload, ...args);
  }, reportError));
}

function getSession(sessionId) {
  return sessions[sessionId];
}

// ── Supabase Presence Helpers ──────────────────────────────────────────────

async function setPresence(userId, sessionId, worldId) {
  if (!supabase || !userId) return;
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ current_session_id: sessionId, current_world_id: worldId, current_room: sessionId })
      .eq('id', userId);
    if (!error) return;
    throw error;
  } catch (error) {
    metrics.increment('presence_write_failures_total');
    logger.warn('presence_write_failed', {
      operation: 'set',
      account_ref: correlationRef('account', userId),
      room_ref: correlationRef('room', sessionId),
      ...safeErrorFields(error),
    });
  }
}

async function clearPresence(userId) {
  if (!supabase || !userId) return;
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ current_session_id: null, current_world_id: null, current_room: null })
      .eq('id', userId);
    if (!error) return;
    throw error;
  } catch (error) {
    metrics.increment('presence_write_failures_total');
    logger.warn('presence_write_failed', {
      operation: 'clear',
      account_ref: correlationRef('account', userId),
      ...safeErrorFields(error),
    });
  }
}

// ── Presence Helpers ──────────────────────────────────────────────────────

async function getFriendIds(userId) {
  if (!supabase) return [];
  try {
    return await fetchFriendIds(supabase, userId);
  } catch (error) {
    metrics.increment('friend_read_failures_total');
    logger.warn('friend_read_failed', {
      account_ref: correlationRef('account', userId),
      ...safeErrorFields(error),
    });
    return [];
  }
}

// Dev mode (no Supabase) has no friendship data at all; treat everyone as
// friends there so local development isn't blocked by an unanswerable check.
async function areFriends(userId, otherUserId) {
  if (!supabase) return true;
  if (!userId || !otherUserId) return false;
  if (userId === otherUserId) return true;
  const friendIds = await getFriendIds(userId);
  return friendIds.includes(otherUserId.toLowerCase());
}

// Knowing a session UUID must not be enough to walk into it. Session ids leak
// easily — profiles.current_session_id is readable by anyone the DB lets read
// the row, and ids travel through invites and client state.
async function canJoinSession(session, userId) {
  if (!supabase) return true;                            // dev mode, see areFriends
  if (!userId) return false;
  if (findPlayerByUserId(session, userId)) return true;  // reconnecting to own slot
  if (isInvited(session, userId)) return true;           // explicitly invited
  // Otherwise you must already know someone in there — this is what keeps the
  // "join" button on a friend's presence card working without an invite.
  const friendIds = new Set(await getFriendIds(userId));
  return sessionParticipantIds(session).some((id) => friendIds.has(id));
}

function broadcastPresence(userId, online) {
  getFriendIds(userId).then(friendIds => {
    for (const fid of friendIds) {
      // Every tab the friend has open, not just their most recent one
      for (const fSocketId of presence.socketsFor(fid)) {
        io.to(fSocketId).emit('presence_update', { userId, online });
      }
    }
  });
}

// ── Session Recording ──────────────────────────────────────────────────────

// Fire-and-forget phase transitions still need a handle during deployment.
// Shutdown drains this set before exiting, within the process-wide deadline.
const pendingRecordings = new Set();
const recovery = createFocusRecovery({
  supabase,
  queue: focusQueue,
  observe: observeRpc,
  logger,
  metrics,
  isStopping: () => stopping,
  onStatus: (userId, state) => {
    for (const socketId of presence.socketsFor(userId)) {
      io.to(socketId).emit('focus_save_status', { state });
    }
  },
  onReplaySaved: (payload) => {
    const session = sessions[payload.p_room_code];
    if (!payload.p_completed || session?.focusRoundId !== payload.p_recording_key) return;
    for (const update of creditFocusRound(
      session,
      payload.p_recording_key,
      payload.p_user_ids,
      payload.p_actual_focus,
    )) {
      io.to(payload.p_room_code).emit('pet_changed', update);
    }
  },
});

// participantIds lets callers pass a snapshot taken *before* they mutate
// session.players — the abandoned-session path records the last player leaving,
// by which point they're already gone from the live map.
async function recordSession(sessionId, session, completed, participantIds) {
  if (!supabase) return;

  // Snapshot every input before the first await. The live session may advance,
  // restart, lose a player, or be deleted while the database request is in
  // flight; none of those changes may rewrite the event being persisted.
  const recordingKey = session.focusRoundId;
  const startedAt = session.phaseStartTime;
  const elapsed = startedAt
    ? Math.round((Date.now() - startedAt) / 1000)
    : 0;
  // In flow mode focusDuration is only a safety cap, never the real length —
  // the elapsed time is the actual focus, whether it completed or not.
  const actualFocus = (completed && session.mode !== 'flow')
    ? session.focusDuration
    : Math.max(0, Math.min(elapsed, session.focusDuration));

  const userIds = participantIds ?? sessionParticipantIds(session);

  if (userIds.length === 0) return;
  if (!recordingKey || !startedAt) {
    metrics.increment('focus_record_failures_total');
    logger.error('focus_record_rejected', {
      room_ref: correlationRef('room', sessionId),
      reason: 'missing_round_state',
    });
    return;
  }

  try {
    const outcome = await recovery.save({
      p_recording_key: recordingKey,
      p_room_code: sessionId,
      p_world: session.world,
      p_focus_duration: session.focusDuration,
      p_break_duration: session.breakDuration,
      p_actual_focus: actualFocus,
      p_completed: completed,
      p_started_at: new Date(startedAt).toISOString(),
      p_user_ids: userIds,
    });

    if (outcome.state === 'pending') return;
    const { result } = outcome;

    metrics.increment('focus_record_success_total');
    logger.info('focus_record_completed', {
      room_ref: correlationRef('room', sessionId),
      outcome: result.inserted ? 'inserted' : 'idempotent',
      actual_focus_seconds: actualFocus,
      completed,
      participant_count: userIds.length,
    });

    // Only completed rows feed get_focus_stats, so only those grow the pet.
    // Credit the in-memory total rather than re-querying: the row was just
    // written, and a replica lag would otherwise delay the growth by a round.
    // The round key makes this safe when a lost response turns a retry into
    // result.inserted=false even though the original write succeeded.
    if (completed && sessions[sessionId] === session) {
      for (const update of creditFocusRound(
        session,
        recordingKey,
        userIds,
        actualFocus,
      )) {
        io.to(sessionId).emit('pet_changed', update);
      }
    }
  } catch (err) {
    metrics.increment('focus_record_failures_total');
    logger.error('focus_record_failed', {
      room_ref: correlationRef('room', sessionId),
      ...safeErrorFields(err),
    });
  }
}

function queueSessionRecording(sessionId, session, completed, participantIds) {
  const pending = recordSession(sessionId, session, completed, participantIds);
  pendingRecordings.add(pending);
  pending.finally(() => pendingRecordings.delete(pending));
  return pending;
}

async function drainPendingRecordings() {
  await Promise.allSettled([...pendingRecordings]);
}

// ── Phase Advance ──────────────────────────────────────────────────────────

function advancePhase(sessionId) {
  const session = getSession(sessionId);
  if (!session) return;

  if (session.phaseTimer) {
    clearTimeout(session.phaseTimer);
    session.phaseTimer = null;
  }

  const CELEBRATION_MS = 4000;
  const RETURNING_MS = 3500;

  let nextPhase;
  let delay;

  switch (session.phase) {
    case 'focus':
      nextPhase = 'celebration';
      delay = CELEBRATION_MS;
      queueSessionRecording(sessionId, session, true);
      break;
    case 'celebration':
      nextPhase = 'break';
      delay = session.breakDuration * 1000;
      break;
    case 'break':
      nextPhase = 'returning';
      delay = RETURNING_MS;
      break;
    case 'returning':
      nextPhase = 'focus';
      delay = session.focusDuration * 1000;
      break;
    default:
      return;
  }

  if (nextPhase === 'focus') {
    beginFocusRound(session);
  } else {
    session.phase = nextPhase;
    session.phaseStartTime = Date.now();
  }

  io.to(sessionId).emit('phase_change', {
    mode: session.mode,
    phase: nextPhase,
    phaseStartTime: session.phaseStartTime,
    focusDuration: session.focusDuration,
    breakDuration: session.breakDuration,
  });

  logger.info('session_phase_changed', {
    room_ref: correlationRef('room', sessionId),
    phase: nextPhase,
  });

  // Flow focus is open-ended and ends only when a player emits
  // finish_flow_focus — same as the initial start_session, which also skips
  // the timer for flow. Scheduling one here is what made rounds 2+ silently
  // auto-complete while the UI still offered a "take break" button.
  if (session.mode === 'flow' && nextPhase === 'focus') {
    session.phaseTimer = null;
    return;
  }

  session.phaseTimer = setTimeout(() => advancePhase(sessionId), delay);
}

// ── Leave Session / Reconnect Grace ────────────────────────────────────────

// A dropped socket doesn't eject the player immediately: authenticated players
// get a grace window to reconnect (tab refresh, flaky Wi-Fi, mobile tab sleep)
// before their spot — and a solo session's timer — is torn down.
const RECONNECT_GRACE_MS = reconnectGraceMs;

// Keyed by the *dropped socket id*, not userId. socketToSession is per-socket,
// so a second tab joins a second session without leaving the first, and one
// user can legitimately hold a slot in two sessions. Keying by userId would let
// the second drop cancel the first one's timer, orphaning a player slot whose
// session then never gets deleted — its phase chain runs forever, re-recording
// completed focus on every cycle. Per-socket timers finalize independently.
const pendingDisconnects = new Map(); // socketId -> timer

function cancelPendingDisconnect(socketId) {
  const timer = pendingDisconnects.get(socketId);
  if (!timer) return;
  clearTimeout(timer);
  pendingDisconnects.delete(socketId);
}

function finalizePlayerRemoval(sessionId, socketId) {
  const session = getSession(sessionId);
  if (!session || !session.players[socketId]) return;

  const player = session.players[socketId];

  // Snapshot participants before the removal — if this is the last player, the
  // abandoned-focus record below still needs to know who was in the session.
  const participantIds = sessionParticipantIds(session);

  const playerCount = removePlayer(session, socketId);
  logger.info('session_player_left', {
    room_ref: correlationRef('room', sessionId),
    socket_ref: correlationRef('socket', socketId),
    player_count: playerCount,
  });

  io.to(sessionId).emit('player_left', { playerId: socketId });

  if (playerCount === 0) {
    if (session.phase === 'focus') {
      queueSessionRecording(sessionId, session, false, participantIds);
    }
    if (session.phaseTimer) clearTimeout(session.phaseTimer);
    delete sessions[sessionId];
    metrics.increment('sessions_closed_total');
    logger.info('session_closed', {
      room_ref: correlationRef('room', sessionId),
      reason: 'empty',
    });
  }
  // Presence is refreshed *after* the removal, so it reflects where the user
  // actually is now. Clearing it unconditionally here wiped the row while
  // another tab was still in a live session — presence.js was made
  // multi-socket-aware but this DB mirror was left single-writer.
  if (player.userId) refreshPresence(player.userId);

  // If players remain, the session keeps running for them (solo continuation
  // is intentional — sessions can also be started solo).
}

// Point the profile row at whichever session this user is still in, or clear
// it when they're in none.
function refreshPresence(userId) {
  if (!userId) return;
  const remaining = findUserSessions(sessions, userId);
  if (remaining.length === 0) {
    clearPresence(userId);
    return;
  }
  const sessionId = remaining[0];
  setPresence(userId, sessionId, sessions[sessionId].world);
}

function leaveSession(socket, sessionId) {
  cancelPendingDisconnect(socket.id);
  delete socketToSession[socket.id];
  socket.leave(sessionId);
  finalizePlayerRemoval(sessionId, socket.id);
}

// Account deletion is not a disconnect: reconnect grace would deliberately
// preserve every slot for another minute. Remove all of the user's tabs from
// live rooms immediately and do not record an abandoned round for an identity
// whose history was just deleted.
function removeUserFromLiveSessions(userId) {
  for (const [sessionId, session] of Object.entries(sessions)) {
    const socketIds = Object.entries(session.players)
      .filter(([, player]) => player.userId === userId)
      .map(([socketId]) => socketId);

    for (const socketId of socketIds) {
      cancelPendingDisconnect(socketId);
      delete socketToSession[socketId];
      io.sockets.sockets.get(socketId)?.leave(sessionId);
      removePlayer(session, socketId);
      io.to(sessionId).emit('player_left', { playerId: socketId });
    }

    releasePlayerSlot(session, userId);
    if (socketIds.includes(session.hostId)) {
      session.hostId = Object.keys(session.players)[0] || null;
    }

    if (Object.keys(session.players).length === 0) {
      if (session.phaseTimer) clearTimeout(session.phaseTimer);
      delete sessions[sessionId];
      metrics.increment('sessions_closed_total');
      logger.info('session_closed', {
        room_ref: correlationRef('room', sessionId),
        account_ref: correlationRef('account', userId),
        reason: 'account_deleted',
      });
    }
  }
}

// ── Socket Handlers ────────────────────────────────────────────────────────

async function sendFocusSaveStatus(socket) {
  const state = await recovery.statusForUser(socket.userId);
  if (socket.connected) socket.emit('focus_save_status', { state });
}

io.on('connection', (socket) => {
  metrics.increment('socket_connections_total');
  logger.info('socket_connected', {
    socket_ref: correlationRef('socket', socket.id),
  });

  // Presence is a handshake fact, not a client event. Waiting for
  // register_user left friends invisible and invites failing whenever the
  // client effect ran before socketRef was assigned.
  if (socket.userId) {
    const cameOnline = presence.add(socket.userId, socket.id);
    if (cameOnline) broadcastPresence(socket.userId, true);
    logger.info('presence_registered', {
      account_ref: correlationRef('account', socket.userId),
      socket_ref: correlationRef('socket', socket.id),
      came_online: cameOnline,
      source: 'connection',
    });
    void sendFocusSaveStatus(socket);
  }

  socket.on('request_focus_save_status', () => {
    if (!stopping && socket.userId) void sendFocusSaveStatus(socket);
  });

  registerAccountHandlers({
    socket,
    io,
    onPayload,
    supabase,
    presence,
    broadcastPresence,
    removeUserFromLiveSessions,
    metrics,
    logger,
  });
  registerSocialHandlers({
    socket,
    io,
    onPayload,
    presence,
    sessions,
    getFriendIds,
    areFriends,
    inviteRateLimit: rateLimits.sendInvite,
    metrics,
    logger,
  });

  registerRoomMembershipHandlers({
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
    isShuttingDown: () => stopping,
    createSessionRateLimit: rateLimits.createSession,
    shareInviteRateLimit: rateLimits.shareInvite,
    joinSessionRateLimit: rateLimits.joinSession,
    metrics,
    logger,
  });
  registerPhasePetHandlers({
    socket,
    io,
    onPayload,
    getSession,
    advancePhase,
    queueSessionRecording,
    metrics,
    logger,
  });

  // leave_session: no payload needed — the server knows which session this
  // socket is in. Trusting a client-sent id let a bogus one orphan the real
  // slot: leaveSession deletes socketToSession[socket.id] unconditionally,
  // then finalizePlayerRemoval no-ops on the unknown session. The player stays
  // in sessions[real].players with no socketToSession entry, so disconnect
  // skips its removal block too — the slot leaks permanently, the session is
  // never deleted, and its phase chain keeps recording fabricated focus.
  socket.on('leave_session', () => {
    if (stopping) return;
    const sessionId = socketToSession[socket.id];
    if (sessionId) leaveSession(socket, sessionId);
  });

  // request_sync: no payload
  // Client-initiated resync after tab wake / network hiccup. Emits current
  // session state if this socket is still tracked in a session; silent no-op
  // otherwise (client treats absence of sync_state as "no session").
  socket.on('request_sync', () => {
    if (stopping) return;
    const sessionId = socketToSession[socket.id];
    if (!sessionId) return;
    const session = getSession(sessionId);
    if (!session) return;
    socket.emit('sync_state', buildSyncPayload(session));
  });

  socket.on('disconnect', () => {
    metrics.increment('socket_disconnections_total');
    logger.info('socket_disconnected', {
      socket_ref: correlationRef('socket', socket.id),
    });
    const sessionId = socketToSession[socket.id];
    if (sessionId) {
      delete socketToSession[socket.id];
      const session = getSession(sessionId);
      const player = session?.players[socket.id];
      // The shutdown snapshot owns the round and its participant list. Do not
      // start reconnect grace or remove a participant while it is writing.
      if (!stopping && session && player?.userId) {
        // Grace window: keep the player's slot (and a solo session's timer)
        // alive so a reconnect can resume instead of losing the pomodoro.
        markPlayerDisconnected(session, socket.id, true);
        const timer = setTimeout(() => {
          pendingDisconnects.delete(socket.id);
          finalizePlayerRemoval(sessionId, socket.id);
        }, RECONNECT_GRACE_MS);
        pendingDisconnects.set(socket.id, timer);
        io.to(sessionId).emit('player_disconnected', { playerId: socket.id });
        logger.info('session_player_grace_started', {
          room_ref: correlationRef('room', sessionId),
          socket_ref: correlationRef('socket', socket.id),
          grace_seconds: RECONNECT_GRACE_MS / 1000,
        });
      } else if (!stopping && session) {
        // Unauthenticated (dev mode) players can't be matched on reconnect
        finalizePlayerRemoval(sessionId, socket.id);
      }
    }

    // Drop this socket's rate-limit counters — they'd otherwise accumulate forever
    Object.values(rateLimits).forEach((limiter) => limiter.clear(socket.id));

    // Clean up presence
    const { userId, wentOffline } = presence.remove(socket.id);
    if (userId) {
      // Only actually offline once the user's last tab is gone.
      if (wentOffline) broadcastPresence(userId, false);
      logger.info('presence_socket_closed', {
        account_ref: correlationRef('account', userId),
        socket_ref: correlationRef('socket', socket.id),
        went_offline: wentOffline,
      });
    }
  });
});

// Live sessions are in-memory and die with the process, but profiles.
// current_session_id is in Postgres and doesn't. Render redeploys on every
// push to main, so without this sweep everyone who was mid-session at that
// moment keeps a "Join" button forever that always errors with "Session not
// found" — and migration 013's tasks_read keeps trusting that column as proof
// of where they are.
async function clearAllPresence(reason) {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ current_session_id: null, current_world_id: null, current_room: null })
      .not('current_session_id', 'is', null);
    if (error) throw error;
    logger.info('presence_sweep_completed', { reason });
  } catch (error) {
    metrics.increment('presence_sweep_failures_total');
    logger.error('presence_sweep_failed', {
      reason,
      ...safeErrorFields(error),
    });
  }
}

function reportRuntimeSnapshot() {
  metrics.setGauge('connected_sockets', io.engine.clientsCount);
  metrics.setGauge('active_sessions', Object.keys(sessions).length);
  metrics.setGauge('pending_focus_recordings', pendingRecordings.size);
  metrics.logSnapshot();
}

let metricsInterval = null;
let replayInterval = null;
let startPromise = null;
let stopPromise = null;

async function start(port = 3001) {
  if (server.listening) return server.address();
  if (startPromise) return startPromise;

  metrics.increment('process_starts_total');
  metricsInterval = setInterval(reportRuntimeSnapshot, 60_000);
  metricsInterval.unref();
  if (focusQueue) {
    replayInterval = setInterval(() => void recovery.replay(), replayIntervalMs);
    replayInterval.unref();
  }

  startPromise = new Promise((resolve, reject) => {
    const onError = (error) => {
      clearInterval(metricsInterval);
      metricsInterval = null;
      clearInterval(replayInterval);
      replayInterval = null;
      startPromise = null;
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, async () => {
      server.off('error', onError);
      // The bound port, not the requested one — port 0 means "pick a free one",
      // which is how integration tests avoid fighting a dev server for 3001.
      logger.info('server_started', {
        port: server.address().port,
        allowed_origin_count: allowedOrigins.length,
      });
      reportRuntimeSnapshot();
      await clearAllPresence('boot');
      void recovery.replay();
      resolve(server.address());
    });
  });

  return startPromise;
}

async function stop(reason = 'shutdown') {
  if (stopPromise) return stopPromise;

  stopPromise = (async () => {
    stopping = true;
    clearInterval(metricsInterval);
    metricsInterval = null;
    clearInterval(replayInterval);
    replayInterval = null;
    // A player may already be in reconnect grace when shutdown begins. Its
    // timer must not remove the last slot and queue a second recording while
    // the shutdown snapshot is waiting for the first database write.
    for (const timer of pendingDisconnects.values()) clearTimeout(timer);
    pendingDisconnects.clear();
    // Freeze the phase chain before an overdue timer can complete the same
    // round. recordSession snapshots the key, elapsed time, and both users
    // synchronously, so later socket disconnects cannot change the record.
    let interruptedRounds = 0;
    for (const [sessionId, session] of Object.entries(sessions)) {
      if (session.phaseTimer) {
        clearTimeout(session.phaseTimer);
        session.phaseTimer = null;
      }
      if (session.phase === 'focus') {
        queueSessionRecording(sessionId, session, false);
        interruptedRounds += 1;
      }
      io.to(sessionId).emit('session_error', {
        message: 'Room ended during a server restart. Check History for your focus time.',
      });
    }
    logger.info('shutdown_focus_snapshot', { reason, interrupted_rounds: interruptedRounds });

    const closeSockets = server.listening
      ? new Promise((resolve) => io.close(resolve))
      : Promise.resolve();
    await Promise.allSettled([
      drainPendingRecordings(),
      recovery.drain(),
      clearAllPresence(reason),
      closeSockets,
    ]);
    focusQueue?.close();
  })();

  return stopPromise;
}

return { app, server, io, start, stop };
}

module.exports = { createRealtimeApp };
