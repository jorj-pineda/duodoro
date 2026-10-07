import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc }) }));
import { useSharedMilestones } from './useSharedMilestones';
beforeEach(() => rpc.mockReset());
it('loads only caller-scoped duo totals, exposes errors, and retries', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: {} }).mockResolvedValue({ data: [{ partner_id: 'bob', partner_name: 'Bob', total_co_focus_time: 3600, sessions_together: 10 }], error: null });
  const { result } = renderHook(() => useSharedMilestones('alice', true));
  await waitFor(() => expect(result.current.error).toMatch(/Couldn't load/)); expect(result.current.loaded).toBe(false);
  await act(() => result.current.retry());
  expect(result.current.rows).toEqual([{ partnerId: 'bob', partnerName: 'Bob', seconds: 3600, rounds: 10 }]);
  expect(rpc).toHaveBeenCalledWith('get_duo_stats');
});
it('rejects stale responses across accounts and refreshes on reconnect/visibility', async () => {
  let old!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValue({ data: [], error: null });
  const { result, rerender } = renderHook(({ id, connected }) => useSharedMilestones(id, connected), { initialProps: { id: 'alice', connected: false } });
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  rerender({ id: 'bob', connected: true }); await waitFor(() => expect(result.current.loaded).toBe(true));
  await act(async () => old({ data: [{ partner_id: 'private', sessions_together: 100 }], error: null }));
  expect(result.current.rows).toEqual([]);
  const count = rpc.mock.calls.length;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(rpc.mock.calls.length).toBeGreaterThan(count));
});
it('polls only while visible and removes the fallback on unmount', async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  const { unmount } = renderHook(() => useSharedMilestones('poll', true));
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  vi.useFakeTimers();
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const count = rpc.mock.calls.length;
  try {
    // The interval was installed before fake timers, so remount under fake time.
    unmount(); const next = renderHook(() => useSharedMilestones('poll', true));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const afterInitial = rpc.mock.calls.length; expect(afterInitial).toBe(count + 1);
    visible.mockReturnValue('visible'); await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(rpc.mock.calls.length).toBe(afterInitial + 1);
    next.unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(rpc.mock.calls.length).toBe(afterInitial + 1);
  } finally { visible.mockRestore(); vi.useRealTimers(); }
});
