import { describe, expect, it } from 'vitest';
import { insightDays, summarizeInsights } from './focusInsights';
import type { CalendarDay, CalendarSession } from './focusCalendar';
const session = (seconds: number, tag: CalendarSession['private_tag'] = null): CalendarSession => ({
  id: String(Math.random()), focus_seconds: seconds, private_tag: tag, private_tag_version: tag ? 1 : null,
  is_duo: false, partner_name: '', world: 'forest', ended_at: '2026-10-10T12:00:00Z',
});
const row = (day: string, solo: number, duo: number, sessions: CalendarSession[]): CalendarDay => ({
  day, solo_seconds: solo, duo_seconds: duo, solo_rounds: sessions.filter(s => !s.is_duo).length,
  duo_rounds: sessions.filter(s => s.is_duo).length, sessions,
});
describe('private insight periods', () => {
  it('includes today and six prior dates across year and leap-month boundaries', () => {
    expect(insightDays('2027-01-03', 'week')).toEqual(['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
    expect(insightDays('2028-03-02', 'week')).toContain('2028-02-29');
    expect(insightDays('2026-03-10', 'week')).toHaveLength(7);
  });
  it('uses month to date and stays neutral before client mount', () => {
    expect(insightDays('2026-10-03', 'month')).toEqual(['2026-10-01','2026-10-02','2026-10-03']);
    expect(insightDays('', 'week')).toEqual([]);
  });
});
describe('complete saved-round insights', () => {
  it('includes rounds beyond pagination, keeps untagged time, and excludes other dates', () => {
    const rounds = Array.from({ length: 25 }, () => session(60, 'work'));
    rounds.push(session(120));
    const duo = { ...session(300, 'study'), is_duo: true };
    const rows = [row('2026-10-10', 1620, 0, rounds), row('2026-10-11', 0, 300, [duo]), row('2026-10-01', 999, 0, [session(999)])];
    const summary = summarizeInsights(rows, ['2026-10-09','2026-10-10','2026-10-11']);
    expect(summary).toMatchObject({ seconds: 1920, soloSeconds: 1620, duoSeconds: 300, rounds: 27, activeDays: 2, averageSeconds: 71, busiestDays: ['2026-10-10'] });
    expect(summary.tags.find(t => t.id === 'work')).toMatchObject({ seconds: 1500, rounds: 25 });
    expect(summary.tags.find(t => t.id === 'untagged')).toMatchObject({ seconds: 120, rounds: 1 });
    expect(summary.daily[0]).toEqual({ day: '2026-10-09', seconds: 0, rounds: 0 });
  });
  it('reports all busiest-day ties, and no busiest day for an empty period', () => {
    expect(summarizeInsights([row('2026-10-10', 60, 0, [session(60)]),row('2026-10-11', 60, 0, [session(60)])], ['2026-10-10','2026-10-11']).busiestDays).toEqual(['2026-10-10','2026-10-11']);
    expect(summarizeInsights([], ['2026-10-10'])).toMatchObject({ seconds: 0, rounds: 0, averageSeconds: 0, busiestDays: [] });
  });
});
