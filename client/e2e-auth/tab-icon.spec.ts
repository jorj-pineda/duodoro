import { randomUUID } from 'node:crypto';
import { test, expect } from './duoFixture';
import { onboard } from './onboard';

test('tab progress icon follows focus and break, then restores the site icon', async ({ duo }) => {
  const { a, roomCodes } = duo;
  await a.page.goto('/');
  await onboard(a.page, 'Icon Alpha', `ic_${randomUUID().slice(0, 8)}`);
  const timerIcon = a.page.locator('head link[rel="icon"][data-duodoro-timer]');
  const siteIcon = a.page.locator('head link[rel="icon"]:not([data-duodoro-timer])');
  const siteIcons = await siteIcon.count();
  expect(siteIcons).toBeGreaterThan(0);
  await expect(timerIcon).toHaveCount(0);

  await a.page.getByRole('button', { name: 'Focus', exact: true }).click();
  const room = await a.page.evaluate(() => localStorage.getItem('duodoro:session'));
  if (!room) throw new Error('Missing tab icon room'); roomCodes.add(room);
  await expect(timerIcon).toHaveCount(0);
  await a.page.getByRole('button', { name: 'Flowmodoro', exact: true }).click();
  await a.page.getByRole('button', { name: 'Start solo', exact: true }).click();
  await expect(a.page).toHaveTitle(/· Flow · Duodoro/);
  await expect(timerIcon).toHaveCount(1);
  const focusHref = await timerIcon.getAttribute('href');
  expect(focusHref).toMatch(/^data:image\/svg\+xml,/);

  // The icon survives a reload into the same live round.
  await a.page.reload();
  await expect(a.page.getByRole('timer')).toBeVisible();
  await expect(timerIcon).toHaveCount(1);
  await expect(timerIcon).toHaveAttribute('href', focusHref!);

  await a.page.getByRole('button', { name: 'Take break', exact: true }).click();
  await expect(a.page).toHaveTitle(/· Break · Duodoro/);
  await expect(timerIcon).toHaveCount(1);
  await expect(timerIcon).not.toHaveAttribute('href', focusHref!);
  const breakHref = (await timerIcon.getAttribute('href'))!;

  // Render both icons at real tab sizes for visual review.
  await a.page.evaluate(({ focus, pause }) => {
    const sheet = document.createElement('div');
    sheet.id = 'icon-sheet';
    sheet.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;display:flex;gap:16px;align-items:center;padding:16px';
    for (const href of [focus, pause]) for (const size of [16, 32, 64]) {
      const img = document.createElement('img'); img.src = href; img.width = size; img.height = size; sheet.append(img);
    }
    document.body.append(sheet);
  }, { focus: focusHref!, pause: breakHref });
  await a.page.locator('#icon-sheet').screenshot({ path: test.info().outputPath('tab-icons.png') });
  await a.page.evaluate(() => document.getElementById('icon-sheet')?.remove());

  await a.page.getByRole('button', { name: 'Stop timer', exact: true }).click();
  await expect(a.page).toHaveTitle(/Ready to start · Duodoro/);
  await expect(timerIcon).toHaveCount(0);
  await a.page.getByRole('button', { name: 'Start solo', exact: true }).click();
  await expect(timerIcon).toHaveCount(1);
  await a.page.getByRole('button', { name: /Leave room/ }).click();
  await expect(a.page.getByRole('button', { name: 'Focus', exact: true })).toBeVisible();
  await expect(timerIcon).toHaveCount(0);
  await expect(siteIcon).toHaveCount(siteIcons);
});
