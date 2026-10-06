const { parseSetPetName } = require('./payloadParsers');
const { companionName } = require('../shared/companionNames');
function registerCompanionNameHandlers({ socket, io, onPayload, getSession, allow }) {
  onPayload(socket, 'set_pet_name', (payload, respond) => {
    if (typeof respond !== 'function') return;
    const parsed = parseSetPetName(payload);
    if (!parsed.ok) return respond({ ok: false, message: 'Use a name of 24 characters or fewer.' });
    const { sessionId, name } = parsed.value;
    const session = getSession(sessionId);
    const player = session?.players[socket.id];
    if (!socket.userId || player?.userId !== socket.userId || !player.pet) return respond({ ok: false, message: 'Rejoin with a companion before renaming it.' });
    if (!allow()) return respond({ ok: false, message: 'Wait a moment before renaming again.' });
    player.petName = companionName(player.pet, name);
    io.to(session.id).emit('companion_name_changed', { sessionId: session.id, playerId: socket.id, petName: player.petName });
    respond({ ok: true, name: player.petName });
  });
}
module.exports = { registerCompanionNameHandlers };
