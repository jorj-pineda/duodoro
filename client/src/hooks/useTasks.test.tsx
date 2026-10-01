import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const task = (id: string, isDone: boolean) => ({
  id,
  owner_id: OWNER,
  room_code: null,
  content: id,
  is_done: isDone,
  is_shared: false,
  created_at: "2026-01-01T00:00:00Z",
  completed_by: null,
});

function createFakeSupabase() {
  const results: Record<string, Result> = {
    select: {
      data: [task("pending", false), task("deleted", true), task("refused", true)],
      error: null,
    },
    delete: { data: [{ id: "deleted" }], error: null },
  };

  const reads: unknown[][] = [];
  const pendingReads: Promise<Result>[] = [];
  let change: () => void = () => {};
  let subscribed: (status: string) => void = () => {};
  const channel = {
    on: vi.fn((_event: string, _filter: unknown, callback: () => void) => { change = callback; return channel; }),
    subscribe: vi.fn((callback: (status: string) => void) => { subscribed = callback; return channel; }),
  };
  const updates: { values: unknown; filters: unknown[] }[] = [];
  const builder = (kind: string, filters: unknown[] = []) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    for (const method of ["select", "eq", "is", "order", "in", "single"]) {
      chain[method] = (...args: unknown[]) => {
        if (method === "eq" || method === "is") filters.push([method, ...args]);
        return chain;
      };
    }
    chain.then = (
      resolve: (value: Result) => unknown,
      reject?: (error: unknown) => unknown,
    ) => {
      if (kind === "select") reads.push(filters);
      return Promise.resolve(kind === "select" && pendingReads.length ? pendingReads.shift()! : results[kind]).then(resolve, reject);
    };
    return chain;
  };

  return {
    results,
    updates,
    reads,
    pendingReads,
    channel,
    change: () => change(),
    subscribed: () => subscribed("SUBSCRIBED"),
    sb: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
      from: () => ({
        select: () => builder("select"),
        delete: () => builder("delete"),
        insert: () => builder("insert"),
        update: (values: unknown) => {
          const filters: unknown[] = [];
          updates.push({ values, filters });
          return builder("update", filters);
        },
      }),
    },
  };
}

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase", () => ({ getSupabase: () => fake.sb }));

import { useTasks } from "./useTasks";

describe("useTasks bulk deletion", () => {
  beforeEach(() => {
    fake = createFakeSupabase();
  });

  it("removes only completed task ids returned by the database", async () => {
    const hook = renderHook(() => useTasks(OWNER));
    await waitFor(() => expect(hook.result.current.tasks).toHaveLength(3));

    await act(async () => {
      await hook.result.current.clearCompleted();
    });

    expect(hook.result.current.tasks.map(({ id }) => id)).toEqual([
      "pending",
      "refused",
    ]);
    expect(hook.result.current.error).toMatch(/clear all completed tasks/i);
  });
});


describe("useTasks editing", () => {
  beforeEach(() => { fake = createFakeSupabase(); });

  async function mount() {
    const hook = renderHook(() => useTasks(OWNER));
    await waitFor(() => expect(hook.result.current.tasks).toHaveLength(3));
    return hook;
  }

  it("writes trimmed content only and preserves completed goal state", async () => {
    fake.results.update = { data: [{ id: "deleted", content: "Returned text" }], error: null };
    const hook = await mount();
    let error;
    await act(async () => { error = await hook.result.current.editTask("deleted", "  Edited goal  "); });
    expect(error).toBeNull();
    expect(fake.updates).toEqual([{ values: { content: "Edited goal" }, filters: [
      ["eq", "id", "deleted"], ["eq", "owner_id", OWNER], ["is", "room_code", null],
    ] }]);
    expect(hook.result.current.completedTasks.find((row) => row.id === "deleted"))
      .toMatchObject({ content: "Returned text", is_done: true, completed_by: null });
  });

  it.each([
    { data: [], error: null },
    { data: null, error: { code: "42501" } },
    { data: [{ id: "another-row", content: "Wrong goal" }], error: null },
  ])("keeps the original text on a refused or failed save: %j", async (result) => {
    fake.results.update = result;
    const hook = await mount();
    let error;
    await act(async () => { error = await hook.result.current.editTask("pending", "New draft"); });
    expect(error).toMatch(/Couldn't save/);
    expect(hook.result.current.tasks[0].content).toBe("pending");
  });

  it("rejects unknown goals and invalid drafts without a mutation", async () => {
    const hook = await mount();
    expect(await hook.result.current.editTask("unknown", "text")).toMatch(/own goals/);
    expect(await hook.result.current.editTask("pending", " ")).toMatch(/500 characters/);
    expect(await hook.result.current.editTask("pending", "x".repeat(501))).toMatch(/500 characters/);
    expect(fake.updates).toEqual([]);
  });
});


describe("Home goal synchronization", () => {
  beforeEach(() => {
    fake = createFakeSupabase();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  async function mount() {
    const hook = renderHook(() => useTasks(OWNER));
    await waitFor(() => expect(hook.result.current.tasks).toHaveLength(3));
    return hook;
  }

  it("refreshes goals when Home regains focus", async () => {
    const hook = await mount();
    fake.results.select = { data: [{ ...task("pending", true), content: "Edited in another tab" }], error: null };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(hook.result.current.tasks).toHaveLength(1);
    expect(hook.result.current.completedTasks[0].content).toBe("Edited in another tab");
  });

  it("subscribes only to this owner and catches up on live changes and reconnect", async () => {
    const hook = await mount();
    expect(fake.channel.on.mock.calls[0][1]).toEqual({ event: "*", schema: "public", table: "tasks", filter: `owner_id=eq.${OWNER}` });
    expect(fake.reads[0]).toContainEqual(["eq", "owner_id", OWNER]);
    expect(fake.reads[0]).toContainEqual(["is", "room_code", null]);
    fake.results.select = { data: [task("new", false)], error: null };
    await act(async () => { fake.change(); });
    expect(hook.result.current.tasks[0].id).toBe("new");
    fake.results.select = { data: [], error: null };
    await act(async () => { fake.subscribed(); });
    expect(hook.result.current.tasks).toEqual([]);
  });

  it("reconciles missed deletions only while visible and refreshes immediately on return", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useTasks(OWNER));
    await act(async () => {});
    expect(hook.result.current.tasks).toHaveLength(3);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const before = fake.reads.length;
    visibility.mockReturnValue("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); window.dispatchEvent(new Event("focus")); });
    expect(fake.reads).toHaveLength(before);
    fake.results.select = { data: [], error: null };
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(hook.result.current.tasks).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fake.reads).toHaveLength(before + 2);
  });

  it("coalesces events received during a read into one follow-up read", async () => {
    let finish!: (result: Result) => void;
    fake.pendingReads.push(new Promise((resolve) => { finish = resolve; }));
    const hook = renderHook(() => useTasks(OWNER));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      fake.subscribed();
    });
    expect(fake.reads).toHaveLength(1);
    fake.results.select = { data: [task("latest", false)], error: null };
    await act(async () => { finish({ data: [], error: null }); });
    expect(fake.reads).toHaveLength(2);
    expect(hook.result.current.tasks[0].id).toBe("latest");
  });

  it("does not let a stale refresh roll back a successful local edit", async () => {
    const hook = await mount();
    const oldRows = { data: [task("pending", false)], error: null };
    let finish!: (result: Result) => void;
    fake.pendingReads.push(new Promise((resolve) => { finish = resolve; }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    fake.results.update = { data: [{ id: "pending", content: "Saved text" }], error: null };
    await act(async () => { await hook.result.current.editTask("pending", "Saved text"); });
    fake.results.select = { data: [{ ...task("pending", false), content: "Saved text" }], error: null };
    await act(async () => { finish(oldRows); });
    expect(hook.result.current.tasks[0].content).toBe("Saved text");
    expect(fake.reads).toHaveLength(3);
  });

  it("preserves loaded goals on read failure and recovers on the next refresh", async () => {
    const hook = await mount();
    fake.results.select = { data: null, error: { code: "offline" } };
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(hook.result.current.tasks).toHaveLength(3);
    expect(hook.result.current.error).toMatch(/Couldn't load/);
    fake.results.select = { data: [], error: null };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(hook.result.current.tasks).toEqual([]);
    expect(hook.result.current.error).toBeNull();
  });

  it("does not erase a refused-write message after a successful background read", async () => {
    const hook = await mount();
    fake.results.delete = { data: [], error: null };
    await act(async () => { await hook.result.current.deleteTask("pending"); });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(hook.result.current.error).toMatch(/Couldn't delete/);
  });

  it("does not duplicate a created goal already seen by a live read", async () => {
    const hook = await mount();
    await act(async () => { hook.result.current.setNewTask("created"); });
    const created = task("created", false);
    fake.results.select = { data: [created], error: null };
    await act(async () => { fake.change(); });
    fake.results.insert = { data: created, error: null };
    await act(async () => { await hook.result.current.addTask(); });
    expect(hook.result.current.tasks.map((row) => row.id)).toEqual(["created"]);
  });

  it("removes listeners/channel and ignores an old owner's late read", async () => {
    let finish!: (result: Result) => void;
    fake.pendingReads.push(new Promise((resolve) => { finish = resolve; }));
    const hook = renderHook(({ owner }) => useTasks(owner), { initialProps: { owner: OWNER } });
    fake.results.select = { data: [{ ...task("other", false), owner_id: "other-owner" }], error: null };
    hook.rerender({ owner: "other-owner" });
    await waitFor(() => expect(hook.result.current.tasks[0]?.id).toBe("other"));
    await act(async () => { finish({ data: [task("old", false)], error: null }); });
    expect(hook.result.current.tasks[0].id).toBe("other");
    hook.unmount();
    const before = fake.reads.length;
    await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); fake.change(); });
    expect(fake.reads).toHaveLength(before);
    expect(fake.sb.removeChannel).toHaveBeenCalledTimes(2);
  });
});
