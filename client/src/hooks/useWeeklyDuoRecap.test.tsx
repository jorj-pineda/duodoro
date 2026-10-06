import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc }) }));
vi.mock('./useDailyFocusGoal', () => ({ useLocalDay: () => '2026-10-06' }));
import { useWeeklyDuoRecap } from './useWeeklyDuoRecap';
beforeEach(() => rpc.mockReset());
it('keeps errors distinct from zero sessions and retries with the local timezone', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: {} }).mockResolvedValue({ data: [], error: null });
  const { result } = renderHook(() => useWeeklyDuoRecap('alice', true));
  await waitFor(() => expect(result.current.error).toMatch(/Couldn't load/));
  expect(result.current.loaded).toBe(false);
  await act(() => result.current.retry());
  expect(result.current.loaded).toBe(true); expect(result.current.error).toBeNull();
  expect(rpc).toHaveBeenCalledWith('get_weekly_duo_recap', { tz: expect.any(String) });
});
it('rejects stale responses across accounts and refreshes on tab return', async () => {
  let old!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValue({ data: [], error: null });
  const { result, rerender } = renderHook(({ id }) => useWeeklyDuoRecap(id, true), { initialProps: { id: 'alice' } });
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  rerender({ id: 'bob' });
  await waitFor(() => expect(result.current.loaded).toBe(true));
  await act(async () => old({ data: [{ partner_id: 'private', focus_seconds: 999, completed_rounds: 1 }], error: null }));
  expect(result.current.rows).toEqual([]);
  const calls = rpc.mock.calls.length;
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(calls));
});
