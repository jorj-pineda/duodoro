const { petStageAt } = require('./petLevel');

/** Refresh saved totals, never add local credit to a total that a reconnect
 * may already have loaded. Progress is private; only the visible stage is shared. */
function createCompanionGrowth({ sessions, io, totalFocusSeconds }) {
  const latest = new Map();
  async function refresh(userIds, { celebrate = false } = {}) {
    await Promise.all([...new Set(userIds.filter(Boolean))].map(async (userId) => {
      const request = {};
      latest.set(userId, request);
      let seconds = null;
      try { seconds = await totalFocusSeconds(userId); } catch { /* Preserve the last known stage. */ }
      if (latest.get(userId) !== request) return;
      latest.delete(userId);
      for (const [sessionId, session] of Object.entries(sessions)) {
        for (const [socketId, player] of Object.entries(session.players)) {
          if (player.userId !== userId) continue;
          let grewTo = null;
          if (Number.isFinite(seconds) && seconds >= 0) {
            const previous = player.petStage;
            const knownBefore = Number.isFinite(player.focusSeconds);
            // Saved focus is monotonic. A slower DB read cannot roll back a
            // more recent join/read, and idempotent writes cannot double-count.
            player.focusSeconds = Math.max(knownBefore ? player.focusSeconds : 0, seconds);
            const next = player.pet ? petStageAt(player.focusSeconds) : null;
            if (next !== previous) {
              player.petStage = next;
              io.to(sessionId).emit('pet_changed', { playerId: socketId, pet: player.pet, petStage: next });
              if (celebrate && knownBefore && previous && next &&
                  ['young', 'grown', 'full'].indexOf(next) > ['young', 'grown', 'full'].indexOf(previous)) grewTo = next;
            }
          }
          io.to(socketId).emit('companion_progress', {
            sessionId,
            focusSeconds: Number.isFinite(seconds) && seconds >= 0 ? player.focusSeconds : null,
            grewTo,
          });
        }
      }
    }));
  }
  return { refresh };
}
module.exports = { createCompanionGrowth };
