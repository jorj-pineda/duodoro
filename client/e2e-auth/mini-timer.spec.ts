import { randomUUID } from 'node:crypto';
import { test, expect } from './duoFixture';
import { onboard } from './onboard';

// Headless Chromium can't show a real Picture-in-Picture window, so back the
// API with a same-origin popup: the app writes into it exactly as it would.
async function installPictureInPictureProbe(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: {
      requestWindow: async ({ width, height }: { width: number; height: number }) => {
        const popup = window.open('about:blank', '', `popup,width=${width},height=${height}`);
        if (!popup) throw new DOMException('Blocked', 'NotAllowedError');
        return popup;
      },
    } });
  });
}

test('mini timer mirrors the room timer and closes with the room', async ({ duo }) => {
  const { a, roomCodes } = duo;
  await installPictureInPictureProbe(a.page);
  await a.page.goto('/');
  await onboard(a.page, 'Mini Alpha', `mt_${randomUUID().slice(0, 8)}`);
  await a.page.getByRole('button', { name: 'Focus', exact: true }).click();
  const room = await a.page.evaluate(() => localStorage.getItem('duodoro:session'));
  if (!room) throw new Error('Missing mini timer room'); roomCodes.add(room);

  await a.page.getByRole('button', { name: 'Flowmodoro', exact: true }).click();
  await a.page.getByRole('button', { name: 'Start solo', exact: true }).click();
  await expect(a.page).toHaveTitle(/· Flow · Duodoro/);

  const open = a.page.getByRole('button', { name: 'Open mini timer' });
  const [mini] = await Promise.all([a.page.waitForEvent('popup'), open.click()]);
  const timer = mini.getByRole('timer');
  await expect(mini.getByText('Flow', { exact: true })).toBeVisible();
  await expect(timer).toHaveText(/^\d\d:\d\d$/);
  // It shares the tab title's clock rather than keeping its own.
  await expect.poll(async () => (await a.page.title()).startsWith(`${await timer.textContent()} ·`)).toBe(true);
  await expect(a.page.getByRole('button', { name: 'Close mini timer' })).toBeVisible();
  await mini.screenshot({ path: test.info().outputPath('mini-timer-flow.png') });

  await a.page.getByRole('button', { name: 'Take break', exact: true }).click();
  await expect(mini.getByText('Break', { exact: true })).toBeVisible();
  await mini.screenshot({ path: test.info().outputPath('mini-timer-break.png') });

  // Closing from the page, then reopening, gives a fresh window.
  await Promise.all([mini.waitForEvent('close'), a.page.getByRole('button', { name: 'Close mini timer' }).click()]);
  await a.page.getByRole('button', { name: 'Stop timer', exact: true }).click();
  await a.page.getByRole('button', { name: 'Start solo', exact: true }).click();
  await expect(a.page).toHaveTitle(/· Flow · Duodoro/);
  const [again] = await Promise.all([a.page.waitForEvent('popup'), open.click()]);
  await expect(again.getByRole('timer')).toHaveText(/^\d\d:\d\d$/);

  // Leaving the room closes it.
  await Promise.all([again.waitForEvent('close'), a.page.getByRole('button', { name: /Leave room/ }).click()]);
  await expect(a.page.getByRole('button', { name: 'Focus', exact: true })).toBeVisible();
});
