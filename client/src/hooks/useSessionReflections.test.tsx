import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: fake.from, rpc: fake.rpc }) }));

import {
  deleteSessionReflection,
  loadSessionReflections,
  resetSessionReflectionStore,
  retainReflectionAccount,
  saveSessionReflection,
  useLoadSessionReflections,
  useSessionReflection,
} from "./useSessionReflections";

type ReadRequest = { userId: string; ids: string[]; resolve: (value: unknown) => void; reject: (error: unknown) => void };
const reads: ReadRequest[] = [];

function row(sessionId: string, userId: string, text: string, version = 1) {
  return { session_id: sessionId, user_id: userId, reflection_text: text, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", version };
}

beforeEach(() => {
  reads.length = 0;
  fake.from.mockReset();
  fake.rpc.mockReset();
  resetSessionReflectionStore();
  fake.from.mockImplementation(() => ({
    select: () => ({
      eq: (_column: string, userId: string) => ({
        in: (_column2: string, ids: string[]) => new Promise((resolve, reject) => reads.push({ userId, ids, resolve, reject })),
      }),
    }),
  }));
});
afterEach(() => { vi.restoreAllMocks(); });

function answer(index: number, data: unknown, error: unknown = null) {
  reads[index].resolve({ data, error });
}

describe("bounded reads", () => {
  it("reads in batches of at most 50 sessions rather than one request per round or one huge IN list", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `s${index}`);
    const pending = loadSessionReflections("alice", ids);
    // Chunks run one after another, so each request appears only after the previous one settles.
    for (const expected of [1, 2, 3]) {
      await waitFor(() => expect(reads).toHaveLength(expected));
      answer(expected - 1, []);
    }
    await pending;
    expect(reads.map(read => read.ids.length)).toEqual([50, 50, 20]);
    expect(new Set(reads.flatMap(read => read.ids)).size).toBe(120);
  });

  it("separates a successful empty result from a failed read", async () => {
    const { result } = renderHook(() => { useLoadSessionReflections("alice", ["s1", "s2"]); return { a: useSessionReflection("alice", "s1"), b: useSessionReflection("alice", "s2") }; });
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, [row("s1", "alice", "kept")]);
    await waitFor(() => expect(result.current.a?.status).toBe("ready"));
    expect(result.current.a?.reflection?.text).toBe("kept");
    expect(result.current.b).toMatchObject({ status: "ready", reflection: null });
  });

  it("shows a failed read as an error instead of an empty note", async () => {
    const { result } = renderHook(() => { useLoadSessionReflections("alice", ["s1"]); return useSessionReflection("alice", "s1"); });
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, null, { message: "Unavailable" });
    await waitFor(() => expect(result.current?.status).toBe("error"));
    expect(result.current?.reflection).toBeNull();
  });

  it("treats rows for another owner or an unrequested session as a failed read", async () => {
    const { result } = renderHook(() => { useLoadSessionReflections("alice", ["s1"]); return useSessionReflection("alice", "s1"); });
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, [row("s1", "bob", "not yours")]);
    await waitFor(() => expect(result.current?.status).toBe("error"));
    expect(result.current?.reflection).toBeNull();
  });
});

describe("account and ordering safety", () => {
  it("lets the newest response win when an older read resolves last", async () => {
    const first = loadSessionReflections("alice", ["s1"]);
    const second = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(2));
    answer(1, [row("s1", "alice", "new", 2)]);
    await second;
    answer(0, [row("s1", "alice", "old", 1)]);
    await first;
    const { result } = renderHook(() => useSessionReflection("alice", "s1"));
    expect(result.current?.reflection).toMatchObject({ text: "new", version: 2 });
  });

  it("never lets an old account's response affect the current account", async () => {
    const old = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(1));
    retainReflectionAccount("bob");
    answer(0, [row("s1", "alice", "alice private")]);
    await old;
    const alice = renderHook(() => useSessionReflection("bob", "s1"));
    expect(alice.result.current).toBeUndefined();
    const nothingForBob = renderHook(() => useSessionReflection("alice", "s1"));
    expect(nothingForBob.result.current).toBeUndefined();
  });

  it("drops another account's cached entries when the account changes", async () => {
    const pending = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, [row("s1", "alice", "alice note")]);
    await pending;
    retainReflectionAccount("bob");
    const { result } = renderHook(() => useSessionReflection("alice", "s1"));
    expect(result.current).toBeUndefined();
  });

  it("does not persist note text to any browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const pending = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, [row("s1", "alice", "private words")]);
    await pending;
    fake.rpc.mockResolvedValueOnce({ data: [row("s1", "alice", "more private words", 2)], error: null });
    await saveSessionReflection("alice", "s1", "more private words", 1);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("writes", () => {
  it("creates only from a confirmed server row for the same session and owner", async () => {
    const pending = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, []);
    await pending;
    fake.rpc.mockResolvedValueOnce({ data: [row("s1", "alice", "Saved text", 1)], error: null });
    const result = await saveSessionReflection("alice", "s1", "Saved text", null);
    expect(fake.rpc).toHaveBeenCalledWith("create_session_reflection", { p_session_id: "s1", p_text: "Saved text" });
    expect(result).toMatchObject({ ok: true, reflection: { text: "Saved text", version: 1 } });
  });

  it("treats a zero-row or mismatched response as unconfirmed, not saved", async () => {
    const pending = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, [row("s1", "alice", "stale", 1)]);
    await pending;
    fake.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await saveSessionReflection("alice", "s1", "x", 1)).toMatchObject({ ok: false, failure: { kind: "unconfirmed" } });
    fake.rpc.mockResolvedValueOnce({ data: [row("other", "alice", "x", 2)], error: null });
    expect(await saveSessionReflection("alice", "s1", "x", 1)).toMatchObject({ ok: false, failure: { kind: "unconfirmed" } });
    const { result } = renderHook(() => useSessionReflection("alice", "s1"));
    expect(result.current?.reflection?.text).toBe("stale");
    expect(result.current?.pending).toBeNull();
  });

  it("reports a version conflict and keeps the saved text it already had", async () => {
    const pending = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, [row("s1", "alice", "server", 3)]);
    await pending;
    fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "Reflection changed elsewhere" } });
    const result = await saveSessionReflection("alice", "s1", "mine", 1);
    expect(result).toMatchObject({ ok: false, failure: { kind: "changed" } });
    const { result: entry } = renderHook(() => useSessionReflection("alice", "s1"));
    expect(entry.current?.reflection).toMatchObject({ text: "server", version: 3 });
  });

  it("ignores a second submission while one is in flight", async () => {
    const pending = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, [row("s1", "alice", "v1", 1)]);
    await pending;
    let finish!: (value: unknown) => void;
    fake.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = saveSessionReflection("alice", "s1", "v2", 1);
    const second = await saveSessionReflection("alice", "s1", "v3", 1);
    expect(second).toMatchObject({ ok: false });
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    finish({ data: [row("s1", "alice", "v2", 2)], error: null });
    expect(await first).toMatchObject({ ok: true, reflection: { version: 2 } });
  });

  it("deletes only the confirmed version and reports zero rows as a failure", async () => {
    const pending = loadSessionReflections("alice", ["s1"]);
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, [row("s1", "alice", "bye", 2)]);
    await pending;
    fake.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await deleteSessionReflection("alice", "s1", 2)).toMatchObject({ ok: false, failure: { kind: "unconfirmed" } });
    fake.rpc.mockResolvedValueOnce({ data: [{ session_id: "s1", user_id: "alice", deleted_version: 2 }], error: null });
    expect(await deleteSessionReflection("alice", "s1", 2)).toEqual({ ok: true });
    const { result } = renderHook(() => useSessionReflection("alice", "s1"));
    expect(result.current?.reflection).toBeNull();
  });
});

describe("refresh lifecycle", () => {
  it("refreshes visible sessions on focus or tab return and removes listeners on unmount", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useLoadSessionReflections("alice", ["s1"]));
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, []);
    await waitFor(() => expect(reads).toHaveLength(1));
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(reads).toHaveLength(2));
    unmount();
    expect(remove).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(add.mock.calls.filter(([type]) => type === "focus")).toHaveLength(1);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(reads).toHaveLength(2);
  });

  it("does not refresh while the page is hidden", async () => {
    renderHook(() => useLoadSessionReflections("alice", ["s1"]));
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, []);
    await waitFor(() => expect(reads).toHaveLength(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      expect(reads).toHaveLength(1);
    } finally {
      delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    }
  });

  it("loads only sessions that are not already cached when the visible rounds grow", async () => {
    const { rerender } = renderHook(({ ids }) => useLoadSessionReflections("alice", ids), { initialProps: { ids: ["s1"] } });
    await waitFor(() => expect(reads).toHaveLength(1));
    answer(0, []);
    rerender({ ids: ["s1", "s2"] });
    await waitFor(() => expect(reads).toHaveLength(2));
    expect(reads[1].ids).toEqual(["s2"]);
  });
});

it("does not let a late mutation response overwrite a newer read", async () => {
  const initial = loadSessionReflections("alice", ["s1"]); answer(0, [row("s1", "alice", "v1", 1)]); await initial;
  let finish!: (value: unknown) => void;
  fake.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const saving = saveSessionReflection("alice", "s1", "v2", 1);
  const refreshing = loadSessionReflections("alice", ["s1"]); answer(1, [row("s1", "alice", "v3", 3)]); await refreshing;
  finish({ data: [row("s1", "alice", "v2", 2)], error: null }); await saving;
  const { result } = renderHook(() => useSessionReflection("alice", "s1"));
  expect(result.current?.reflection?.version).toBe(3);
  expect(result.current?.pending).toBeNull();
});
it.each(["save", "delete"] as const)("releases pending state and allows retry after rejected %s transport", async kind => {
  const initial = loadSessionReflections("alice", ["s1"]); answer(0, [row("s1", "alice", "v1", 1)]); await initial;
  fake.rpc.mockRejectedValueOnce(new Error("transport rejected"));
  const mutate = () => kind === "save" ? saveSessionReflection("alice", "s1", "v2", 1) : deleteSessionReflection("alice", "s1", 1);
  const outcome = await mutate().catch(() => ({ threw: true }));
  expect(outcome).toMatchObject({ ok: false });
  const { result } = renderHook(() => useSessionReflection("alice", "s1"));
  expect(result.current?.pending).toBeNull();
  fake.rpc.mockResolvedValueOnce({ data: kind === "save" ? [row("s1", "alice", "v2", 2)] : [{ session_id: "s1", user_id: "alice", deleted_version: 1 }], error: null });
  await act(async () => { expect(await mutate()).toMatchObject({ ok: true }); });
});
it("ignores pre-reset responses after the same account loads again", async () => {
  const old = loadSessionReflections("alice", ["s1"]);
  resetSessionReflectionStore();
  const newer = loadSessionReflections("alice", ["s1"]);
  answer(1, [row("s1", "alice", "new", 3)]); await newer;
  answer(0, [row("s1", "alice", "old", 1)]); await old;
  const { result } = renderHook(() => useSessionReflection("alice", "s1"));
  expect(result.current?.reflection?.version).toBe(3);
});
