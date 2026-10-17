import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, AUTH_STORAGE_KEY, requireSuccess } from './duoFixture';
import { APP_ORIGIN } from './localEnvironment';
import { onboard } from './onboard';
import { RoomTransport } from './roomTransport';

test('private preferences follow an account, preserve offline conflicts, and leave live timers alone', async ({ duo, browser }) => {
  const { a, b, admin, roomCodes } = duo;
  const legacy = {
    [`duodoro:companion:${a.id}`]: 'cat',
    [`duodoro:companion-name:${a.id}:cat`]: 'Legacy Nori',
    [`duodoro:session-presets:${a.id}`]: JSON.stringify([{ name: 'Desk', mode: 'pomodoro', focus: 25, break: 5 }]),
    [`duodoro:daily-goal:${a.id}`]: '90',
    [`duodoro:quiet-focus:${a.id}`]: 'true',
  };
  await a.page.goto('/');
  await a.page.evaluate(values => Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value)), legacy);
  await a.page.reload();
  await onboard(a.page, 'Sync Alpha', `sa_${randomUUID().slice(0, 8)}`);
  const target = (page: Page) => page.getByRole('combobox', { name: 'Daily focus target' });
  const status = (page: Page) => page.getByLabel('Preferences across devices', { exact: true });
  const row = async (key: string) => {
    const result = await a.client.from('account_preferences').select('*').eq('key', key).single();
    requireSuccess(result.error, 'Read own preference'); return result.data!;
  };
  await expect.poll(async () => (await a.client.from('account_preferences').select('key')).data?.length).toBe(5);
  await expect(target(a.page)).toHaveValue('90');
  await expect(status(a.page)).toContainText('Preferences are up to date');

  // Even an accepted friend cannot read account preferences.
  requireSuccess((await admin.from('friendships').insert({ requester_id: a.id, addressee_id: b.id, status: 'accepted' })).error, 'Create accepted friendship');
  const privateRead = await b.client.from('account_preferences').select('*').eq('user_id', a.id);
  requireSuccess(privateRead.error, 'Read under RLS'); expect(privateRead.data).toEqual([]);

  await expect.poll(async () => (await a.client.from('profiles').select('avatar_config').eq('id', a.id).single()).data?.avatar_config).not.toBeNull();
  const context = await browser.newContext({ baseURL: APP_ORIGIN, storageState: { cookies: [], origins: [{ origin: APP_ORIGIN, localStorage: [
    { name: AUTH_STORAGE_KEY, value: JSON.stringify(a.session) }, { name: 'duodoro-muted', value: 'true' },
  ] }] } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const device = await context.newPage();
  try {
    const transport = new RoomTransport(); await transport.observe(device);
    await device.goto('/');
    await expect(target(device)).toHaveValue('90');
    await expect(status(device)).toContainText('Preferences are up to date');
    await device.getByRole('button', { name: 'Focus', exact: true }).click();
    await device.getByRole('button', { name: 'Flowmodoro', exact: true }).click();
    const room = await device.evaluate(() => localStorage.getItem('duodoro:session'));
    if (!room) throw new Error('Missing preference test room'); roomCodes.add(room);
    // Access remains separately authorized; importing a choice grants no access.
    await device.getByRole('button', { name: 'Cat (unlock companions)' }).click();
    const access = device.getByRole('dialog', { name: 'Companions', exact: true });
    await access.getByRole('button', { name: 'Unlock companions', exact: true }).click();
    await access.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(device.getByRole('region', { name: 'Your companion name' })).toContainText('Legacy Nori');
    await expect(device.getByRole('region', { name: 'Session presets' })).toContainText('Desk');
    await expect(device.getByRole('checkbox', { name: 'Quiet focus mode' })).toBeChecked();
    await device.getByRole('button', { name: 'Start solo', exact: true }).click();
    await expect(device).toHaveTitle(/\d\d:\d\d · Flow · Duodoro/);
    await expect.poll(() => transport.phase?.phase).toBe('focus');
    const phase = JSON.stringify(transport.phase);
    const preset = await row('presets');
    requireSuccess((await a.client.rpc('set_account_preference', { p_key: 'presets', p_value: [{ name: 'Short', mode: 'pomodoro', focus: 15, break: 3 }], p_expected_version: preset.version })).error, 'Update favorites from other device');
    await device.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => device.evaluate(id => localStorage.getItem(`duodoro:session-presets:${id}`), a.id)).toContain('Short');
    expect(JSON.stringify(transport.phase)).toBe(phase);
    await expect(device).toHaveTitle(/\d\d:\d\d · Flow · Duodoro/);
    await device.getByRole('button', { name: 'Stop timer', exact: true }).click();
    await expect.poll(async () => (await admin.from('sessions').select('id').eq('room_code', room)).data?.length).toBe(1);
    await device.getByRole('button', { name: /Leave room/ }).click();
    await expect(target(device)).toHaveValue('90');

    // Simulated network failure affects only preference reads/writes, never Auth.
    const readURL = '**/rest/v1/account_preferences?*';
    const writeURL = '**/rest/v1/rpc/set_account_preference';
    await device.route(readURL, route => route.fulfill({ status: 503, body: '{}' }));
    await device.route(writeURL, route => route.fulfill({ status: 503, body: '{}' }));
    await target(device).selectOption('120');
    await expect(status(device)).toContainText('account sync needs a retry');
    await device.reload();
    await expect(target(device)).toHaveValue('120');
    await expect(status(device)).toContainText('account sync needs a retry');
    await target(a.page).selectOption('180');
    await expect.poll(async () => (await row('daily_goal')).value).toBe(180);
    await device.unroute(readURL); await device.unroute(writeURL);
    await status(device).locator('summary').click();
    await device.getByRole('button', { name: 'Retry preference sync' }).click();
    const conflict = device.getByRole('region', { name: 'Daily focus target conflict' });
    await expect(conflict).toContainText('This device: 120');
    await expect(conflict).toContainText('Account: 180');
    await device.setViewportSize({ width: 375, height: 667 });
    await conflict.scrollIntoViewIfNeeded();
    await device.screenshot({ path: test.info().outputPath('preference-conflict-phone.png') });
    expect((await new AxeBuilder({ page: device }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await device.setViewportSize({ width: 667, height: 375 });
    await conflict.scrollIntoViewIfNeeded();
    await device.screenshot({ path: test.info().outputPath('preference-conflict-landscape.png') });
    expect(await device.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await conflict.getByRole('button', { name: "Keep this device's value" }).click();
    await expect.poll(async () => (await row('daily_goal')).value).toBe(120);
    await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(target(a.page)).toHaveValue('120');

    // The server commits, but its acknowledgement is lost. Reload must confirm
    // the existing revision instead of silently issuing a duplicate write.
    let writes = 0;
    await device.route(writeURL, async route => {
      writes++; await route.fetch(); await route.fulfill({ status: 503, body: '{}' });
    });
    await target(device).selectOption('240');
    await expect(status(device)).toContainText('account sync needs a retry');
    const committed = await row('daily_goal'); expect(committed.value).toBe(240);
    await device.unroute(writeURL); await device.reload();
    await expect(target(device)).toHaveValue('240');
    await expect(status(device)).toContainText('Preferences are up to date');
    expect((await row('daily_goal')).version).toBe(committed.version); expect(writes).toBe(1);
  } finally { await context.tracing.stop({ path: test.info().outputPath('second-device.zip') }); await context.close(); }
});
