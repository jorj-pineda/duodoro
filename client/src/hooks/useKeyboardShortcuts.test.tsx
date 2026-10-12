import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const press = (key: string, options: KeyboardEventInit = {}, target: EventTarget = document) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => { target.dispatchEvent(event); });
  return event;
};
it('runs only available actions, prevents their defaults, and uses current callbacks', () => {
  const start = vi.fn(), stats = vi.fn(), quiet = vi.fn(), help = vi.fn();
  const { rerender, unmount } = renderHook(({ enabled, blocked, actions }) => useKeyboardShortcuts(enabled, blocked, actions), { initialProps: { enabled: true, blocked: false, actions: { start, stats, quiet, help } } });
  for (const key of ['s', 't', 'q', '?']) expect(press(key).defaultPrevented).toBe(true);
  for (const action of [start, stats, quiet, help]) expect(action).toHaveBeenCalledTimes(1);
  expect(press('x').defaultPrevented).toBe(false);
  const next = vi.fn();
  rerender({ enabled: true, blocked: false, actions: { start: next, stats, quiet, help } });
  press('s'); expect(next).toHaveBeenCalledTimes(1); expect(start).toHaveBeenCalledTimes(1);
  rerender({ enabled: false, blocked: false, actions: { start: next, stats, quiet, help } });
  press('s'); expect(next).toHaveBeenCalledTimes(1);
  rerender({ enabled: true, blocked: true, actions: { start: next, stats, quiet, help } });
  press('s'); expect(next).toHaveBeenCalledTimes(1);
  unmount(); press('s'); expect(next).toHaveBeenCalledTimes(1);
});
it('leaves unavailable actions and browser shortcuts alone', () => {
  const help = vi.fn();
  renderHook(() => useKeyboardShortcuts(true, false, { help }));
  expect(press('s').defaultPrevented).toBe(false);
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }]) press('?', options);
  expect(help).not.toHaveBeenCalled();
  press('?', { shiftKey: true }); expect(help).toHaveBeenCalledTimes(1);
});
it.each(['input', 'textarea', 'select', 'contenteditable', 'textbox'])('ignores typing in %s', kind => {
  const stats = vi.fn();
  renderHook(() => useKeyboardShortcuts(true, false, { stats }));
  const editor = document.createElement(['input', 'textarea', 'select'].includes(kind) ? kind : 'div');
  if (kind === 'contenteditable') editor.setAttribute('contenteditable', 'true');
  if (kind === 'textbox') editor.setAttribute('role', 'textbox');
  document.body.append(editor);
  expect(press('t', {}, editor).defaultPrevented).toBe(false);
  expect(stats).not.toHaveBeenCalled(); editor.remove();
});
it('ignores open dialogs and menus', () => {
  const stats = vi.fn();
  renderHook(() => useKeyboardShortcuts(true, false, { stats }));
  for (const role of ['dialog', 'menu']) {
    const overlay = document.createElement('div'); overlay.setAttribute('role', role); document.body.append(overlay);
    press('t'); expect(stats).not.toHaveBeenCalled(); overlay.remove();
  }
});
it('respects consumed events, IME legacy events, and hidden tabs', () => {
  const stats = vi.fn(); renderHook(() => useKeyboardShortcuts(true, false, { stats }));
  const event = new KeyboardEvent('keydown', { key: 't', cancelable: true }); event.preventDefault();
  act(() => document.dispatchEvent(event)); press('t', { keyCode: 229 });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  try { press('t'); expect(stats).not.toHaveBeenCalled(); }
  finally { delete (document as unknown as { visibilityState?: string }).visibilityState; }
});
