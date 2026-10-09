import { randomUUID } from 'node:crypto';
import { test, expect, requireSuccess, AUTH_STORAGE_KEY } from './duoFixture';
import { onboard } from './onboard';
import type { Page } from '@playwright/test';

const openStats = async (page: Page) => {
  await page.getByRole('button', { name: 'Open stats', exact: true }).click();
  await page.getByRole('tab', { name: 'calendar' }).click();
};
const calendarFor = (page: Page) => page.getByRole('region', { name: 'Focus calendar' });
const roundWith = (scope: ReturnType<typeof calendarFor>, partner: string) => scope.getByRole('article').filter({ hasText: `With ${partner}` });
const noteBox = (round: ReturnType<typeof roundWith>) => round.getByRole('textbox', { name: 'How did this session go?' });

test('private reflections on a shared round stay private to each person across reloads and both calendar views', async ({ duo }) => {
  test.setTimeout(240_000);
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Reflect Alpha', `ra_${suffix}`);
  await b.page.goto('/');
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload();
  await onboard(b.page, 'Reflect Beta', `rb_${suffix}`);

  async function save(ids: string[], seconds: number) {
    const room = randomUUID(); roomCodes.add(room);
    const saved = await admin.rpc('record_focus_session', {
      p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: Math.max(600, seconds),
      p_break_duration: 60, p_actual_focus: seconds, p_completed: true,
      p_started_at: new Date(Date.now() - seconds * 1000).toISOString(), p_user_ids: ids,
    });
    requireSuccess(saved.error, 'Save reflection fixture');
  }
  // The shared round is saved first, so it is the oldest on the day and sits past the first 20 rows.
  await save([a.id, b.id], 900);
  for (let round = 0; round < 23; round++) await save([a.id], 60);

  await openStats(a.page);
  const calendar = calendarFor(a.page);
  await expect(calendar.getByText('38m · 24 completed rounds this month')).toBeVisible();
  await calendar.getByRole('button', { name: 'Show more rounds (4 remaining)' }).click();
  const shared = roundWith(calendar, 'Reflect Beta');
  await expect(shared).toHaveCount(1);
  await expect(shared.getByRole('button', { name: 'Add reflection', exact: true })).toBeVisible();

  await shared.getByRole('button', { name: 'Add reflection', exact: true }).click();
  await expect(noteBox(shared)).toHaveAccessibleDescription(/Only you can see this\./);
  await noteBox(shared).fill('Felt steady after the rough start.\nWant more breaks.');
  await shared.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(shared.getByText('Reflection saved')).toBeVisible();
  await expect(shared.getByText('Felt steady after the rough start.')).toBeVisible();

  // Survives reload, including the second page of calendar rounds.
  await a.page.reload();
  await openStats(a.page);
  await a.page.getByRole('region', { name: 'Focus calendar' }).getByRole('button', { name: 'Show more rounds (4 remaining)' }).click();
  await expect(roundWith(calendarFor(a.page), 'Reflect Beta').getByText('Want more breaks.')).toBeVisible();

  // Full calendar: the same note, owned by the same person.
  await a.page.getByRole('button', { name: 'View detailed stats →' }).click();
  const full = a.page.getByRole('dialog', { name: 'Your stats', exact: true });
  await full.getByRole('button', { name: 'Show more rounds (4 remaining)' }).click();
  await expect(roundWith(full, 'Reflect Beta').getByText('Felt steady after the rough start.')).toBeVisible();
  await full.getByRole('button', { name: 'Close', exact: true }).click();

  // Partner sees the shared round but never Alpha's note; Beta writes an independent one.
  await openStats(b.page);
  const bCalendar = calendarFor(b.page);
  await expect(bCalendar.getByText('15m · 1 completed round this month')).toBeVisible();
  const bShared = roundWith(bCalendar, 'Reflect Alpha');
  await expect(bShared.getByText('Felt steady after the rough start.')).toHaveCount(0);
  await expect(bShared.getByRole('button', { name: 'Add reflection', exact: true })).toBeVisible();
  await bShared.getByRole('button', { name: 'Add reflection', exact: true }).click();
  await noteBox(bShared).fill("Beta's own note.");
  await bShared.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(bShared.getByText('Reflection saved')).toBeVisible();

  await a.page.reload();
  await openStats(a.page);
  await a.page.getByRole('region', { name: 'Focus calendar' }).getByRole('button', { name: 'Show more rounds (4 remaining)' }).click();
  const aShared = roundWith(calendarFor(a.page), 'Reflect Beta');
  await expect(aShared.getByText('Felt steady after the rough start.')).toBeVisible();
  await expect(aShared.getByText("Beta's own note.")).toHaveCount(0);

  // Solo/Duo filter moves the shared round in and out of the list.
  await calendarFor(a.page).getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(roundWith(calendarFor(a.page), 'Reflect Beta')).toHaveCount(0);
  await calendarFor(a.page).getByRole('button', { name: 'Duo', exact: true }).click();
  await expect(roundWith(calendarFor(a.page), 'Reflect Beta')).toHaveCount(1);

  // Edit, then delete on Alpha's side; Beta's note is untouched.
  await roundWith(calendarFor(a.page), 'Reflect Beta').getByRole('button', { name: 'Edit reflection', exact: true }).click();
  // Phone width while the editor is open: the textarea, count and buttons must fit without page overflow.
  await a.page.setViewportSize({ width: 375, height: 667 });
  await roundWith(calendarFor(a.page), 'Reflect Beta').scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('session-reflections-phone-editing.png') });
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await noteBox(roundWith(calendarFor(a.page), 'Reflect Beta')).fill('Edited: steady, then fading.');
  await roundWith(calendarFor(a.page), 'Reflect Beta').getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(roundWith(calendarFor(a.page), 'Reflect Beta').getByText('Reflection saved')).toBeVisible();
  await a.page.setViewportSize({ width: 667, height: 375 });
  await roundWith(calendarFor(a.page), 'Reflect Beta').scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('session-reflections-landscape-saved.png') });
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.setViewportSize({ width: 375, height: 667 });
  await a.page.reload();
  await openStats(a.page);
  await calendarFor(a.page).getByRole('button', { name: 'Duo', exact: true }).click();
  await expect(roundWith(calendarFor(a.page), 'Reflect Beta').getByText('Edited: steady, then fading.')).toBeVisible();

  await roundWith(calendarFor(a.page), 'Reflect Beta').getByRole('button', { name: 'Delete reflection', exact: true }).click();
  const confirm = roundWith(calendarFor(a.page), 'Reflect Beta').getByRole('group', { name: 'Delete reflection?' });
  await confirm.getByRole('button', { name: 'Delete reflection', exact: true }).click();
  await expect(roundWith(calendarFor(a.page), 'Reflect Beta').getByText('Reflection deleted')).toBeVisible();
  await a.page.reload();
  await openStats(a.page);
  await calendarFor(a.page).getByRole('button', { name: 'Duo', exact: true }).click();
  await expect(roundWith(calendarFor(a.page), 'Reflect Beta').getByRole('button', { name: 'Add reflection', exact: true })).toBeVisible();

  await b.page.reload();
  await openStats(b.page);
  await expect(roundWith(calendarFor(b.page), 'Reflect Alpha').getByText("Beta's own note.")).toBeVisible();

});

test('a failed read or save keeps every draft recoverable, and a stale tab cannot overwrite a newer note', async ({ duo }) => {
  test.setTimeout(240_000);
  const { a, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Stale Alpha', `sa_${suffix}`);
  const room = randomUUID(); roomCodes.add(room);
  const seeded = await admin.rpc('record_focus_session', {
    p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: 600,
    p_break_duration: 60, p_actual_focus: 600, p_completed: true,
    p_started_at: new Date(Date.now() - 600_000).toISOString(), p_user_ids: [a.id],
  });
  requireSuccess(seeded.error, 'Save solo reflection fixture');

  await openStats(a.page);
  const calendar = calendarFor(a.page);
  const round = calendar.getByRole('article').filter({ hasText: 'Solo focus' }).first();
  await round.getByRole('button', { name: 'Add reflection', exact: true }).click();
  await noteBox(round).fill('First draft');
  await round.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(round.getByText('Reflection saved')).toBeVisible();

  // Failed read: an error, not "no reflection", then an explicit retry recovers it.
  await a.page.route('**/rest/v1/session_reflections**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
  await a.page.reload();
  await openStats(a.page);
  const failed = calendarFor(a.page).getByRole('article').filter({ hasText: 'Solo focus' }).first();
  await expect(failed.getByRole('alert')).toContainText("Couldn't load your reflection");
  await expect(failed.getByRole('button', { name: 'Add reflection', exact: true })).toHaveCount(0);
  await a.page.unroute('**/rest/v1/session_reflections**');
  await failed.getByRole('button', { name: 'Retry reflection', exact: true }).click();
  await expect(failed.getByText('First draft')).toBeVisible();

  // Failed save keeps the typed draft and the saved text, and a retry saves it.
  await failed.getByRole('button', { name: 'Edit reflection', exact: true }).click();
  await noteBox(failed).fill('Second draft');
  await a.page.route('**/rest/v1/rpc/update_session_reflection', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
  await failed.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(failed.getByRole('alert')).toContainText('Your draft is still here');
  await expect(noteBox(failed)).toHaveValue('Second draft');
  await a.page.unroute('**/rest/v1/rpc/update_session_reflection');
  await failed.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(failed.getByText('Reflection saved')).toBeVisible();

  // A second tab saves a newer version while this tab is still editing an older one.
  const tabTwo = await a.page.context().newPage();
  await tabTwo.goto('/');
  await tabTwo.getByRole('button', { name: 'Open stats', exact: true }).click();
  await tabTwo.getByRole('tab', { name: 'calendar' }).click();
  const other = tabTwo.getByRole('region', { name: 'Focus calendar' }).getByRole('article').filter({ hasText: 'Solo focus' }).first();
  await expect(other.getByText('Second draft')).toBeVisible();
  await other.getByRole('button', { name: 'Edit reflection', exact: true }).click();
  await noteBox(other).fill('Tab two wins');
  await other.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(other.getByText('Reflection saved')).toBeVisible();

  await failed.getByRole('button', { name: 'Edit reflection', exact: true }).click();
  await noteBox(failed).fill('Tab one stale draft');
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(failed.getByText(/changed in another tab or device/)).toBeVisible();
  await expect(noteBox(failed)).toHaveValue('Tab one stale draft');
  await failed.scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('session-reflections-conflict.png') });
  await failed.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(failed.getByText(/Your draft is still here/)).toBeVisible();
  await expect(noteBox(failed)).toHaveValue('Tab one stale draft');
  await failed.getByRole('button', { name: /Reload saved reflection/ }).click();
  await expect(noteBox(failed)).toHaveValue('Tab two wins');
  await tabTwo.close();
});
