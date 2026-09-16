import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// The timer preferences are read once when the hook mounts and written when the
// HUD changes them. What matters is that the two ends agree: a stored value
// must reach the timer, and a change must outlive the page.

vi.mock("socket.io-client", () => ({
  io: () => ({
    id: "sock-1",
    connected: false,
    auth: {},
    on: () => {},
    off: () => {},
    once: () => {},
    emit: () => {},
    disconnect: () => {},
    connect: () => {},
    io: { on: () => {}, off: () => {} },
  }),
  Socket: class {},
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "tok" } } }),
    },
  }),
}));

vi.mock("@/lib/sounds", () => ({ playSound: () => {} }));

import { useGameSession } from "./useGameSession";

const KEY = "duodoro-timer-prefs";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("useGameSession timer preferences", () => {
  it("opens with the documented defaults when nothing is stored", () => {
    const { result } = renderHook(() => useGameSession(null));

    expect(result.current.timerMode).toBe("pomodoro");
    expect(result.current.focusDuration).toBe(25);
    expect(result.current.breakDuration).toBe(5);
  });

  it("opens with the stored preferences", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ mode: "flow", focus: 50, break: 10 }),
    );
    const { result } = renderHook(() => useGameSession(null));

    // This is the whole point of the change: a Flowmodoro user and their 50/10
    // must survive a reload instead of resetting to 25/5 pomodoro.
    expect(result.current.timerMode).toBe("flow");
    expect(result.current.focusDuration).toBe(50);
    expect(result.current.breakDuration).toBe(10);
  });

  it("does not write back the value it just read on mount", () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: "flow", focus: 50, break: 10 }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    renderHook(() => useGameSession(null));

    // An effect that persists would fire on mount and rewrite the same value —
    // harmless here, but it would also overwrite a value the read path
    // normalized, turning a repaired setting into a silent migration.
    expect(setItem).not.toHaveBeenCalled();
  });

  it("persists each preference as it is changed", () => {
    const { result } = renderHook(() => useGameSession(null));

    act(() => result.current.setTimerMode("flow"));
    act(() => result.current.setFocusDuration(45));
    act(() => result.current.setBreakDuration(15));

    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      mode: "flow",
      focus: 45,
      break: 15,
    });
  });

  it("updates in-memory state as well as storage", () => {
    const { result } = renderHook(() => useGameSession(null));

    act(() => result.current.setFocusDuration(45));

    // Storage alone would leave the HUD showing the old number until reload.
    expect(result.current.focusDuration).toBe(45);
  });

  it("keeps a change made in one mount when the next mounts", () => {
    const first = renderHook(() => useGameSession(null));
    act(() => first.result.current.setTimerMode("flow"));
    act(() => first.result.current.setBreakDuration(20));
    first.unmount();

    const second = renderHook(() => useGameSession(null));

    // Two mounts of the same hook stand in for a reload: the second has to
    // open where the first left off, with the untouched focus length intact.
    expect(second.result.current.timerMode).toBe("flow");
    expect(second.result.current.breakDuration).toBe(20);
    expect(second.result.current.focusDuration).toBe(25);
  });

  it("falls back to defaults rather than an unusable stored value", () => {
    localStorage.setItem(KEY, JSON.stringify({ mode: "flow", focus: "lots" }));
    const { result } = renderHook(() => useGameSession(null));

    // A corrupt field must not reach the timer, and must not discard the field
    // that was readable.
    expect(result.current.focusDuration).toBe(25);
    expect(result.current.timerMode).toBe("flow");
  });
});
