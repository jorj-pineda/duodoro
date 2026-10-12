import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, requireSuccess, AUTH_STORAGE_KEY } from './duoFixture';
import { onboard } from './onboard';

test('insights keep solo activity and tags private, include all completed rounds, and recover failed reads', async ({ duo }) => {
  test.setTimeout(240_000);
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/'); await onboard(a.page, 'Insight Alpha', `ia_${suffix}`);
  await b.page.goto('/');
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page, 'Insight Beta', `ib_${suffix}`);
  async function save(ids: string[], seconds: number, completed = true) {
    const room = randomUUID(); roomCodes.add(room);
    const saved = await admin.rpc('record_focus_session', {
      p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: Math.max(600, seconds),
      p_break_duration: 60, p_actual_focus: seconds, p_completed: completed,
      p_started_at: new Date(Date.now() - seconds * 1000).toISOString(), p_user_ids: ids,
    });
    requireSuccess(saved.error, 'Save insight fixture');
    const found = await admin.from('sessions').select('id').eq('room_code', room).single();
    requireSuccess(found.error, 'Find insight fixture'); return found.data!.id;
  }
  const shared = await save([a.id, b.id], 900);
  for (let i = 0; i < 24; i++) await save([a.id], 60);
  await save([b.id], 3600); await save([a.id], 1800, false);
  // Generated RPC types omit SQL argument nullability; null means create-only.
  const createRevision = null as unknown as number;
  requireSuccess((await a.client.rpc('set_session_focus_tag', { p_session_id: shared, p_tag: 'work', p_expected_version: createRevision })).error, 'Set Alpha private tag');
  requireSuccess((await b.client.rpc('set_session_focus_tag', { p_session_id: shared, p_tag: 'study', p_expected_version: createRevision })).error, 'Set Beta private tag');
  for (const actor of [a, b]) {
    await actor.page.getByRole('button', { name: 'Open stats', exact: true }).click();
    await actor.page.getByRole('tab', { name: 'insights', exact: true }).click();
  }
  const aInsights = a.page.getByRole('region', { name: 'Private focus insights' });
  const bInsights = b.page.getByRole('region', { name: 'Private focus insights' });
  await expect(aInsights.locator('dl').getByText('39m', { exact: true })).toBeVisible();
  await expect(aInsights.getByText('25', { exact: true })).toBeVisible();
  await expect(aInsights.getByText('Solo: 24m · Duo: 15m')).toBeVisible();
  await expect(bInsights.locator('dl').getByText('1h 15m', { exact: true })).toBeVisible();
  await expect(bInsights.getByText('Solo: 1h 0m · Duo: 15m')).toBeVisible();
  const aTags = aInsights.getByRole('list', { name: 'Focus by private tag' });
  const bTags = bInsights.getByRole('list', { name: 'Focus by private tag' });
  await expect(aTags.getByText('Work', { exact: true })).toBeVisible();
  await expect(aTags.getByText('Study', { exact: true })).toHaveCount(0);
  await expect(bTags.getByText('Study', { exact: true })).toBeVisible();
  await expect(bTags.getByText('Work', { exact: true })).toHaveCount(0);
  await a.page.route('**/rest/v1/rpc/get_focus_calendar', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(aInsights.getByRole('alert')).toContainText('Showing the last loaded rounds');
  await a.page.unroute('**/rest/v1/rpc/get_focus_calendar');
  await aInsights.getByRole('button', { name: 'Retry insights' }).click();
  await expect(aInsights.getByRole('alert')).toHaveCount(0);
  await aInsights.getByRole('combobox', { name: 'Insights period' }).selectOption('month');
  await expect(aInsights.locator('dl').getByText('39m', { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page: a.page }).include('[aria-label="Private focus insights"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  for (const [name, width, height] of [['phone', 375, 667], ['landscape', 667, 375]] as const) {
    await a.page.setViewportSize({ width, height });
    await aInsights.scrollIntoViewIfNeeded();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.page.screenshot({ path: test.info().outputPath(`insights-${name}.png`) });
  }
  await a.page.getByRole('button', { name: 'View detailed stats →' }).click();
  const full = a.page.getByRole('dialog', { name: 'Your stats', exact: true });
  await expect(full.getByRole('region', { name: 'Private focus insights' }).locator('dl').getByText('39m', { exact: true })).toBeVisible();
});
