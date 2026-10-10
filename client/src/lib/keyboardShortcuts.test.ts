import { expect, it } from 'vitest';
import { startShortcutAction } from './keyboardShortcuts';
const room = { inGame: true, sessionId: 'room', connected: true, playerCount: 1, sessionStarted: false, intentionEditing: false, phase: 'waiting' as const };
it('selects Start only while waiting and Go again only while ready', () => {
  expect(startShortcutAction(room)).toBe('start');
  expect(startShortcutAction({ ...room, phase: 'ready' })).toBe('again');
  for (const phase of ['focus', 'celebration', 'break', 'returning'] as const) expect(startShortcutAction({ ...room, phase })).toBeNull();
});
it('blocks timer actions outside a connected eligible room or during intention editing', () => {
  for (const override of [{ inGame: false }, { sessionId: null }, { connected: false }, { playerCount: 0 }, { sessionStarted: true }, { intentionEditing: true }])
    expect(startShortcutAction({ ...room, ...override })).toBeNull();
});
