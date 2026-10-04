const { parseSetIntention, parseResolveIntention } = require('./payloadParsers');

function registerIntentionHandlers({ socket, io, onPayload, getSession, allow }) {
  const publish = (session) => io.to(session.id).emit('intentions_changed', {
    sessionId: session.id, intentions: session.intentions, recap: session.roundRecap,
  });
  const member = (session) => socket.userId && session?.players[socket.id]?.userId === socket.userId;
  onPayload(socket, 'set_intention', (payload, respond) => {
    if (typeof respond !== 'function') return;
    const parsed = parseSetIntention(payload);
    if (!parsed.ok) return respond({ ok: false, message: 'Use a short intention, up to 160 characters.' });
    const session = getSession(parsed.value.sessionId);
    if (!member(session)) return respond({ ok: false, message: 'Rejoin this room before saving an intention.' });
    if (!allow()) return respond({ ok: false, message: 'Please wait a moment and try again.' });
    if (session.phase === 'focus') return respond({ ok: false, message: 'Focus has started. Add your next intention during the break.' });
    session.intentions ||= { current: {}, next: {} };
    if (parsed.value.text) session.intentions.next[socket.userId] = parsed.value.text;
    else delete session.intentions.next[socket.userId];
    publish(session);
    respond({ ok: true });
  });
  onPayload(socket, 'resolve_intention', (payload, respond) => {
    if (typeof respond !== 'function') return;
    const parsed = parseResolveIntention(payload);
    if (!parsed.ok) return respond({ ok: false, message: 'Invalid intention action.' });
    const session = getSession(parsed.value.sessionId);
    if (!member(session)) return respond({ ok: false, message: 'Rejoin this room before updating an intention.' });
    if (!allow()) return respond({ ok: false, message: 'Please wait a moment and try again.' });
    const recap = session.roundRecap;
    const intention = recap?.intentions?.[socket.userId];
    if (!intention || recap.round !== parsed.value.round || session.phase === 'focus') {
      return respond({ ok: false, message: 'That round has ended. Check the current recap.' });
    }
    if (parsed.value.action === 'carry') {
      // A stale carry click must not overwrite a freshly edited next intention.
      const next = session.intentions.next[socket.userId];
      if (next && next !== intention.text) return respond({ ok: false, message: 'You already have a different intention for the next round.' });
      session.intentions.next[socket.userId] = intention.text;
    } else {
      intention.completed = parsed.value.action === 'done';
      if (session.intentions.current[socket.userId]) session.intentions.current[socket.userId].completed = intention.completed;
    }
    publish(session);
    respond({ ok: true });
  });
}
module.exports = { registerIntentionHandlers };
