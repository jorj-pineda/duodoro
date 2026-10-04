// Pure parsers for every client-originated Socket.IO payload. The transport
// boundary already rejects non-object containers; these functions validate and
// normalize fields without reading live session state or performing I/O.

const MAX_DISPLAY_NAME = 50;
const MAX_FOCUS = 120 * 60;
const MAX_BREAK = 60 * 60;

const VALID_HAIR_STYLES = ['bob', 'mohawk', 'long', 'spiky', 'bald'];
const VALID_EYE_STYLES = ['normal', 'anime', 'sleepy'];
const VALID_PETS = ['cat', 'dog', 'dragon', 'rabbit'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function valid(value) {
  return { ok: true, value };
}

function invalid(reason) {
  return { ok: false, reason };
}

function parsePet(pet) {
  return VALID_PETS.includes(pet) ? pet : null;
}

function parseDisplayName(displayName, fallback) {
  return (typeof displayName === 'string' ? displayName : fallback)
    .slice(0, MAX_DISPLAY_NAME);
}

function parseAvatar(avatar) {
  if (!avatar || typeof avatar !== 'object' || Array.isArray(avatar)) return null;
  const { skinColor, hairStyle, hairColor, eyeStyle, outfitColor } = avatar;
  if (!HEX_COLOR.test(skinColor) ||
      !HEX_COLOR.test(hairColor) ||
      !HEX_COLOR.test(outfitColor)) return null;
  if (!VALID_HAIR_STYLES.includes(hairStyle) ||
      !VALID_EYE_STYLES.includes(eyeStyle)) return null;
  return { skinColor, hairStyle, hairColor, eyeStyle, outfitColor };
}

function parseDeleteAccount(payload) {
  return payload.confirmation === 'DELETE'
    ? valid({ confirmation: 'DELETE' })
    : invalid('confirmation');
}

function parseOnlineFriends(payload) {
  const { friendIds } = payload;
  if (!Array.isArray(friendIds) || friendIds.length > 100 ||
      friendIds.some((id) => typeof id !== 'string')) {
    return invalid('friend_ids');
  }
  return valid({ friendIds });
}

function parseSendInvite(payload) {
  if (typeof payload.targetUserId !== 'string' || !payload.targetUserId) {
    return invalid('target_user_id');
  }
  return valid({
    targetUserId: payload.targetUserId,
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
    fromName: parseDisplayName(payload.fromName, 'Someone'),
  });
}

function parseCreateSession(payload) {
  const avatar = parseAvatar(payload.avatar);
  if (!avatar) return invalid('avatar');
  return valid({
    avatar,
    displayName: parseDisplayName(payload.displayName, 'Player'),
    pet: parsePet(payload.pet),
  });
}

function parseShareInvite(payload) {
  return typeof payload.sessionId === 'string'
    ? valid({ sessionId: payload.sessionId })
    : invalid('session_id');
}

function parseJoinSession(payload) {
  const avatar = parseAvatar(payload.avatar);
  if (!avatar) return invalid('avatar');

  const joiningByLink = typeof payload.shareToken === 'string';
  if (joiningByLink &&
      (payload.shareToken.length < 20 || payload.shareToken.length > 128)) {
    return invalid('share_token');
  }
  if (!joiningByLink && typeof payload.sessionId !== 'string') {
    return invalid('session_id');
  }

  return valid({
    sessionId: joiningByLink ? null : payload.sessionId,
    shareToken: joiningByLink ? payload.shareToken : null,
    joiningByLink,
    avatar,
    displayName: parseDisplayName(payload.displayName, 'Player'),
    pet: parsePet(payload.pet),
  });
}

function parseStartSession(payload) {
  if (typeof payload.sessionId !== 'string') return invalid('session_id');
  return valid({
    sessionId: payload.sessionId,
    focusDuration: Math.min(
      Math.max(Number(payload.focusDuration) || 25 * 60, 60),
      MAX_FOCUS,
    ),
    breakDuration: Math.min(
      Math.max(Number(payload.breakDuration) || 5 * 60, 30),
      MAX_BREAK,
    ),
    mode: payload.mode === 'flow' ? 'flow' : 'pomodoro',
  });
}

function parseSessionReference(payload) {
  return typeof payload.sessionId === 'string'
    ? valid({ sessionId: payload.sessionId })
    : invalid('session_id');
}

function parseSetPet(payload) {
  if (typeof payload.sessionId !== 'string') return invalid('session_id');
  return valid({ sessionId: payload.sessionId, pet: parsePet(payload.pet) });
}

function parseSetIntention(payload) {
  if (typeof payload.sessionId !== 'string' || typeof payload.text !== 'string' || payload.text.length > 160) return invalid('intention');
  return valid({ sessionId: payload.sessionId, text: payload.text.replace(/\s+/g, ' ').trim() });
}
function parseResolveIntention(payload) {
  if (typeof payload.sessionId !== 'string' || !Number.isSafeInteger(payload.round) || payload.round < 1 ||
      !['done', 'undo', 'carry'].includes(payload.action)) return invalid('intention');
  return valid({ sessionId: payload.sessionId, round: payload.round, action: payload.action });
}

module.exports = {
  parseSetIntention,
  parseResolveIntention,
  MAX_FOCUS,
  MAX_BREAK,
  parseDeleteAccount,
  parseOnlineFriends,
  parseSendInvite,
  parseCreateSession,
  parseShareInvite,
  parseJoinSession,
  parseStartSession,
  parseSessionReference,
  parseSetPet,
};
