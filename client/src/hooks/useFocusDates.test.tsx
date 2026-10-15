import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: () => ({ select: () => ({ or: () => ({ in: () => ({ gt: () => ({ order: () => ({ order: () => ({ limit: fake.read }) }) }) }) }) }) }), rpc: fake.rpc }) }));
import { useFocusDates } from "./useFocusDates";
const row = (extra = {}) => ({ id: "date", proposer_id: "a", recipient_id: "b", status: "pending", version: 1,
  starts_at: "2099-10-20T15:30:00Z", created_at: "2026-10-10T15:30:00Z", ...extra });
beforeEach(() => { vi.clearAllMocks(); fake.read.mockResolvedValue({ data: [], error: null }); fake.rpc.mockResolvedValue({ data: [row()], error: null }); });
it("distinguishes read failure from an empty list and preserves last loaded rows", async () => {
  fake.read.mockResolvedValueOnce({ data: null, error: {} });
  const { result } = renderHook(() => useFocusDates("a"));
  await waitFor(() => expect(result.current.loadError).toMatch(/Couldn't load/));
  expect(result.current.dates).toBeNull();
  fake.read.mockResolvedValueOnce({ data: [row()], error: null });
  await act(() => result.current.reload()); expect(result.current.dates).toEqual([row()]);
  fake.read.mockRejectedValueOnce(new Error("offline"));
  await act(() => result.current.reload()); expect(result.current.dates).toEqual([row()]); expect(result.current.disabled).toBe(true);
});
it("confirms exact creation and serializes double clicks", async () => {
  const { result } = renderHook(() => useFocusDates("a"));
  await waitFor(() => expect(result.current.dates).toEqual([]));
  await act(async () => { await Promise.all([result.current.propose("date", "b", row().starts_at), result.current.propose("date", "b", row().starts_at)]); });
  expect(fake.rpc).toHaveBeenCalledTimes(1); expect(result.current.dates).toEqual([row()]);
});
it("blocks unknown saves until explicit reload, including on tab return", async () => {
  const { result } = renderHook(() => useFocusDates("a"));
  await waitFor(() => expect(result.current.dates).toEqual([]));
  fake.rpc.mockResolvedValueOnce({ data: [], error: null });
  await act(async () => { expect(await result.current.propose("date", "b", row().starts_at)).toBe(false); });
  expect(result.current.actionError).toMatch(/Couldn't confirm/);
  await act(async () => { window.dispatchEvent(new Event("focus")); await result.current.propose("date", "b", row().starts_at); });
  expect(fake.read).toHaveBeenCalledTimes(1); expect(fake.rpc).toHaveBeenCalledTimes(1);
  fake.read.mockResolvedValueOnce({ data: [row()], error: null });
  await act(() => result.current.reload()); expect(result.current.actionError).toBeNull(); expect(result.current.dates).toEqual([row()]);
});
it("rejects mismatched confirmations and stale revisions, then reconciles cancellation", async () => {
  fake.read.mockResolvedValue({ data: [row()], error: null });
  const { result } = renderHook(() => useFocusDates("b"));
  await waitFor(() => expect(result.current.dates).toHaveLength(1));
  fake.rpc.mockResolvedValueOnce({ data: [row({ status: "accepted", version: 1 })], error: null });
  await act(() => result.current.respond(row(), "accepted")); expect(result.current.actionError).toMatch(/Couldn't confirm/);
  await act(() => result.current.reload());
  fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
  await act(() => result.current.respond(row(), "accepted")); expect(result.current.actionError).toMatch(/changed elsewhere/);
  await act(() => result.current.reload());
  fake.rpc.mockResolvedValueOnce({ data: [row({ status: "cancelled", version: 2 })], error: null });
  await act(() => result.current.respond(row(), "cancelled")); expect(result.current.dates).toEqual([]);
});
it("drops stale reads across a write, switches accounts and refuses old callbacks", async () => {
  const { result, rerender } = renderHook(({ id }) => useFocusDates(id), { initialProps: { id: "a" } });
  await waitFor(() => expect(result.current.dates).toEqual([]));
  let finish!: (value: unknown) => void;
  fake.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let read!: Promise<void>;
  act(() => { read = result.current.reload(); });
  await act(() => result.current.propose("date", "b", row().starts_at));
  await act(async () => { finish({ data: [], error: null }); await read; });
  expect(result.current.dates).toEqual([row()]);
  const old = result.current.propose;
  rerender({ id: "c" }); await waitFor(() => expect(result.current.dates).toEqual([]));
  await act(() => old("date", "b", row().starts_at)); expect(fake.rpc).toHaveBeenCalledTimes(1);
});
