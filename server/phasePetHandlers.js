const { beginFocusRound, setPlayerPet } = require('./session');
const { petStageAt } = require('./petLevel');
const {
  MAX_FOCUS,
  MAX_BREAK,
  parseStartSession,
  parseSessionReference,
  parseSetPet,
} = require('./payloadParsers');
const { correlationRef } = require('./observability');

function registerPhasePetHandlers({
  socket,
  io,
  onPayload,
  getSession,
  advancePhase,
  queueSessionRecording,
  metrics,
  logger,
  schedule = setTimeout,
  cancel = clearTimeout,
  now = Date.now,
  beginRound = beginFocusRound,
  updatePet = setPlayerPet,
  stageForPet = petStageAt,
}) {
  onPayload(socket, 'start_session', (payload) => {
    const parsed = parseStartSession(payload);
    if (!parsed.ok) return;
    const { sessionId, focusDuration, breakDuration, mode } = parsed.value;
    const session = getSession(sessionId);
    if (!session || Object.keys(session.players).length < 1) return;
    if (!session.players[socket.id]) return;
    // A duplicate or racing start must not reset elapsed focus. A completed
    // pomodoro stays in this room until either player starts another round.
    if (session.phase !== 'waiting' && session.phase !== 'ready') return;

    session.mode = mode;
    if (mode === 'flow') {
      session.focusDuration = MAX_FOCUS;
      session.breakDuration = MAX_BREAK;
    } else {
      session.focusDuration = focusDuration;
      session.breakDuration = breakDuration;
    }

    beginRound(session);
    if (session.phaseTimer) cancel(session.phaseTimer);

    io.to(sessionId).emit('phase_change', {
      completedRounds: session.completedRounds,
      roundRecap: session.roundRecap,
      mode: session.mode,
      phase: 'focus',
      phaseStartTime: session.phaseStartTime,
      focusDuration: session.focusDuration,
      breakDuration: session.breakDuration,
    });

    if (mode === 'pomodoro') {
      session.phaseTimer = schedule(
        () => advancePhase(sessionId),
        session.focusDuration * 1000,
      );
    }
    metrics.increment('focus_rounds_started_total');
    logger.info('focus_round_started', {
      room_ref: correlationRef('room', sessionId),
      mode,
      focus_seconds: session.focusDuration,
      break_seconds: session.breakDuration,
      player_count: Object.keys(session.players).length,
    });
  });

  onPayload(socket, 'finish_flow_focus', (payload) => {
    const parsed = parseSessionReference(payload);
    if (!parsed.ok) return;
    const { sessionId } = parsed.value;
    const session = getSession(sessionId);
    if (!session || session.mode !== 'flow' || session.phase !== 'focus') return;
    if (!session.players[socket.id]) return;

    const elapsedSeconds = Math.round((now() - session.phaseStartTime) / 1000);
    const effectiveFocus = Math.min(elapsedSeconds, session.focusDuration);
    // Keep focusDuration at the open-ended safety cap. Replacing it with the
    // elapsed value would make the next flow round inherit an automatic end.
    session.breakDuration = Math.min(
      Math.max(60, Math.round(effectiveFocus / 5)),
      MAX_BREAK,
    );
    advancePhase(sessionId);
  });

  onPayload(socket, 'stop_session', (payload) => {
    const parsed = parseSessionReference(payload);
    if (!parsed.ok) return;
    const { sessionId } = parsed.value;
    const session = getSession(sessionId);
    if (!session || !session.players[socket.id]) return;

    if (session.phase === 'focus') {
      // Recording snapshots all mutable round fields synchronously before its
      // first await; queue it before clearing the live round below.
      queueSessionRecording(sessionId, session, false);
    }
    if (session.phaseTimer) {
      cancel(session.phaseTimer);
      session.phaseTimer = null;
    }

    session.roundRecap = null;
    session.phase = 'waiting';
    session.phaseStartTime = null;
    session.focusRoundId = null;
    io.to(sessionId).emit('phase_change', {
      completedRounds: session.completedRounds,
      roundRecap: session.roundRecap,
      mode: session.mode,
      phase: 'waiting',
      phaseStartTime: null,
      focusDuration: session.focusDuration,
      breakDuration: session.breakDuration,
    });
  });

  onPayload(socket, 'set_pet', (payload) => {
    const parsed = parseSetPet(payload);
    if (!parsed.ok) return;
    const { sessionId, pet } = parsed.value;
    const session = getSession(sessionId);
    const player = session?.players[socket.id];
    if (!player) return;

    const petStage = pet ? stageForPet(player.focusSeconds || 0) : null;
    updatePet(session, socket.id, pet, petStage);
    io.to(sessionId).emit('pet_changed', {
      playerId: socket.id,
      pet,
      petStage,
    });
  });
}

module.exports = { registerPhasePetHandlers };
