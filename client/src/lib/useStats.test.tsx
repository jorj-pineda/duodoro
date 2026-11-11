import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// One rpc mock for all four calls useStats fires in parallel.
let rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ rpc: (fn: string) => rpc(fn) }),
}));

import { useStats } from "./useStats";

const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const okRow = {
  total_focus_time: "9000",
  weekly_focus_time: "3600",
  sessions_completed: "12",
  current_streak: "40",
  longest_streak: "40",
  avg_session_length: "750",
};

const succeed = () => {
  rpc = async (fn) => ({
    data: fn === "get_focus_stats" ? [okRow] : [],
    error: null,
  });
};

const fail = (message = "network is down") => {
  rpc = async () => ({ data: null, error: Object.assign(new Error(message)) });
};

// The module keeps a 30s cache and an in-flight map keyed by userId, shared
// across every mount. Each test needs its own key or it inherits the last
// test's result.
let seq = 0;
const freshUser = () => `${USER}-${seq++}`;

describe("useStats failure reporting", () => {
  beforeEach(() => {
    succeed();
  });

  it("reports real numbers on success", async () => {
    const id = freshUser();
    const { result } = renderHook(() => useStats(id));
    await act(async () => {
      await result.current.fetchStats();
    });
    expect(result.current.personalStats?.currentStreak).toBe(40);
    expect(result.current.error).toBeNull();
    expect(result.current.loaded).toBe(true);
  });

  // The bug: a failed load left the snapshot EMPTY and said nothing, so callers
  // rendered "Streak 0d" — identical to a brand-new account.
  it("surfaces an error rather than silently reporting nothing", async () => {
    fail("infinite recursion detected in policy");
    const id = freshUser();
    const { result } = renderHook(() => useStats(id));
    await act(async () => {
      await result.current.fetchStats();
    });
    expect(result.current.error).toBe("infinite recursion detected in policy");
  });

  // This is the flag that lets the UI refuse to draw zeros. Without it there is
  // no way to tell "fetched, genuinely empty" from "never loaded".
  it("does not mark itself loaded when the fetch failed", async () => {
    fail();
    const id = freshUser();
    const { result } = renderHook(() => useStats(id));
    await act(async () => {
      await result.current.fetchStats();
    });
    expect(result.current.loaded).toBe(false);
    expect(result.current.personalStats).toBeNull();
  });

  it("is loaded with null stats for a genuinely empty account", async () => {
    rpc = async () => ({ data: [], error: null });
    const id = freshUser();
    const { result } = renderHook(() => useStats(id));
    await act(async () => {
      await result.current.fetchStats();
    });
    // Same personalStats as the failure case — hence the need for `loaded`.
    expect(result.current.personalStats).toBeNull();
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("recovers on retry and clears the error", async () => {
    const id = freshUser();
    fail();
    const { result } = renderHook(() => useStats(id));
    await act(async () => {
      await result.current.fetchStats();
    });
    expect(result.current.error).toBeTruthy();

    succeed();
    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.personalStats?.currentStreak).toBe(40);
    expect(result.current.loaded).toBe(true);
  });

  it("stops loading after a failure so the UI isn't stuck on a spinner", async () => {
    fail();
    const id = freshUser();
    const { result } = renderHook(() => useStats(id));
    await act(async () => {
      await result.current.fetchStats();
    });
    expect(result.current.loading).toBe(false);
  });
});

function deferredSnapshot() {
  let resolve!: (row: { data: unknown; error: unknown }) => void;
  const pending = new Promise<{ data: unknown; error: unknown }>(done => { resolve = done; });
  return {
    rpc: (fn: string) => fn === "get_focus_stats" ? pending : Promise.resolve({ data: [], error: null }),
    succeed: (seconds: number) => resolve({ data: [{ ...okRow, total_focus_time: seconds }], error: null }),
    fail: () => resolve({ data: null, error: new Error("latest failed") }),
  };
}

describe("useStats request ordering", () => {
  it.each(["success", "error"])("ignores an older %s after the latest success, including in shared cache", async outcome => {
    const id = freshUser(); const old = deferredSnapshot(); const latest = deferredSnapshot();
    const { result } = renderHook(() => useStats(id));
    rpc = old.rpc; let first!: Promise<void>; act(() => { first = result.current.fetchStats(true); });
    rpc = latest.rpc; let second!: Promise<void>; act(() => { second = result.current.fetchStats(true); });
    await act(async () => { latest.succeed(200); await second; });
    await act(async () => { if (outcome === "success") old.succeed(100); else old.fail(); await first; });
    expect(result.current.personalStats?.totalFocusTime).toBe(200); expect(result.current.error).toBeNull();
    const other = renderHook(() => useStats(id));
    await act(async () => { await other.result.current.fetchStats(); });
    expect(other.result.current.personalStats?.totalFocusTime).toBe(200);
  });

  it("keeps the latest error when an older success arrives afterward", async () => {
    const id = freshUser(); const old = deferredSnapshot(); const latest = deferredSnapshot();
    const { result } = renderHook(() => useStats(id));
    rpc = old.rpc; let first!: Promise<void>; act(() => { first = result.current.fetchStats(true); });
    rpc = latest.rpc; let second!: Promise<void>; act(() => { second = result.current.fetchStats(true); });
    await act(async () => { latest.fail(); await second; });
    await act(async () => { old.succeed(100); await first; });
    expect(result.current.error).toBe("latest failed"); expect(result.current.loaded).toBe(false);
    expect(result.current.personalStats).toBeNull();
  });

  it("does not clear newer loading or its shared in-flight entry when an older request finishes", async () => {
    const id = freshUser(); const old = deferredSnapshot(); const latest = deferredSnapshot();
    const firstView = renderHook(() => useStats(id)); const secondView = renderHook(() => useStats(id));
    rpc = old.rpc; let first!: Promise<void>; act(() => { first = firstView.result.current.fetchStats(true); });
    const calls = vi.fn(latest.rpc); rpc = calls;
    let second!: Promise<void>; act(() => { second = firstView.result.current.fetchStats(true); });
    await act(async () => { old.succeed(100); await Promise.resolve(); });
    expect(firstView.result.current.loading).toBe(true);
    let third!: Promise<void>; act(() => { third = secondView.result.current.fetchStats(); });
    expect(calls).toHaveBeenCalledTimes(4);
    await act(async () => { latest.succeed(200); await Promise.all([first, second, third]); });
    expect(firstView.result.current.personalStats?.totalFocusTime).toBe(200);
    expect(secondView.result.current.personalStats?.totalFocusTime).toBe(200);
    expect(firstView.result.current.loading).toBe(false);
  });

  it("clears displayed data on account changes and ignores the old account response", async () => {
    const alice = freshUser(); const bob = freshUser(); const old = deferredSnapshot();
    const { result, rerender } = renderHook(({ id }) => useStats(id), { initialProps: { id: alice } });
    succeed(); await act(async () => { await result.current.fetchStats(); });
    rpc = old.rpc; let first!: Promise<void>; act(() => { first = result.current.fetchStats(true); });
    rerender({ id: bob });
    expect(result.current.personalStats).toBeNull(); expect(result.current.loaded).toBe(false);
    expect(result.current.loading).toBe(false); expect(result.current.error).toBeNull();
    await act(async () => { old.succeed(100); await first; });
    expect(result.current.personalStats).toBeNull(); expect(result.current.loaded).toBe(false);
  });

  it("does not reuse a request or cache after its last account consumer unmounts", async () => {
    const id = freshUser(); const old = deferredSnapshot();
    const firstView = renderHook(() => useStats(id)); rpc = old.rpc;
    let first!: Promise<void>; act(() => { first = firstView.result.current.fetchStats(); });
    firstView.unmount();
    await act(async () => { old.succeed(100); await first; });
    const secondView = renderHook(() => useStats(id));
    const calls = vi.fn(async (fn: string) => ({ data: fn === "get_focus_stats" ? [{ ...okRow, total_focus_time: 200 }] : [], error: null })); rpc = calls;
    await act(async () => { await secondView.result.current.fetchStats(); });
    expect(calls).toHaveBeenCalledTimes(4);
    expect(secondView.result.current.personalStats?.totalFocusTime).toBe(200);
  });
});


it("keeps other consumers waiting for a forced refresh and preserves sharing when one unmounts", async () => {
  const id = freshUser(); const old = deferredSnapshot(); const latest = deferredSnapshot();
  const firstView = renderHook(() => useStats(id)); const secondView = renderHook(() => useStats(id));
  rpc = old.rpc; let first!: Promise<void>; act(() => { first = firstView.result.current.fetchStats(); });
  rpc = latest.rpc; let second!: Promise<void>; act(() => { second = secondView.result.current.fetchStats(true); });
  await act(async () => { old.succeed(100); await Promise.resolve(); });
  expect(firstView.result.current.loading).toBe(true); expect(firstView.result.current.loaded).toBe(false);
  secondView.unmount();
  await act(async () => { latest.succeed(200); await Promise.all([first, second]); });
  expect(firstView.result.current.personalStats?.totalFocusTime).toBe(200); expect(firstView.result.current.loading).toBe(false);
  const thirdView = renderHook(() => useStats(id)); const calls = vi.fn(latest.rpc); rpc = calls;
  await act(async () => { await thirdView.result.current.fetchStats(); });
  expect(calls).not.toHaveBeenCalled(); expect(thirdView.result.current.personalStats?.totalFocusTime).toBe(200);
});


it("joins an active refresh instead of returning an older still-valid cache", async () => {
  const id = freshUser(); succeed(); const firstView = renderHook(() => useStats(id));
  await act(async () => { await firstView.result.current.fetchStats(); });
  const latest = deferredSnapshot(); const calls = vi.fn(latest.rpc); rpc = calls;
  let first!: Promise<void>; act(() => { first = firstView.result.current.fetchStats(true); });
  const secondView = renderHook(() => useStats(id)); let second!: Promise<void>;
  act(() => { second = secondView.result.current.fetchStats(); });
  expect(secondView.result.current.loading).toBe(true); expect(secondView.result.current.loaded).toBe(false);
  expect(calls).toHaveBeenCalledTimes(4);
  await act(async () => { latest.succeed(200); await Promise.all([first, second]); });
  expect(secondView.result.current.personalStats?.totalFocusTime).toBe(200);
});
