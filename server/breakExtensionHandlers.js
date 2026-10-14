const { randomUUID } = require('crypto');
const { parseBreakExtension, MAX_BREAK } = require('./payloadParsers');

const EXTRA_SECONDS = 120;

function startBreakExtension(session) {
  const ids = Object.values(session.players).map(player => player.userId).filter(Boolean);
  return {
    eligibleUserIds: ids.length === 2 && new Set(ids).size === 2 && session.breakDuration + EXTRA_SECONDS <= MAX_BREAK ? ids : [],
    status: 'available', proposalId: null, requesterId: null, extraSeconds: 0,
  };
}

function registerBreakExtensionHandlers({ socket, io, onPayload, getSession, advancePhase, allow,
  now = Date.now, schedule = setTimeout, cancel = clearTimeout, newId = randomUUID }) {
  function act(payload, respond, responding) {
    if (typeof respond !== 'function') return;
    const parsed = parseBreakExtension(payload, responding);
    if (!parsed.ok) return respond({ ok: false, message: 'Invalid break request.' });
    const { sessionId, phaseStartTime, proposalId, accept } = parsed.value;
    const session = getSession(sessionId);
    const state = session?.breakExtension;
    const player = session?.players[socket.id];
    // Consent belongs to the two accounts present when this break began. A
    // replacement partner, second tab, or dropped connection cannot vote.
    const players = Object.values(session?.players ?? {});
    if (!socket.userId || player?.userId !== socket.userId || session.phase !== 'break' || session.phaseStartTime !== phaseStartTime ||
      !state || state.eligibleUserIds.length !== 2 || players.length !== 2 ||
      players.some(p => p.disconnected || !state.eligibleUserIds.includes(p.userId)) ||
      new Set(players.map(p => p.userId)).size !== 2) {
      return respond({ ok: false, message: 'Both original partners must be connected in this break.' });
    }
    const deadline = phaseStartTime + (session.breakDuration + state.extraSeconds) * 1000;
    if (now() >= deadline) return respond({ ok: false, message: 'This break has already ended.' });
    if (!allow()) return respond({ ok: false, message: 'Wait a moment before trying again.' });
    if (!responding) {
      if (state.status !== 'available') return respond({ ok: false, message: 'Only one extension request is allowed per break.' });
      state.status = 'pending'; state.proposalId = newId(); state.requesterId = socket.userId;
    } else {
      if (state.status !== 'pending' || state.proposalId !== proposalId || state.requesterId === socket.userId) {
        return respond({ ok: false, message: 'This request is no longer available to answer.' });
      }
      state.status = accept ? 'accepted' : 'declined';
      if (accept) {
        state.extraSeconds = EXTRA_SECONDS;
        if (session.phaseTimer) cancel(session.phaseTimer);
        session.phaseTimer = schedule(() => advancePhase(sessionId), deadline + EXTRA_SECONDS * 1000 - now());
      }
    }
    // Keep the original phase timestamp and configured break duration. Only
    // this break's deadline changes; Go again and future Flow breaks do not.
    io.to(sessionId).emit('break_extension_changed', { sessionId, phaseStartTime, state });
    respond({ ok: true });
  }
  onPayload(socket, 'request_break_extension', (payload, respond) => act(payload, respond, false));
  onPayload(socket, 'respond_break_extension', (payload, respond) => act(payload, respond, true));
}

module.exports = { startBreakExtension, registerBreakExtensionHandlers };
