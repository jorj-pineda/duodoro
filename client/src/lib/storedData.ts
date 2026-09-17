// ─────────────────────────────────────────────────────────────────────────────
// Validated reads of browser-held state.
//
// Every value here comes back from `localStorage`/`sessionStorage`, which means
// three ways it can be wrong: written by an older version of the app with a
// different shape, hand-edited, or handed over by another app on the same
// origin. None of that is hypothetical — the profile cache carries *user
// choices* (avatar colours and styles) that go straight into a socket payload,
// so an unusable value is not a local rendering glitch, it is a character the
// partner sees differently from the person who owns it.
//
// This follows the rule `shareInvite.ts` set for the pending-invite token:
// validate on read, and drop the value rather than pass it on. The server
// validates every payload again (`server/payloadParsers.js`) — that boundary
// stays authoritative. This only stops the client from *choosing* to send
// something it already knows is malformed.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EYE_STYLES,
  HAIR_STYLES,
  type AvatarConfig,
} from "./avatarData";

/** A hex colour in the one form the server accepts. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * A session id, as the server issues them: a UUID v4.
 *
 * Deliberately the same shape the server uses (`crypto.randomUUID`) rather than
 * a looser "non-empty string". A stored value that is not a UUID cannot name a
 * live session — sessions live in memory and are keyed by the UUID the server
 * generated — so accepting one only buys a doomed `join_session` round trip and
 * a "Session not found" toast for something that was never a session.
 */
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

/**
 * Narrow an unknown value to an `AvatarConfig`, or null.
 *
 * Mirrors `parseAvatar` in `server/payloadParsers.js` — same hex pattern, same
 * style allowlists, same field set. It is duplicated rather than shared because
 * the two packages cannot import each other; if one list changes, the other has
 * to change with it, and `avatarData.test.ts` pins that they agree.
 */
export function normalizeAvatarConfig(value: unknown): AvatarConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { skinColor, hairStyle, hairColor, eyeStyle, outfitColor } =
    value as Partial<AvatarConfig>;
  if (
    typeof skinColor !== "string" ||
    !HEX_COLOR.test(skinColor) ||
    typeof hairColor !== "string" ||
    !HEX_COLOR.test(hairColor) ||
    typeof outfitColor !== "string" ||
    !HEX_COLOR.test(outfitColor)
  ) {
    return null;
  }
  if (
    typeof hairStyle !== "string" ||
    !HAIR_STYLES.includes(hairStyle as AvatarConfig["hairStyle"]) ||
    typeof eyeStyle !== "string" ||
    !EYE_STYLES.includes(eyeStyle as AvatarConfig["eyeStyle"])
  ) {
    return null;
  }
  return {
    skinColor,
    hairStyle: hairStyle as AvatarConfig["hairStyle"],
    hairColor,
    eyeStyle: eyeStyle as AvatarConfig["eyeStyle"],
    outfitColor,
  };
}
