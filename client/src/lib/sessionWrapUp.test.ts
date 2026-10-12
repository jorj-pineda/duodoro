import { expect, it } from 'vitest';
import { unfinishedIntentions } from './sessionWrapUp';
it('includes only the owner’s unfinished current/latest/next text and deduplicates it', () => {
  const intentions = { current: { alice: { text: 'Draft', completed: false, displayName: 'A' }, bob: { text: 'Partner private plan', completed: false, displayName: 'B' } }, next: { alice: 'Draft', bob: 'Other plan' } };
  const recap = { round: 1, focusSeconds: 60, mode: 'flow' as const, saveState: 'saved' as const, intentions: { alice: { text: 'Old round', completed: false, displayName: 'A' } } };
  expect(unfinishedIntentions('alice','focus',intentions,recap)).toEqual(['Draft','Old round']);
  expect(unfinishedIntentions('alice','break', { ...intentions, next: {} }, { ...recap, intentions: { alice: { ...recap.intentions.alice, completed: true } } })).toEqual([]);
});
