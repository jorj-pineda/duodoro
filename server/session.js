const { randomBytes, randomUUID } = require("crypto");
const { petStageAt } = require("./petLevel");

const MAX_SESSION_PLAYERS = 2;
const SHARE_INVITE_TTL_MS = 15 * 60 * 1000;

function createSessionState(world, hostSocketId) {
  return {
    id: randomUUID(),
    mode: "pomodoro",
    phase: "waiting",
    focusDuration: 25 * 60,
    breakDuration: 5 * 60,
    phaseStartTime: null,
    phaseTimer: null,
    // One stable database idempotency key per focus round. It is created when
    // focus begins, not when persistence begins, so every completion/stop and
    // every retry refers to the same real-world event.
    focusRoundId: null,
    completedRounds: 0,
    roundRecap: null,
    lastCompletedFocusRoundId: null,
    // A lost RPC response can make the retry return an existing DB row. Keep
    // pet credit idempotent in memory too; this is intentionally server-only.
    creditedFocusRoundIds: new Set(),
    world: world || "forest",
    hostId: hostSocketId,
    players: {},
    // userIds explicitly invited to this session. Knowing the session UUID is
    // not by itself permission to join — see canJoinSession in index.js.
    invitedUserIds: new Set(),
    // New joins reserve a seat before awaiting focus-history reads. Without a
    // synchronous reservation, two joins can both see one player, both await,
    // and then both enter what is meant to be a two-person room.
    pendingJoinUserIds: new Set(),
    // One opaque bearer invite for the remaining seat. It is deliberately
    // server-only: the room UUID is not permission to join, and sync payloads
    // must never leak a token to every participant automatically.
    shareInvite: null,
  };
}

function createShareInvite(
  session,
  now = Date.now(),
  token = randomBytes(32).toString("base64url"),
) {
  session.shareInvite = { token, expiresAt: now + SHARE_INVITE_TTL_MS };
  return session.shareInvite;
}

function hasValidShareInvite(session, token, now = Date.now()) {
  if (typeof token !== "string" || !token || !session.shareInvite) return false;
  if (session.shareInvite.expiresAt <= now) {
    session.shareInvite = null;
    return false;
  }
  return session.shareInvite.token === token;
}

function findSessionByShareInvite(sessions, token, now = Date.now()) {
  if (typeof token !== "string" || !token) return null;
  for (const session of Object.values(sessions)) {
    if (hasValidShareInvite(session, token, now)) return session;
  }
  return null;
}

function consumeShareInvite(session, token, now = Date.now()) {
  if (!hasValidShareInvite(session, token, now)) return false;
  session.shareInvite = null;
  return true;
}

function beginFocusRound(
  session,
  startedAt = Date.now(),
  recordingKey = randomUUID(),
) {
  session.roundRecap = null;
  session.phase = "focus";
  session.phaseStartTime = startedAt;
  session.focusRoundId = recordingKey;
  return recordingKey;
}

// Count completion separately from asynchronous history persistence.
function completeFocusRound(session, now = Date.now()) {
  if (session.phase !== "focus" || !session.focusRoundId ||
      session.lastCompletedFocusRoundId === session.focusRoundId) return false;
  session.completedRounds += 1;
  session.lastCompletedFocusRoundId = session.focusRoundId;
  session.roundRecap = {
    round: session.completedRounds,
    focusSeconds: session.mode === "flow"
      ? Math.max(0, Math.min(Math.round((now - session.phaseStartTime) / 1000), session.focusDuration))
      : session.focusDuration,
    mode: session.mode,
    saveState: "saving",
  };
  return true;
}

// Match the private recording key, even after ready clears focusRoundId.
// A delayed write for an older round must never update a newer recap.
function updateRoundRecap(session, recordingKey, saveState) {
  if (!session?.roundRecap || session.lastCompletedFocusRoundId !== recordingKey) return null;
  session.roundRecap = { ...session.roundRecap, saveState };
  return session.roundRecap;
}

function inviteUser(session, userId) {
  if (!userId) return false;
  session.invitedUserIds.add(userId);
  return true;
}

function isInvited(session, userId) {
  return Boolean(userId) && session.invitedUserIds.has(userId);
}

function addPlayer(session, socketId, { avatar, displayName, userId, pet, petStage, focusSeconds }) {
  const safePet = pet || null;
  session.players[socketId] = {
    avatar,
    displayName: displayName || "Player",
    userId: userId || null,
    pet: safePet,
    // Stage is the server's. Callers pass what petStageAt() returned for this
    // user's completed-focus total; a missing value is young (0 hours), never
    // full. Cleared when there is no pet so a later pick doesn't inherit a
    // stale size from a previous animal.
    petStage: safePet ? petStage || "young" : null,
    // Private cache of the total that produced petStage. Stripped from
    // buildSyncPayload — the partner sees the animal, not the hours.
    focusSeconds: Number.isFinite(focusSeconds) ? focusSeconds : 0,
    disconnected: false,
  };
  return Object.keys(session.players).length;
}

function findPlayerByUserId(session, userId) {
  if (!userId) return null;
  for (const [socketId, player] of Object.entries(session.players)) {
    if (player.userId === userId) return socketId;
  }
  return null;
}

/**
 * Claim one of the room's two seats for a distinct new user.
 *
 * Existing participants do not consume another seat when reconnecting. The
 * returned `reserved` flag tells the caller whether it owns a pending entry
 * that must be released after the join succeeds or fails.
 */
function reservePlayerSlot(session, userId) {
  if (!userId) return { ok: false, reserved: false };
  if (findPlayerByUserId(session, userId)) {
    return { ok: true, reserved: false };
  }
  if (session.pendingJoinUserIds.has(userId)) {
    return { ok: false, reserved: false };
  }
  const occupied = Object.keys(session.players).length + session.pendingJoinUserIds.size;
  if (occupied >= MAX_SESSION_PLAYERS) {
    return { ok: false, reserved: false };
  }
  session.pendingJoinUserIds.add(userId);
  return { ok: true, reserved: true };
}

function releasePlayerSlot(session, userId) {
  return session.pendingJoinUserIds.delete(userId);
}

function hasOpenPlayerSlot(session) {
  return Object.keys(session.players).length + session.pendingJoinUserIds.size <
    MAX_SESSION_PLAYERS;
}

function markPlayerDisconnected(session, socketId, disconnected) {
  const player = session.players[socketId];
  if (!player) return false;
  player.disconnected = disconnected;
  return true;
}

function setPlayerPet(session, socketId, pet, petStage) {
  const player = session.players[socketId];
  if (!player) return false;
  player.pet = pet || null;
  player.petStage = player.pet ? petStage || "young" : null;
  return true;
}

/**
 * Add completed-focus seconds to the named users and grow any pet that
 * crossed a threshold.
 *
 * Returns the slots whose *visible* stage changed, so the caller can emit
 * pet_changed. Accumulating on someone with no pet still counts — they
 * should not have to re-fetch to see the right size when they pick one
 * later in the same session.
 */
function creditFocus(session, userIds, extraSeconds) {
  const extra = Number(extraSeconds);
  if (!Number.isFinite(extra) || extra <= 0) return [];
  const idSet = new Set(userIds);
  const changed = [];
  for (const [socketId, player] of Object.entries(session.players)) {
    if (!player.userId || !idSet.has(player.userId)) continue;
    player.focusSeconds = (player.focusSeconds || 0) + extra;
    if (!player.pet) continue;
    const next = petStageAt(player.focusSeconds);
    if (next === player.petStage) continue;
    player.petStage = next;
    changed.push({ playerId: socketId, pet: player.pet, petStage: next });
  }
  return changed;
}

function creditFocusRound(session, recordingKey, userIds, extraSeconds) {
  if (!recordingKey || session.creditedFocusRoundIds.has(recordingKey)) return [];
  session.creditedFocusRoundIds.add(recordingKey);
  return creditFocus(session, userIds, extraSeconds);
}

function removePlayer(session, socketId) {
  delete session.players[socketId];
  return Object.keys(session.players).length;
}

// Distinct authenticated userIds currently holding a slot. Deduped because
// session_participants has a unique (session_id, user_id) index — a repeated id
// would fail the whole batch insert, losing the entire record.
function sessionParticipantIds(session) {
  return [
    ...new Set(
      Object.values(session.players)
        .map((p) => p.userId)
        .filter(Boolean),
    ),
  ];
}

// Every session id this user currently holds a slot in. One user can be in
// more than one at a time — socketToSession is per socket, so a second tab
// joins a second session without leaving the first.
function findUserSessions(sessions, userId) {
  if (!userId) return [];
  return Object.entries(sessions)
    .filter(([, session]) => findPlayerByUserId(session, userId))
    .map(([sessionId]) => sessionId);
}

function publicPlayer(player) {
  const { focusSeconds: _focusSeconds, ...rest } = player;
  return rest;
}

function buildSyncPayload(session) {
  const players = {};
  for (const [id, player] of Object.entries(session.players)) {
    players[id] = publicPlayer(player);
  }
  return {
    completedRounds: session.completedRounds,
    roundRecap: session.roundRecap,
    mode: session.mode,
    phase: session.phase,
    focusDuration: session.focusDuration,
    breakDuration: session.breakDuration,
    phaseStartTime: session.phaseStartTime,
    world: session.world,
    players,
    playerCount: Object.keys(session.players).length,
    sessionId: session.id,
  };
}

module.exports = {
  MAX_SESSION_PLAYERS,
  SHARE_INVITE_TTL_MS,
  createSessionState,
  createShareInvite,
  hasValidShareInvite,
  findSessionByShareInvite,
  consumeShareInvite,
  beginFocusRound,
  completeFocusRound,
  updateRoundRecap,
  addPlayer,
  removePlayer,
  setPlayerPet,
  creditFocus,
  creditFocusRound,
  inviteUser,
  isInvited,
  findPlayerByUserId,
  reservePlayerSlot,
  releasePlayerSlot,
  hasOpenPlayerSlot,
  markPlayerDisconnected,
  sessionParticipantIds,
  findUserSessions,
  buildSyncPayload,
};
