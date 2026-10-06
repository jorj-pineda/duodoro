import { randomUUID } from 'node:crypto';
import { test, expect } from './duoFixture';
import { onboard } from './onboard';

test('optional break ideas survive refresh, dismiss one break and return on the next', async ({ duo }) => {
  const { a, roomCodes } = duo;
  await a.page.goto('/');
  await onboard(a.page, 'Break Alpha', `ba_${randomUUID().slice(0, 8)}`);
  await a.page.getByRole('button', { name: 'Focus', exact: true }).click();
  await a.page.getByRole('button', { name: 'Flowmodoro', exact: true }).click();
  const room = await a.page.evaluate(() => localStorage.getItem('duodoro:session'));
  if (!room) throw new Error('Missing break test room'); roomCodes.add(room);
  const ideas = a.page.getByRole('region', { name: 'Break ideas' });
  async function startBreak() {
    await a.page.getByRole('button', { name: 'Start solo', exact: true }).click();
    await expect(ideas).toHaveCount(0);
    // A live elapsed focus is required before the server accepts Take break.
    await expect(a.page).toHaveTitle(/00:0[1-9] · Flow · Duodoro/);
    await a.page.getByRole('button', { name: 'Take break', exact: true }).click();
    await expect(ideas.getByRole('heading', { name: 'Optional break ideas' })).toBeVisible();
  }
  await startBreak();
  await ideas.getByRole('button', { name: 'Show break ideas' }).click();
  await ideas.getByRole('button', { name: 'Another idea' }).click();
  await expect(ideas.getByRole('heading', { name: 'Gentle stretch' })).toBeVisible();
  await a.page.setViewportSize({ width: 375, height: 667 });
  await ideas.scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('break-ideas-phone.png') });
  await ideas.getByRole('button', { name: 'Hide for this break' }).click();
  await a.page.reload();
  await expect(ideas.getByText('Ideas are hidden for this break.')).toBeVisible();
  await expect(a.page).toHaveTitle(/00:\d\d · Break · Duodoro/);
  await a.page.getByRole('button', { name: 'Stop timer', exact: true }).click();
  await startBreak();
  await expect(ideas.getByRole('heading', { name: 'Water', exact: true })).toBeVisible();
  await a.page.setViewportSize({ width: 667, height: 375 });
  await ideas.scrollIntoViewIfNeeded();
  const bounds = await ideas.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(667);
  await a.page.screenshot({ path: test.info().outputPath('break-ideas-landscape.png') });
  await ideas.getByRole('button', { name: 'Turn off break ideas' }).click();
  await a.page.reload();
  await expect(ideas.getByRole('button', { name: 'Show break ideas' })).toBeVisible();
});
