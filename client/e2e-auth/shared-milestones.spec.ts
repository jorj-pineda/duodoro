import { randomUUID } from 'node:crypto';
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from './duoFixture';
import { onboard } from './onboard';

test('both people see the same saved duo milestones without solo or interrupted credit', async ({ duo }) => {
  test.setTimeout(120_000);
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/'); await onboard(a.page, 'Milestone Alpha', `ma_${suffix}`);
  await b.page.goto('/');
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page, 'Milestone Beta', `mb_${suffix}`);
  async function save(ids: string[], seconds: number, completed = true) {
    const room = randomUUID(); roomCodes.add(room);
    const result = await admin.rpc('record_focus_session', {
      p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: Math.max(600, seconds),
      p_break_duration: 60, p_actual_focus: seconds, p_completed: completed,
      p_started_at: new Date(Date.now() - seconds * 1000).toISOString(), p_user_ids: ids,
    }); requireSuccess(result.error, 'Save milestone fixture');
  }
  for (let i = 0; i < 9; i++) await save([a.id, b.id], 400);
  await save([a.id], 7200); await save([b.id], 7200); await save([a.id, b.id], 300, false);
  const region = (page: typeof a.page) => page.getByRole('region', { name: 'Shared milestones' });
  for (const [actor, partner] of [[a, 'Milestone Beta'], [b, 'Milestone Alpha']] as const) {
    await actor.page.reload();
    await expect(region(actor.page).getByText('With ' + partner)).toBeVisible();
    await expect(region(actor.page).getByText('9 completed rounds · 1h 0m together')).toBeVisible();
    const achieved = region(actor.page).getByRole('list', { name: 'Achieved with ' + partner });
    await expect(achieved.getByText('First shared hour', { exact: true })).toBeVisible();
    await expect(achieved.getByText('10 rounds together', { exact: true })).toHaveCount(0);
    await expect(region(actor.page).getByRole('progressbar', { name: '10 rounds together with ' + partner })).toHaveAttribute('aria-valuenow', '90');
    const visibleFill = await region(actor.page).getByRole('progressbar', { name: '10 rounds together with ' + partner }).evaluate(element => {
      const fill = element.firstElementChild as HTMLElement;
      return { height: fill.getBoundingClientRect().height, ratio: fill.getBoundingClientRect().width / element.getBoundingClientRect().width,
        fillColor: getComputedStyle(fill).backgroundColor, trackColor: getComputedStyle(element).backgroundColor };
    });
    expect(visibleFill.height).toBeGreaterThan(0); expect(visibleFill.ratio).toBeCloseTo(0.9, 1);
    expect(visibleFill.fillColor).not.toBe(visibleFill.trackColor);

  }
  await save([a.id, b.id], 60);
  for (const actor of [a, b]) {
    await actor.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(region(actor.page).getByText('10 rounds together', { exact: true })).toBeVisible();
    await expect(region(actor.page).getByText('10 completed rounds · 1h 1m together')).toBeVisible();
  }
  await a.page.setViewportSize({ width: 375, height: 667 });
  await region(a.page).scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('shared-milestones-phone.png') });
  await a.page.route('**/rest/v1/rpc/get_duo_stats', async route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
  await a.page.reload(); await expect(region(a.page).getByRole('alert')).toContainText("Couldn't load");
  await a.page.unroute('**/rest/v1/rpc/get_duo_stats');
  await region(a.page).getByRole('button', { name: 'Retry milestones' }).click();
  await expect(region(a.page).getByText('10 rounds together', { exact: true })).toHaveCount(1);
  await a.page.reload(); await expect(region(a.page).getByText('10 rounds together', { exact: true })).toHaveCount(1);
});
