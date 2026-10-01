import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  const updates: { values: unknown; filters: unknown[] }[] = [];
  const builder = (kind: string, filters: unknown[] = []) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    for (const method of ["select", "eq", "is", "order", "in"]) {
      chain[method] = (...args: unknown[]) => {
        if (method === "eq" || method === "is") filters.push([method, ...args]);
        return chain;
      };
    }
    chain.then = (
      resolve: (value: Result) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(results[kind]).then(resolve, reject);
    return chain;
  };

  return {
    results,
    updates,
    sb: {
      from: () => ({
        select: () => builder("select"),
        delete: () => builder("delete"),
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
