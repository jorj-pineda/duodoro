import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { useBreakActivities } from './useBreakActivities';
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
it('starts opt-out, persists opt-in, and scopes refresh-safe dismissal to one break', () => {
  const { result, rerender } = renderHook(({ id, round }) => useBreakActivities(id, round), { initialProps: { id: 'alice', round: 'room:100' } });
  expect(result.current.enabled).toBe(false);
  act(() => { result.current.enable(); result.current.dismiss(); });
  expect(result.current.enabled).toBe(true); expect(result.current.dismissed).toBe(true);
  const second = renderHook(() => useBreakActivities('alice', 'room:100'));
  expect(second.result.current.dismissed).toBe(true);
  rerender({ id: 'alice', round: 'room:200' });
  expect(result.current.enabled).toBe(true); expect(result.current.dismissed).toBe(false);
  rerender({ id: 'bob', round: 'room:200' }); expect(result.current.enabled).toBe(false);
  rerender({ id: 'alice', round: 'room:200' });
  act(() => { result.current.disable(); }); expect(result.current.enabled).toBe(false);
});
it('follows another tab’s opt-out and uses memory when storage is unavailable', () => {
  const { result } = renderHook(() => useBreakActivities('fallback', 'room:1'));
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  act(() => { expect(result.current.enable()).toBe(false); result.current.dismiss(); });
  expect(result.current.enabled).toBe(true); expect(result.current.dismissed).toBe(true);
  write.mockRestore();
  act(() => {
    localStorage.setItem('duodoro:break-ideas:fallback', '0');
    window.dispatchEvent(new StorageEvent('storage', { key: 'duodoro:break-ideas:fallback' }));
  });
  expect(result.current.enabled).toBe(false);
});
it('uses an opt-out server snapshot even when the browser opted in', () => {
  localStorage.setItem('duodoro:break-ideas:ssr', '1');
  function Snapshot() { return <span>{String(useBreakActivities('ssr', 'room:1').enabled)}</span>; }
  expect(renderToString(<Snapshot />)).toBe('<span>false</span>');
});
