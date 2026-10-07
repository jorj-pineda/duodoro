import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc }) }));
vi.mock('./useDailyFocusGoal', () => ({ useLocalDay: () => '2026-10-07' }));
import { useFocusCalendar } from './useFocusCalendar';
beforeEach(() => rpc.mockReset());
it('requests a complete local month and exposes retry instead of false zero totals', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: {} }).mockResolvedValue({ data: [], error: null });
  const { result } = renderHook(() => useFocusCalendar('alice', '2026-10'));
  await waitFor(() => expect(result.current.error).toMatch(/Couldn't load/));
  expect(result.current.loaded).toBe(false);
  await act(() => result.current.retry()); expect(result.current.loaded).toBe(true);
  expect(rpc).toHaveBeenCalledWith('get_focus_calendar', { month_start: '2026-10-01', tz: expect.any(String) });
});
it('rejects stale responses after month/account changes and refreshes on tab return', async () => {
  let resolveOld!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({ data: [], error: null });
  const { result, rerender } = renderHook(({ id, month }) => useFocusCalendar(id, month), { initialProps: { id: 'alice', month: '2026-10' } });
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  rerender({ id: 'bob', month: '2026-09' });
  await waitFor(() => expect(result.current.loaded).toBe(true));
  await act(async () => resolveOld({ data: [{ day: '2026-10-01', sessions: [] }], error: null }));
  expect(result.current.rows).toEqual([]);
  const calls = rpc.mock.calls.length;
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(calls));
});
