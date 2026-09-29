import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDay, useLocalDay } from "./useDailyFocusGoal";

afterEach(() => vi.useRealTimers());

describe("local focus day", () => {
  it("formats the local calendar date", () => {
    expect(localDay(new Date(2026, 8, 29, 23, 59))).toBe("2026-09-29");
  });
  it("rolls over at local midnight while Home stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 23, 59, 59));
    const { result } = renderHook(() => useLocalDay());
    expect(result.current).toBe("2026-09-29");
    act(() => vi.advanceTimersByTime(1100));
    expect(result.current).toBe("2026-09-30");
  });
  it("catches up when the tab returns after sleep", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 12));
    const { result } = renderHook(() => useLocalDay());
    vi.setSystemTime(new Date(2026, 8, 30, 12));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current).toBe("2026-09-30");
  });
});
