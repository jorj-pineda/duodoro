import { expect, it } from 'vitest';
import { dayTotals, monthDays, shiftMonth } from './focusCalendar';
it('lays out Monday-first leap-year months and crosses year boundaries', () => {
  const days = monthDays('2024-02');
  expect(days.slice(0, 4)).toEqual([null, null, null, '2024-02-01']);
  expect(days.filter(Boolean)).toHaveLength(29); expect(days.length % 7).toBe(0);
  expect(shiftMonth('2026-01', -1)).toBe('2025-12'); expect(shiftMonth('2026-12', 1)).toBe('2027-01');
});
it('keeps solo and duo totals separate and treats absent days as zero after loading', () => {
  const row = { day: '2026-10-01', solo_seconds: 600, duo_seconds: 1500, solo_rounds: 2, duo_rounds: 1, sessions: [] };
  expect(dayTotals(row, 'all')).toEqual({ seconds: 2100, rounds: 3 });
  expect(dayTotals(row, 'solo')).toEqual({ seconds: 600, rounds: 2 });
  expect(dayTotals(row, 'duo')).toEqual({ seconds: 1500, rounds: 1 });
  expect(dayTotals(undefined, 'all')).toEqual({ seconds: 0, rounds: 0 });
});
