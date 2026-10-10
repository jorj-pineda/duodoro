import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('private tag fields on calendar rounds', () => {
  const round = (sessions: unknown[]) => ({ day: '2026-10-07', solo_seconds: 0, duo_seconds: 0, solo_rounds: 0, duo_rounds: 0, sessions });
  const base = { id: 's1', focus_seconds: 1500, world: 'forest', ended_at: '2026-10-07T10:00:00Z', is_duo: false, partner_name: 'Partner' };

  it('marks tags unavailable for an older API response instead of inventing untagged rounds', async () => {
    rpc.mockResolvedValue({ data: [round([base])], error: null });
    const { result } = renderHook(() => useFocusCalendar('carol', '2026-10'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.tagsAvailable).toBe(false);
  });

  it('exposes confirmed tags and records them for the account', async () => {
    const { readSavedFocusTag } = await import('@/hooks/useSessionFocusTags');
    rpc.mockResolvedValue({ data: [round([{ ...base, private_tag: 'study', private_tag_version: 11 }, { ...base, id: 's2', private_tag: null, private_tag_version: 3 }])], error: null });
    const { result } = renderHook(() => useFocusCalendar('dana', '2026-10'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.tagsAvailable).toBe(true);
    expect(result.current.rows[0].sessions.map(s => [s.private_tag, s.private_tag_version])).toEqual([['study', 11], [null, 3]]);
    expect(readSavedFocusTag('dana', 's1')).toEqual({ tag: 'study', version: 11 });
    expect(readSavedFocusTag('dana', 's2')).toEqual({ tag: null, version: 3 });
  });

  it('fails the load for a malformed or half-present tag rather than showing it as untagged', async () => {
    rpc.mockResolvedValueOnce({ data: [round([{ ...base, private_tag: 'coding', private_tag_version: 1 }])], error: null });
    const { result } = renderHook(() => useFocusCalendar('erin', '2026-10'));
    await waitFor(() => expect(result.current.error).toMatch(/Couldn't load/));
    expect(result.current.loaded).toBe(false);
    expect(result.current.rows).toEqual([]);
  });

  it('keeps the last loaded rounds when a refresh fails and reports whether a retry succeeded', async () => {
    rpc.mockResolvedValueOnce({ data: [round([{ ...base, private_tag: 'work', private_tag_version: 2 }])], error: null });
    const { result } = renderHook(() => useFocusCalendar('frank', '2026-10'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    let refreshed = true;
    await act(async () => { refreshed = await result.current.retry(); });
    expect(refreshed).toBe(false);
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toMatch(/Couldn't refresh/);
    expect(result.current.rows[0].sessions[0].private_tag).toBe('work');
    rpc.mockResolvedValueOnce({ data: [round([{ ...base, private_tag: 'work', private_tag_version: 2 }])], error: null });
    let ok = false;
    await act(async () => { ok = await result.current.retry(); });
    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
