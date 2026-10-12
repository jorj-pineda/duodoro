import type { RoundRecap, SessionIntentions } from './sessionTypes';
export function unfinishedIntentions(userId: string, phase: string, intentions: SessionIntentions, recap: RoundRecap | null): string[] {
  const current = phase === 'focus' ? intentions.current[userId] : null;
  const previous = recap?.intentions?.[userId];
  return [...new Set([
    current && !current.completed ? current.text : '',
    previous && !previous.completed ? previous.text : '',
    intentions.next[userId] ?? '',
  ].filter(Boolean))];
}
