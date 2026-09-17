// ─────────────────────────────────────────────────────────────────────────────
// Timer preferences — the mode and durations the session HUD starts from.
//
// These lived in `useGameSession` state with nothing behind them, so every
// reload silently reset a Flowmodoro user to pomodoro and everyone's 50/10 back
// to 25/5. They are stored beside the other browser-held choices (theme, mute,
// session resume) rather than on the profile, because they describe this
// browser's habit, not the account: setting 50 minutes on a laptop should not
// change what a phone opens to.
//
// ── Validated on read, not trusted ──────────────────────────────────────────
// localStorage is user-writable and survives upgrades, so a stored value can be
// anything: a string, a float, a value from an older version with wider bounds.
// Anything unusable falls back to the default rather than reaching the timer,
// because a bad duration here is a session the *other person* has to live with
// — the server clamps the payload too, but the two disagreeing would show one
// duration on screen and count down another.
//
// The bounds are the sliders' own (`SessionHUD.tsx`), kept here so the read
// path and the UI agree. They are deliberately not the server's wider limits:
// the server accepts up to 120m focus / 60m break to allow future presets, and
// clamping a stored value to a range the UI cannot produce would be a setting
// the user could never change back.
// ─────────────────────────────────────────────────────────────────────────────

export type TimerMode = "pomodoro" | "flow";

export interface TimerPrefs {
  mode: TimerMode;
  /** Focus length in whole minutes. */
  focus: number;
  /** Break length in whole minutes. */
  break: number;
}

export const FOCUS_MIN = 5;
export const FOCUS_MAX = 120;
export const FOCUS_STEP = 5;
export const BREAK_MIN = 1;
export const BREAK_MAX = 30;

export const DEFAULT_TIMER_PREFS: TimerPrefs = {
  mode: "pomodoro",
  focus: 25,
  break: 5,
};

const STORAGE_KEY = "duodoro-timer-prefs";

/**
 * Constrain a number to a slider's range, snapped to its step.
 *
 * Returns the fallback when the input is not a usable number at all — `NaN`,
 * `Infinity`, `null` — rather than letting `Math.min`/`Math.max` hand back
 * `NaN` and putting it on the timer.
 */
function clampInt(
  value: unknown,
  min: number,
  max: number,
  step: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/** Narrow one stored blob to a usable preference set. */
export function normalizeTimerPrefs(raw: unknown): TimerPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TIMER_PREFS };
  const source = raw as Partial<Record<keyof TimerPrefs, unknown>>;
  return {
    mode:
      source.mode === "flow" || source.mode === "pomodoro"
        ? source.mode
        : DEFAULT_TIMER_PREFS.mode,
    focus: clampInt(
      source.focus,
      FOCUS_MIN,
      FOCUS_MAX,
      FOCUS_STEP,
      DEFAULT_TIMER_PREFS.focus,
    ),
    break: clampInt(
      source.break,
      BREAK_MIN,
      BREAK_MAX,
      1,
      DEFAULT_TIMER_PREFS.break,
    ),
  };
}

/**
 * The preferences to open with.
 *
 * SSR-safe: there is no storage on the server, so the defaults come back and the
 * client corrects them on the first render after hydration. `useState` is lazy
 * on the client, so this reads once rather than on every render.
 */
export function readTimerPrefs(): TimerPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_TIMER_PREFS };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_TIMER_PREFS };
    return normalizeTimerPrefs(JSON.parse(stored));
  } catch {
    // Unparseable, or storage blocked in private mode — defaults are correct.
    return { ...DEFAULT_TIMER_PREFS };
  }
}

/** Persist the current values. Never throws; a full quota is not fatal. */
export function writeTimerPrefs(prefs: Partial<TimerPrefs>): void {
  if (typeof window === "undefined") return;
  try {
    const merged = { ...readTimerPrefs(), ...prefs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Storage unavailable — the choice still holds for this page's lifetime.
  }
}
