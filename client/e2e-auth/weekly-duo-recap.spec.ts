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
  // The recap also refreshes on its own (socket connect, window focus), so a
  // refresh can recover it and detach Retry mid-click once the outage ends.
  let failing = true;
  let requests = 0;
  await a.page.route('**/rest/v1/rpc/get_weekly_duo_recap', async route => {
    requests += 1;
    if (!failing) return route.continue();
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) });
  });
  await a.page.reload();
  await expect(recap.getByRole('alert')).toContainText("Couldn't load");
  const retry = recap.getByRole('button', { name: 'Retry weekly recap' });
  // During the outage Retry is stable: prove it reaches the network and keeps
  // the error visible.
  const beforeFailedRetry = requests;
  await retry.click({ timeout: 15_000 });
  await expect.poll(() => requests).toBeGreaterThan(beforeFailedRetry);
  await expect(recap.getByRole('alert')).toContainText("Couldn't load");
  failing = false;
  const recovered = recap.getByText('20m together', { exact: true });
  // Retry if it is still offered; an automatic refresh may win the race.
  await expect(async () => {
    if (await retry.count()) await retry.click({ timeout: 1_000 });
    await expect(recovered).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(recap.getByRole('alert')).toHaveCount(0);
  await a.page.unroute('**/rest/v1/rpc/get_weekly_duo_recap');
});
