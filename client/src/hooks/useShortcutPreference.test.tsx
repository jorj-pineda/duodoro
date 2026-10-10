import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { useShortcutPreference } from './useShortcutPreference';
it('defaults off, persists per account, and responds to another tab disabling shortcuts', () => {
  localStorage.clear();
  const { result, rerender } = renderHook(({ id }) => useShortcutPreference(id), { initialProps: { id: 'shortcut-alice' } });
  expect(result.current.enabled).toBe(false);
  act(() => { expect(result.current.setEnabled(true)).toBe(true); });
  expect(result.current.enabled).toBe(true);
  rerender({ id: 'shortcut-bob' }); expect(result.current.enabled).toBe(false);
  rerender({ id: 'shortcut-alice' }); expect(result.current.enabled).toBe(true);
  localStorage.setItem('duodoro:keyboard-shortcuts:shortcut-alice', 'false');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'duodoro:keyboard-shortcuts:shortcut-alice' })));
  expect(result.current.enabled).toBe(false);
});
it('keeps an opt-in for this page when browser storage rejects writes', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    const { result } = renderHook(() => useShortcutPreference('shortcut-blocked'));
    act(() => { expect(result.current.setEnabled(true)).toBe(false); });
    expect(result.current.enabled).toBe(true);
    act(() => { result.current.setEnabled(false); }); expect(result.current.enabled).toBe(false);
  } finally { write.mockRestore(); }
});

it('keeps the server-rendered preference off even when the browser opted in', () => {
  localStorage.setItem('duodoro:keyboard-shortcuts:shortcut-ssr', 'true');
  function Snapshot() { return <span>{String(useShortcutPreference('shortcut-ssr').enabled)}</span>; }
  expect(renderToString(<Snapshot />)).toContain('false');
});
