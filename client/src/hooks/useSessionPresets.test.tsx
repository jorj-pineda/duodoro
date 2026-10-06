import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseSessionPresets, useSessionPresets } from './useSessionPresets';
const prefs = { mode: 'pomodoro' as const, focus: 50, break: 10 };
beforeEach(() => localStorage.clear());
it('validates names, duration bounds/steps, malformed data and the five-favorite limit', () => {
  expect(parseSessionPresets('bad')).toEqual([]);
  expect(parseSessionPresets(JSON.stringify([{ name: 'Bad', ...prefs, focus: 7 }, { name: 'Good', ...prefs }, { name: 'GOOD', ...prefs }, { name: '', ...prefs }]))).toEqual([{ name: 'Good', ...prefs }]);
  const { result } = renderHook(() => useSessionPresets('limits'));
  act(() => { for (let i = 0; i < 5; i++) result.current.save(`Choice ${i}`, prefs); });
  expect(result.current.presets).toHaveLength(5);
  expect(result.current.save('Sixth', prefs).error).toMatch(/maximum 5/);
  act(() => { result.current.save('choice 0', { ...prefs, focus: 15 }); });
  expect(result.current.presets[0].focus).toBe(15);
});
it('persists per account, removes favorites and follows changes from another tab', () => {
  const { result, rerender } = renderHook(({ id }) => useSessionPresets(id), { initialProps: { id: 'alice' } });
  act(() => { result.current.save('Study', prefs); });
  rerender({ id: 'bob' }); expect(result.current.presets).toEqual([]);
  rerender({ id: 'alice' }); expect(result.current.presets[0].name).toBe('Study');
  act(() => {
    localStorage.setItem('duodoro:session-presets:alice', JSON.stringify([{ name: 'Reading', ...prefs }]));
    window.dispatchEvent(new StorageEvent('storage', { key: 'duodoro:session-presets:alice' }));
  });
  expect(result.current.presets[0].name).toBe('Reading');
  act(() => { result.current.remove('Reading'); }); expect(result.current.presets).toEqual([]);
});
it('keeps favorites usable in memory when storage is blocked and renders a neutral server snapshot', () => {
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const { result } = renderHook(() => useSessionPresets('blocked'));
  act(() => { expect(result.current.save('Offline', prefs).persisted).toBe(false); });
  expect(result.current.presets[0].name).toBe('Offline');
  function ServerSnapshot() { return <span>{useSessionPresets('blocked').presets.length}</span>; }
  expect(renderToString(<ServerSnapshot />)).toBe('<span>0</span>');
  act(() => { result.current.remove('Offline'); }); expect(result.current.presets).toEqual([]);
  set.mockRestore();
});
