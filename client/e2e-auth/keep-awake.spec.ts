import { randomUUID } from 'node:crypto';
import { test, expect } from './duoFixture';
import { onboard } from './onboard';

// Headless Chromium's real wake lock depends on the host, so record the
// browser API calls instead and assert the lifecycle the app drives.
async function installWakeLockProbe(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const log: string[] = [];
    const held = new Set<EventTarget>();
    (window as unknown as { __wakeLog: string[]; __wakeHeld: () => number; __wakeDrop: () => void }).__wakeLog = log;
    (window as unknown as { __wakeHeld: () => number }).__wakeHeld = () => held.size;
    // Simulates the browser releasing the lock itself, as it does on hidden tabs.
    (window as unknown as { __wakeDrop: () => void }).__wakeDrop = () => {
      for (const lock of held) { held.delete(lock); lock.dispatchEvent(new Event('release')); }
    };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: async (type: string) => {
        log.push(`request:${type}`);
        const lock = new EventTarget() as EventTarget & { release: () => Promise<void> };
        lock.release = async () => {
          if (!held.delete(lock)) return;
          log.push('release');
          lock.dispatchEvent(new Event('release'));
        };
        held.add(lock);
        return lock;
      },
    } });
  });
}

test('keep screen awake holds a lock only during focus and restores it on tab return', async ({ duo }) => {
  const { a, roomCodes } = duo;
  await installWakeLockProbe(a.page);
  await a.page.goto('/');
  await onboard(a.page, 'Awake Alpha', `aw_${randomUUID().slice(0, 8)}`);
  const held = () => a.page.evaluate(() => (window as unknown as { __wakeHeld: () => number }).__wakeHeld());
  const requests = () => a.page.evaluate(() => (window as unknown as { __wakeLog: string[] }).__wakeLog.filter(entry => entry.startsWith('request')).length);
  await a.page.getByRole('button', { name: 'Focus', exact: true }).click();
  const room = await a.page.evaluate(() => localStorage.getItem('duodoro:session'));
  if (!room) throw new Error('Missing keep-awake room'); roomCodes.add(room);
  const awake = a.page.getByRole('checkbox', { name: 'Keep screen awake while focusing' });
  await expect(awake).toBeEnabled();
  await expect(awake).not.toBeChecked();

  // Off by default: focusing does not touch the API.
  await a.page.getByRole('button', { name: 'Flowmodoro', exact: true }).click();
  await a.page.getByRole('button', { name: 'Start solo', exact: true }).click();
  await expect(a.page).toHaveTitle(/· Flow · Duodoro/);
  expect(await requests()).toBe(0);

  await awake.check();
  await expect.poll(held).toBe(1);
  await a.page.setViewportSize({ width: 375, height: 667 });
  await awake.scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('keep-awake-phone.png') });

  // The browser drops the lock while hidden; returning to the tab re-requests it.
  await a.page.evaluate(() => (window as unknown as { __wakeDrop: () => void }).__wakeDrop());
  expect(await held()).toBe(0);
  await a.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(held).toBe(1);

  // A break releases it; it is not held again until the next focus.
  await a.page.getByRole('button', { name: 'Take break', exact: true }).click();
  await expect(a.page).toHaveTitle(/· Break · Duodoro/);
  await expect.poll(held).toBe(0);

  // The choice survives a reload and applies to the next focus round.
  await a.page.reload();
  await expect(awake).toBeChecked();
  await a.page.getByRole('button', { name: 'Stop timer', exact: true }).click();
  await a.page.getByRole('button', { name: 'Start solo', exact: true }).click();
  await expect(a.page).toHaveTitle(/· Flow · Duodoro/);
  await expect.poll(held).toBe(1);

  await a.page.getByRole('button', { name: /Leave room/ }).click();
  await expect(a.page.getByRole('button', { name: 'Focus', exact: true })).toBeVisible();
  await expect.poll(held).toBe(0);
});
