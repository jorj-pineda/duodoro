const { randomUUID } = require('crypto');
const { parseReaction } = require('./payloadParsers');

function registerReactionHandlers({ socket, io, onPayload, getSession, allow }) {
  onPayload(socket, 'send_reaction', (payload, respond) => {
    if (typeof respond !== 'function') return;
    const parsed = parseReaction(payload);
    if (!parsed.ok) return respond({ ok: false, message: 'Choose a heart, cheer, or wave.' });
    const session = getSession(parsed.value.sessionId);
    if (!socket.userId || session?.players[socket.id]?.userId !== socket.userId) {
      return respond({ ok: false, message: 'Rejoin this room before sending a reaction.' });
    }
    const pet = session.players[socket.id].pet;
    if (parsed.value.target === "companion" && !pet) return respond({ ok: false, message: "Choose a companion first." });
    if (!allow()) return respond({ ok: false, message: 'Wait a moment before sending another reaction.' });
    // Ephemeral and room-scoped: never store in snapshots or focus history.
    io.to(session.id).emit('room_reaction', {
      id: randomUUID(), sessionId: session.id, playerId: socket.id, reaction: parsed.value.reaction,
      ...(parsed.value.target === "companion" ? { target: "companion", pet } : {}),
    });
    respond({ ok: true });
  });
}
module.exports = { registerReactionHandlers };
