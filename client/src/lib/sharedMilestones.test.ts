import { expect, it } from 'vitest';
import { sharedMilestones } from './sharedMilestones';
it('unlocks only reached boundaries and advances each independent next milestone', () => {
  expect(sharedMilestones({ rounds: 0, seconds: 0 }).achieved).toEqual([]);
  const before = sharedMilestones({ rounds: 9, seconds: 3599 });
  expect(before.achieved.map(m => m.id)).toEqual(['rounds:1']);
  expect(before.nextRounds?.target).toBe(10); expect(before.nextHours?.target).toBe(3600);
  const at = sharedMilestones({ rounds: 10, seconds: 3600 });
  expect(at.achieved.map(m => m.id)).toEqual(['rounds:1', 'rounds:10', 'hours:1']);
  expect(at.nextRounds?.target).toBe(25); expect(at.nextHours?.target).toBe(36000);
});
it('keeps achievements stable across reloads and handles all milestones reached', () => {
  const result = sharedMilestones({ rounds: 100, seconds: 180000 });
  expect(result.achieved).toHaveLength(9); expect(result.nextRounds).toBeUndefined(); expect(result.nextHours).toBeUndefined();
  expect(sharedMilestones({ rounds: 100, seconds: 180000 })).toEqual(result);
});
