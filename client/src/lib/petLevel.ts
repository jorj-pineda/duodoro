// ─────────────────────────────────────────────────────────────────────────────
// Pet growth — derived from total completed focus, never stored.
//
// A companion that gets bigger because of hours you actually put in is the
// first thing in the product that rewards returning. Growth is a *map with
// more cells* at the same ART_PX, never a scale multiplier — a 9×7 cat at
// size={4} is the same cat with bigger pixels, not a bigger cat.
//
// **Derived, not stored**, same instinct as the world rotation and for the
// same reason: a stored counter is a thing to migrate, resync and reconcile,
// and it can disagree with the history it is supposed to summarise. Total
// completed focus seconds already live in `sessions` / `session_participants`.
// `level = f(totalFocusSeconds)` needs no new column, cannot drift, and is
// automatically right for existing users the day it ships.
//
// **This file is duplicated at `server/petLevel.js`.** `client/` and `server/`
// are independent npm packages and cannot import each other. Both copies are
// pinned to the same table of (seconds → stage) in their tests, so editing
// one and not the other fails the other package's suite rather than silently
// showing two people two different animals.
//
// The server is still the authority in a session. This copy exists so the
// client can reason about its own pet before `sync_state` lands, and so the
// tests have something to pin. A client-sent stage is ignored.
// ─────────────────────────────────────────────────────────────────────────────

export const PET_STAGES = ["young", "grown", "full"] as const;
export type PetStage = (typeof PET_STAGES)[number];

/**
 * Seconds of completed focus before the pet grows from young → grown.
 *
 * Three hours is about seven ordinary pomodoros — inside a week of two
 * 25-minute sessions a day, which is the "ordinary use" the thresholds
 * were aimed at.
 */
export const GROWN_AT_SECONDS = 3 * 60 * 60;

/**
 * Seconds of completed focus before the pet grows from grown → full.
 *
 * Fifteen hours is a few weeks at that same pace. The final sprite is
 * half an avatar’s height, redrawn with more cells at the same pixel size.
 */
export const FULL_AT_SECONDS = 15 * 60 * 60;

/** True when `value` is one of the three stages. */
export function isPetStage(value: unknown): value is PetStage {
  return (
    typeof value === "string" &&
    (PET_STAGES as readonly string[]).includes(value)
  );
}

/**
 * Stage for a total of completed focus seconds.
 *
 * Junk input (NaN, negative, missing) is young — that's 0 hours, not a
 * reason to skip to full. The server is what stops a client from sending
 * `'full'` and getting it.
 */
export function petStageAt(focusSeconds: unknown): PetStage {
  const s = Number(focusSeconds);
  if (!Number.isFinite(s) || s < GROWN_AT_SECONDS) return "young";
  if (s < FULL_AT_SECONDS) return "grown";
  return "full";
}
