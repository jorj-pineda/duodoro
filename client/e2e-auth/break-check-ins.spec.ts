import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, AUTH_STORAGE_KEY } from './duoFixture';
import { onboard } from './onboard';

test('private optional energy check-ins respect breaks, refresh-safe skipping, and unchanged Flow controls', async ({ duo }) => {
  test.setTimeout(180_000);
  const { a, b, roomCodes } = duo;
  let syncs = 0;
  // Observe real rejoin snapshots so refresh tests do not click timer controls
  // while cached room UI is still waiting for verified membership.
  await a.page.routeWebSocket(url => url.port === '3301' && url.pathname === '/socket.io/', socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => server.send(message));
    server.onMessage(message => {
      if (typeof message === 'string' && message.startsWith('42[') && JSON.parse(message.slice(2))[0] === 'sync_state') syncs++;
      socket.send(message);
    });
  });
  const suffix = randomUUID().slice(0,8);
  await a.page.goto('/'); await onboard(a.page,'Energy Alpha',`ea_${suffix}`);
  await a.page.getByRole('button',{ name: 'Focus', exact: true }).click();
  await a.page.getByRole('button',{ name: 'Copy invite link' }).click();
  await expect(a.page.getByText('Invite link copied!')).toBeVisible();
  const invite = await a.page.evaluate(() => navigator.clipboard.readText());
  const room = await a.page.evaluate(() => localStorage.getItem('duodoro:session'));
  if (!room) throw new Error('Missing check-in room'); roomCodes.add(room);
  await b.page.goto(invite);
  await expect(b.page.getByRole('heading',{ name: 'Focus together' })).toBeVisible();
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key,JSON.stringify(session)),{ key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload(); await onboard(b.page,'Energy Beta',`eb_${suffix}`);
  await expect(a.page.getByRole('button',{ name: 'Start session', exact: true })).toBeVisible();
  await a.page.getByRole('button',{ name: 'Flowmodoro', exact: true }).click();
  await a.page.getByRole('button',{ name: 'Start session', exact: true }).click();
  const checkIn = a.page.getByRole('region',{ name: 'Private break check-in', exact: true });
  await expect(checkIn).toHaveCount(0);
  await expect.poll(() => a.page.title()).toMatch(/0:0[1-9] · Flow/);
  await a.page.getByRole('button',{ name: 'Take break', exact: true }).click();
  await expect(checkIn.getByRole('button',{ name: 'Enable break check-ins' })).toBeVisible();
  await checkIn.getByRole('button',{ name: 'Enable break check-ins' }).click();
  await expect(checkIn.getByRole('button',{ name: 'Low', exact: true })).toBeFocused();
  await checkIn.getByRole('button',{ name: 'Low', exact: true }).click();
  await expect(checkIn.getByRole('status')).toContainText('finish for now');
  await expect(checkIn.getByText(/Flow resumes automatically/)).toBeVisible();
  await expect(b.page.getByRole('button',{ name: 'Low', exact: true })).toHaveCount(0);
  expect(await a.page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('duodoro:break-check')).map(key => localStorage.getItem(key)))).toEqual(['1']);
  expect(await a.page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('duodoro:break-check')))).toEqual([]);
  for (const theme of ['light','dark']) {
    if (theme === 'dark') await a.page.getByRole('button',{ name: 'Switch to dark mode' }).click();
    expect((await new AxeBuilder({ page: a.page }).include('[aria-label="Private break check-in"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  }
  await a.page.getByRole('button',{ name: 'Switch to light mode' }).click();
  for (const [name,width,height] of [['phone',375,667],['landscape',667,375]] as const) {
    await a.page.setViewportSize({ width,height });
    await checkIn.getByRole('button',{ name: 'Skip this break' }).scrollIntoViewIfNeeded();
    await expect(checkIn.getByRole('button',{ name: 'Skip this break' })).toBeInViewport();
    expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.page.screenshot({ path: test.info().outputPath(`check-in-${name}.png`) });
  }
  await checkIn.getByRole('button',{ name: 'Skip this break' }).click();
  await expect(checkIn.getByRole('button',{ name: 'Show this check-in' })).toBeFocused();
  const beforeReload = syncs;
  await a.page.reload();
  await expect.poll(() => syncs).toBeGreaterThan(beforeReload);
  await expect(checkIn.getByText('Skipped for this break.')).toBeVisible();
  await checkIn.getByRole('button',{ name: 'Show this check-in' }).click();
  await expect(checkIn.getByRole('button',{ name: 'Low', exact: true })).toHaveAttribute('aria-pressed','false');
  await a.page.getByRole('button',{ name: 'Stop timer', exact: true }).click();
  await expect(a.page.getByRole('button',{ name: 'Start session', exact: true })).toBeVisible();
  await expect(checkIn).toHaveCount(0);
  await a.page.getByRole('button',{ name: 'Start session', exact: true }).click();
  await expect.poll(() => a.page.title()).toMatch(/0:0[1-9] · Flow/);
  await a.page.getByRole('button',{ name: 'Take break', exact: true }).click();
  await expect(checkIn.getByRole('group',{ name: 'How is your energy?' })).toBeVisible();
  await expect(checkIn.getByRole('button',{ name: 'Low', exact: true })).toHaveAttribute('aria-pressed','false');
  await checkIn.getByRole('button',{ name: 'Turn off check-ins' }).click();
  await expect(checkIn.getByRole('button',{ name: 'Enable break check-ins' })).toBeFocused();
  const beforeOptOutReload = syncs;
  await a.page.reload();
  await expect.poll(() => syncs).toBeGreaterThan(beforeOptOutReload);
  await expect(checkIn.getByRole('button',{ name: 'Enable break check-ins' })).toBeVisible();
});
