import { randomUUID } from 'node:crypto';
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from './duoFixture';
import { onboard } from './onboard';

test('weekly recap shows completed shared focus and retries without exposing solo focus', async ({ duo }) => {
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Recap Alpha', `ra_${suffix}`);
  await b.page.goto('/');
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload();
  await onboard(b.page, 'Recap Beta', `rb_${suffix}`);
  async function save(ids: string[], seconds: number, completed = true) {
    const room = randomUUID(); roomCodes.add(room);
    const result = await admin.rpc('record_focus_session', {
      p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest',
      p_focus_duration: seconds, p_break_duration: 60, p_actual_focus: seconds,
      p_completed: completed, p_started_at: new Date(Date.now() - seconds * 1000).toISOString(), p_user_ids: ids,
    });
    requireSuccess(result.error, 'Save recap fixture');
  }
  await save([a.id, b.id], 1200);
  await save([b.id], 2400);
  await save([a.id, b.id], 600, false);
  await a.page.reload();
  const recap = a.page.getByRole('region', { name: 'Weekly duo recap' });
  await expect(recap.getByText('With Recap Beta')).toBeVisible();
  await expect(recap.getByText('20m together', { exact: true })).toBeVisible();
  await expect(recap.getByText('1 round completed')).toBeVisible();
  await expect(recap.getByText('40m together')).toHaveCount(0);
  await a.page.setViewportSize({ width: 375, height: 667 });
  await recap.scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('weekly-recap-phone.png') });
  await a.page.route('**/rest/v1/rpc/get_weekly_duo_recap', async route => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) });
  });
  await a.page.reload();
  await expect(recap.getByRole('alert')).toContainText("Couldn't load");
  await a.page.unroute('**/rest/v1/rpc/get_weekly_duo_recap');
  await recap.getByRole('button', { name: 'Retry weekly recap' }).click();
  await expect(recap.getByText('20m together', { exact: true })).toBeVisible();
});
