import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, AUTH_STORAGE_KEY } from './duoFixture';
import { onboard } from './onboard';
import { RoomTransport } from './roomTransport';

test('two partners consent to this break only, restore accepted time on reconnect, and keep declined or unanswered breaks unchanged', async ({ duo }) => {
  test.setTimeout(240_000);
  const { a, b, roomCodes } = duo;
  const transport = new RoomTransport();
  await transport.observe(a.page);
  const snapshots = transport.snapshots;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/'); await onboard(a.page, 'Break Alpha', `ba_${suffix}`);
  await a.page.getByRole('button', { name: 'Focus', exact: true }).click();
  await a.page.getByRole('button', { name: 'Copy invite link' }).click();
  await expect(a.page.getByText('Invite link copied!')).toBeVisible();
  const invite = await a.page.evaluate(() => navigator.clipboard.readText());
  const room = await a.page.evaluate(() => localStorage.getItem('duodoro:session'));
  if (!room) throw new Error('Missing break-extension room'); roomCodes.add(room);
  await b.page.goto('/');
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page, 'Break Beta', `bb_${suffix}`);
  await expect(b.page.getByRole('button', { name: 'Focus', exact: true })).toBeVisible();
  await b.page.goto(invite);
  await expect(a.page.getByRole('button', { name: 'Start session', exact: true })).toBeVisible();
  await a.page.getByRole('button', { name: 'Flowmodoro', exact: true }).click();
  const extension = (page: typeof a.page) => page.getByRole('region', { name: 'Shared break extension' });
  async function startBreak() {
    await a.page.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect.poll(() => a.page.title()).toMatch(/0:0[1-9] · Flow/);
    await a.page.getByRole('button', { name: 'Take break', exact: true }).click();
    await expect(extension(a.page).getByRole('button', { name: 'Ask for 2 more minutes' })).toBeVisible();
  }
  await startBreak();
  await extension(a.page).getByRole('button', { name: 'Ask for 2 more minutes' }).click();
  await expect(extension(a.page)).toContainText('Waiting for your partner');
  await expect(extension(a.page).getByRole('button')).toHaveCount(0);
  await expect(extension(b.page).getByRole('button', { name: 'Agree · +2 minutes' })).toBeVisible();
  await expect.poll(() => a.page.title()).toMatch(/0:[0-5][0-9] · Break/);
  const beforeReload = snapshots.length;
  await a.page.reload(); await expect.poll(() => snapshots.length).toBeGreaterThan(beforeReload);
  await expect(extension(a.page)).toContainText('Waiting for your partner');
  const initial = snapshots.at(-1)!;
  expect(initial.breakDuration).toBe(60);
  expect(initial.breakExtension?.status).toBe('pending');
  await b.page.setViewportSize({ width: 375, height: 667 });
  const agree = extension(b.page).getByRole('button', { name: 'Agree · +2 minutes' });
  await agree.scrollIntoViewIfNeeded();
  expect(await agree.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await b.page.screenshot({ path: test.info().outputPath('break-extension-pending-phone.png') });
  await agree.click();
  for (const actor of [a, b]) {
    await expect(extension(actor.page)).toContainText('Both agreed');
    await expect.poll(() => actor.page.title()).toMatch(/0[23]:[0-5][0-9] · Break/);
  }
  const acceptedReload = snapshots.length;
  await a.page.reload(); await expect.poll(() => snapshots.length).toBeGreaterThan(acceptedReload);
  const accepted = snapshots.at(-1)!;
  expect(accepted.phaseStartTime).toBe(initial.phaseStartTime);
  expect(accepted.breakDuration).toBe(60);
  expect(accepted.breakExtension?.extraSeconds).toBe(120);
  expect(accepted.completedRounds).toBe(initial.completedRounds);
  for (const [name, width, height] of [['phone', 375, 667], ['landscape', 667, 375]] as const) {
    await a.page.setViewportSize({ width, height });
    await extension(a.page).scrollIntoViewIfNeeded();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.page.screenshot({ path: test.info().outputPath(`break-extension-${name}.png`) });
  }
  expect((await new AxeBuilder({ page: a.page }).include('[aria-label="Shared break extension"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await a.page.getByRole('button', { name: 'Stop timer', exact: true }).click();
  await startBreak();
  await extension(a.page).getByRole('button', { name: 'Ask for 2 more minutes' }).click();
  await extension(b.page).getByRole('button', { name: 'Keep original break' }).click();
  for (const actor of [a, b]) await expect(extension(actor.page)).toContainText('Original break kept');
  await expect.poll(() => a.page.title()).toMatch(/0:[0-5][0-9] · Break/);
  await a.page.getByRole('button', { name: 'Stop timer', exact: true }).click();
  await startBreak();
  await extension(a.page).getByRole('button', { name: 'Ask for 2 more minutes' }).click();
  await expect(a.page.getByRole('button', { name: 'Take break', exact: true })).toBeVisible({ timeout: 75_000 });
  await expect(extension(a.page)).toHaveCount(0);
  const returnedReload = snapshots.length;
  await a.page.reload(); await expect.poll(() => snapshots.length).toBeGreaterThan(returnedReload);
  expect(snapshots.at(-1)?.phase).toBe('focus');
  expect(snapshots.at(-1)?.breakExtension).toBeNull();
  expect(snapshots.at(-1)?.breakDuration).toBe(60);
});
