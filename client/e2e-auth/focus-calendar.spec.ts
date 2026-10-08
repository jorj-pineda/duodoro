import { randomUUID } from 'node:crypto';
import { test, expect, requireSuccess } from './duoFixture';
import { onboard } from './onboard';

test('calendar counts a busy month, filters saved solo/duo focus and retries independently', async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Calendar Alpha', `ca_${suffix}`);
  async function save(ids: string[], seconds: number, completed = true) {
    const room = randomUUID(); roomCodes.add(room);
    const saved = await admin.rpc('record_focus_session', {
      p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: Math.max(600, seconds),
      p_break_duration: 60, p_actual_focus: seconds, p_completed: completed,
      p_started_at: new Date(Date.now() - seconds * 1000).toISOString(), p_user_ids: ids,
    }); requireSuccess(saved.error, 'Save calendar fixture');
  }
  for (let round = 0; round < 24; round++) await save([a.id, b.id], 60);
  await save([a.id], 600); await save([b.id], 2400); await save([a.id], 600, false);
  await a.page.getByRole('button', { name: 'Open stats', exact: true }).click();
  await a.page.getByRole('tab', { name: 'calendar' }).click();
  const calendar = a.page.getByRole('region', { name: 'Focus calendar' });
  await expect(calendar.getByText('34m · 25 completed rounds this month')).toBeVisible();
  await calendar.getByRole('button', { name: 'Duo', exact: true }).click();
  await expect(calendar.getByText('24m · 24 completed rounds this month')).toBeVisible();
  await expect(calendar.getByText('10m · Solo focus')).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Show more rounds (4 remaining)' }).click();
  await expect(calendar.getByRole('article')).toHaveCount(24);
  await calendar.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(calendar.getByText('10m · 1 completed round this month')).toBeVisible();
  await a.page.setViewportSize({ width: 375, height: 667 });
  await calendar.scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('focus-calendar-phone.png') });
  await calendar.getByRole('button', { name: 'Previous month' }).click();
  await expect(calendar.getByText('No completed solo rounds this month.')).toBeVisible();
  await a.page.route('**/rest/v1/rpc/get_focus_calendar', async route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
  await calendar.getByRole('button', { name: 'Next month' }).click();
  await expect(calendar.getByRole('alert')).toContainText("Couldn't load");
  await a.page.unroute('**/rest/v1/rpc/get_focus_calendar');
  await calendar.getByRole('button', { name: 'Retry calendar' }).click();
  await expect(calendar.getByText('10m · 1 completed round this month')).toBeVisible();
  await a.page.getByRole('button', { name: 'View detailed stats →' }).click();
  const full = a.page.getByRole('dialog', { name: 'Your stats', exact: true });
  await expect(full.getByText('34m · 25 completed rounds this month')).toBeVisible();
  await full.getByRole('button', { name: 'Close', exact: true }).click();
  await a.page.getByRole('button', { name: 'Focus', exact: true }).click();
  const room = await a.page.evaluate(() => localStorage.getItem('duodoro:session'));
  if (room) roomCodes.add(room);
  await a.page.getByRole('button', { name: 'Toggle stats panel' }).click();
  await a.page.getByRole('tab', { name: 'calendar' }).click();
  await expect(calendar.getByText('34m · 25 completed rounds this month')).toBeVisible();
  await a.page.setViewportSize({ width: 320, height: 568 });
  await calendar.scrollIntoViewIfNeeded();
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
