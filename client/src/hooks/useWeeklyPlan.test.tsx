import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: fake.read }) }) }) }), rpc: fake.rpc }) }));
import { useWeeklyPlan } from "./useWeeklyPlan";
const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const row = (version = 1, task_ids = [id]) => ({ user_id: "owner", week_start: "2026-10-12", version, task_ids });
beforeEach(() => { vi.clearAllMocks(); fake.read.mockResolvedValue({ data: null, error: null }); fake.rpc.mockResolvedValue({ data: [row()], error: null }); });

it("distinguishes missing plans from read failures and reloads honestly", async () => {
  fake.read.mockResolvedValueOnce({ data: null, error: {} });
  const { result } = renderHook(() => useWeeklyPlan("owner", "2026-10-12"));
  await waitFor(() => expect(result.current.error).toMatch(/Couldn't load/));
  expect(result.current.loaded).toBe(false);
  await act(() => result.current.reload());
  expect(result.current.loaded).toBe(true); expect(result.current.plan.ids).toEqual([]);
});
it("saves only a confirmed matching revision and blocks lost-response retries until reload", async () => {
  const { result } = renderHook(() => useWeeklyPlan("owner", "2026-10-12"));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  fake.rpc.mockResolvedValueOnce({ data: [], error: null });
  await act(async () => { expect(await result.current.save([id])).toBeUndefined(); });
  expect(result.current.plan.ids).toEqual([]); expect(result.current.error).toMatch(/Couldn't confirm/);
  await act(() => result.current.save([id])); expect(fake.rpc).toHaveBeenCalledTimes(1);
  fake.read.mockResolvedValueOnce({ data: row(2), error: null });
  await act(() => result.current.reload());
  expect(result.current.plan.ids).toEqual([id]);
  fake.rpc.mockResolvedValueOnce({ data: [row(3, [])], error: null });
  await act(async () => { expect(await result.current.save([])).toEqual({ ids: [], version: 3 }); });
  expect(fake.rpc).toHaveBeenLastCalledWith("set_weekly_focus_plan", { p_week_start: "2026-10-12", p_task_ids: [], p_expected_version: 2 });
  expect(result.current.plan).toEqual({ ids: [], version: 3 });
});
it("drops old-account responses and refuses retained callbacks after a week change", async () => {
  let finish!: (value: unknown) => void;
  fake.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(({ user, week }) => useWeeklyPlan(user, week), { initialProps: { user: "owner", week: "2026-10-12" } });
  await waitFor(() => expect(fake.read).toHaveBeenCalledTimes(1));
  const oldSave = result.current.save;
  rerender({ user: "partner", week: "2026-10-19" });
  await waitFor(() => expect(result.current.loaded).toBe(true));
  await act(async () => finish({ data: row(), error: null }));
  expect(result.current.plan.ids).toEqual([]);
  await act(() => oldSave([id])); expect(fake.rpc).not.toHaveBeenCalled();
});
it("does not let a read from before a confirmed write roll back the plan", async () => {
  const { result } = renderHook(() => useWeeklyPlan("owner", "2026-10-12"));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  let finish!: (value: unknown) => void;
  fake.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let loading!: Promise<void>;
  act(() => { loading = result.current.reload(); });
  await act(() => result.current.save([id]));
  await act(async () => { finish({ data: null, error: null }); await loading; });
  expect(result.current.plan.ids).toEqual([id]);
});
it("reports conflicts, rejects wrong owners, and refreshes after tab return", async () => {
  const { result } = renderHook(() => useWeeklyPlan("owner", "2026-10-12"));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
  await act(() => result.current.save([id])); expect(result.current.error).toMatch(/changed elsewhere/);
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(result.current.error).toBeNull());
  fake.rpc.mockResolvedValueOnce({ data: [{ ...row(), user_id: "partner" }], error: null });
  await act(() => result.current.save([id])); expect(result.current.error).toMatch(/Couldn't confirm/);
  expect(result.current.plan.ids).toEqual([]);
});
