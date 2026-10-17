import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: { getSession: api.session }, from: api.from, rpc: api.rpc }) }));
import { useAccountPreferenceSync } from './useAccountPreferenceSync';

afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });
function session(id: string) { return { data: { session: { user: { id }, access_token: `test-${id}` } }, error: null }; }
function query(data: unknown) {
  const setHeader = vi.fn(async () => ({ data, error: null }));
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), limit: vi.fn(() => chain), setHeader };
  return chain;
}
it('shares one controller across consumers, tolerates StrictMode, and pins owner tokens on reads and writes', async () => {
  const id = 'hook-owner'; api.session.mockResolvedValue(session(id));
  const read = query([]); api.from.mockReturnValue(read);
  const write = query([{ user_id: id, key: 'daily_goal', value: 90, version: 1 }]); api.rpc.mockReturnValue(write);
  const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
  const one = renderHook(() => useAccountPreferenceSync(id), { wrapper });
  await waitFor(() => expect(one.result.current.loaded).toBe(true));
  const count = api.from.mock.calls.length;
  const two = renderHook(() => useAccountPreferenceSync(id));
  expect(api.from).toHaveBeenCalledTimes(count);
  expect(read.setHeader).toHaveBeenLastCalledWith('Authorization', 'Bearer test-hook-owner');
  one.unmount();
  act(() => window.dispatchEvent(new CustomEvent('duodoro:daily-goal-changed', { detail: { userId: id, key: 'daily_goal', value: 90 } })));
  await waitFor(() => expect(api.rpc).toHaveBeenCalledExactlyOnceWith('set_account_preference', { p_key: 'daily_goal', p_value: 90, p_expected_version: null }));
  await waitFor(() => expect(two.result.current.pending).toEqual([]));
  expect(write.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-hook-owner');
  two.unmount();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(api.from).toHaveBeenCalledTimes(count);
});
it('rejects a request when the authenticated identity changes and ignores another account’s local events', async () => {
  api.session.mockResolvedValue(session('new-account'));
  const hook = renderHook(() => useAccountPreferenceSync('old-account'));
  await waitFor(() => expect(hook.result.current.error).toBe(true));
  expect(api.from).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new CustomEvent('duodoro:daily-goal-changed', { detail: { userId: 'new-account', key: 'daily_goal', value: 120 } })));
  expect(hook.result.current.pending).toEqual([]); expect(api.rpc).not.toHaveBeenCalled();
  hook.unmount();
});
it('retains the captured token if identity switches while getSession is completing', async () => {
  const id = 'captured-owner'; const read = query([]); api.from.mockReturnValue(read);
  let finish!: (value: ReturnType<typeof session>) => void;
  api.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const hook = renderHook(() => useAccountPreferenceSync(id));
  api.session.mockResolvedValue(session('different-owner'));
  await act(async () => finish(session(id)));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  expect(read.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-captured-owner');
  hook.unmount();
});

it('renders a neutral server snapshot without reading storage or contacting Auth', () => {
  const reads = vi.spyOn(Storage.prototype, 'getItem');
  function ServerView() { const sync = useAccountPreferenceSync('ssr-owner'); return <span>{sync.loaded ? 'loaded' : 'checking'}</span>; }
  expect(renderToString(<ServerView />)).toBe('<span>checking</span>');
  expect(reads).not.toHaveBeenCalled(); expect(api.session).not.toHaveBeenCalled();
  reads.mockRestore();
});
