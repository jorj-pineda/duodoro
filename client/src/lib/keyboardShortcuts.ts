import type { GamePhase } from '../../../shared/socketContract';

export function startShortcutAction(state: {
  inGame: boolean; sessionId: string | null; connected: boolean; playerCount: number;
  sessionStarted: boolean; intentionEditing: boolean; phase: GamePhase;
}): 'start' | 'again' | null {
  if (!state.inGame || !state.sessionId || !state.connected || state.playerCount < 1 || state.sessionStarted || state.intentionEditing) return null;
  return state.phase === 'waiting' ? 'start' : state.phase === 'ready' ? 'again' : null;
}
