import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMER_PREFS,
  normalizeTimerPrefs,
  readTimerPrefs,
  writeTimerPrefs,
} from "./timerPrefs";

const KEY = "duodoro-timer-prefs";

beforeEach(() => {
  localStorage.clear();
});

describe("normalizeTimerPrefs", () => {
  it("keeps a valid preference set unchanged", () => {
    expect(normalizeTimerPrefs({ mode: "flow", focus: 50, break: 10 })).toEqual({
      mode: "flow",
      focus: 50,
      break: 10,
    });
  });

  it("falls back entirely when there is nothing to read", () => {
    for (const raw of [null, undefined, 0, "", "pomodoro", [], true]) {
      expect(normalizeTimerPrefs(raw)).toEqual(DEFAULT_TIMER_PREFS);
    }
  });

  it("replaces only the fields that are unusable", () => {
    // A number that is merely out of range is clamped; a field of the wrong
    // *type* falls back. Neither should discard the fields that are fine.
    expect(normalizeTimerPrefs({ mode: "flow", focus: 999, break: 10 })).toEqual({
      mode: "flow",
      focus: 120,
      break: 10,
    });
  });

  it("rejects an unknown mode rather than passing it through", () => {
    expect(normalizeTimerPrefs({ mode: "stopwatch" }).mode).toBe("pomodoro");
  });

  it("clamps out-of-range values to the sliders' bounds", () => {
    expect(normalizeTimerPrefs({ focus: 1 }).focus).toBe(5);
    expect(normalizeTimerPrefs({ focus: 100000 }).focus).toBe(120);
    expect(normalizeTimerPrefs({ break: 0 }).break).toBe(1);
    expect(normalizeTimerPrefs({ break: 45 }).break).toBe(30);
  });

  it("snaps focus to its step and break to whole minutes", () => {
    // The slider moves in 5s for focus. A stored 33 is not reachable from the
    // UI, so it must not become the value the timer counts down.
    expect(normalizeTimerPrefs({ focus: 33 }).focus).toBe(35);
    expect(normalizeTimerPrefs({ break: 7.4 }).break).toBe(7);
  });

  it("refuses NaN and Infinity instead of putting them on the timer", () => {
    // `Math.min`/`Math.max` propagate NaN, so a naive clamp would hand NaN to
    // the countdown and to the payload the partner receives.
    expect(normalizeTimerPrefs({ focus: NaN }).focus).toBe(25);
    expect(normalizeTimerPrefs({ focus: Infinity }).focus).toBe(25);
    expect(normalizeTimerPrefs({ focus: "50" }).focus).toBe(25);
  });
});

describe("readTimerPrefs and writeTimerPrefs", () => {
  it("returns the defaults with nothing stored", () => {
    expect(readTimerPrefs()).toEqual(DEFAULT_TIMER_PREFS);
  });

  it("round-trips what was written", () => {
    writeTimerPrefs({ mode: "flow", focus: 50, break: 10 });
    expect(readTimerPrefs()).toEqual({ mode: "flow", focus: 50, break: 10 });
  });

  it("merges a partial write with what is already stored", () => {
    writeTimerPrefs({ mode: "flow", focus: 50, break: 10 });
    writeTimerPrefs({ break: 15 });
    // Changing the break must not reset the mode or the focus length.
    expect(readTimerPrefs()).toEqual({ mode: "flow", focus: 50, break: 15 });
  });

  it("survives corrupt JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readTimerPrefs()).toEqual(DEFAULT_TIMER_PREFS);
  });

  it("normalizes what it reads back, not just what it writes", () => {
    // A value could have been written by an older version with wider bounds.
    localStorage.setItem(KEY, JSON.stringify({ mode: "flow", focus: 9000 }));
    expect(readTimerPrefs()).toEqual({ mode: "flow", focus: 120, break: 5 });
  });

  it("does not throw when storage is unavailable", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    // A full or blocked storage is not fatal — the choice still holds for the
    // page's lifetime, which is the behaviour every other stored preference has.
    expect(() => writeTimerPrefs({ focus: 50 })).not.toThrow();
    setItem.mockRestore();
  });

  it("returns defaults on the server, where there is no storage", () => {
    // The hook reads through useState's lazy initialiser, which runs during
    // render — including Next's server render. Touching localStorage there
    // would throw.
    const windowSpy = vi.spyOn(globalThis, "window", "get");
    // @ts-expect-error — simulate the server, where `window` is not defined.
    windowSpy.mockReturnValue(undefined);
    expect(readTimerPrefs()).toEqual(DEFAULT_TIMER_PREFS);
    expect(() => writeTimerPrefs({ focus: 50 })).not.toThrow();
    windowSpy.mockRestore();
  });
});
