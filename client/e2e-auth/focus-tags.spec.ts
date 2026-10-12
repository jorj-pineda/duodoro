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
const soloRounds = (scope: ReturnType<typeof calendarFor>) => scope.getByRole('article').filter({ hasText: 'Solo focus' });
const tagBox = (round: ReturnType<typeof roundWith>) => round.getByRole('combobox', { name: 'Private tag', exact: true });
const filterBox = (scope: ReturnType<typeof calendarFor>) => scope.getByRole('combobox', { name: 'Filter by private tag', exact: true });
const saveButton = (round: ReturnType<typeof roundWith>) => round.getByRole('button', { name: 'Save tag', exact: true });
const cancelButton = (round: ReturnType<typeof roundWith>) => round.getByRole('button', { name: 'Cancel', exact: true });

test('each person keeps a private tag on the same shared round, visible only to its owner in both calendar views', async ({ duo }) => {
  test.setTimeout(240_000);
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Tag Alpha', `ta_${suffix}`);
  await b.page.goto('/');
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload();
  await onboard(b.page, 'Tag Beta', `tb_${suffix}`);

  async function save(ids: string[], seconds: number) {
    const room = randomUUID(); roomCodes.add(room);
    const saved = await admin.rpc('record_focus_session', {
      p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: Math.max(600, seconds),
      p_break_duration: 60, p_actual_focus: seconds, p_completed: true,
      p_started_at: new Date(Date.now() - seconds * 1000).toISOString(), p_user_ids: ids,
    });
    requireSuccess(saved.error, 'Save focus tag fixture');
  }
  await save([a.id, b.id], 900);
  await save([a.id], 600);

  await openStats(a.page);
  const aCalendar = calendarFor(a.page);
  const aShared = roundWith(aCalendar, 'Tag Beta');
  await expect(tagBox(aShared)).toHaveValue('');
  await tagBox(aShared).selectOption('work');
  // Choosing an option does not save: the saved value only changes after Save.
  await expect(aShared.getByText('Tag saved')).toHaveCount(0);
  const aSave = a.page.waitForResponse(response => response.url().endsWith('/rpc/set_session_focus_tag') && response.request().method() === 'POST');
  await saveButton(aShared).click();
  expect((await aSave).status()).toBe(200);
  await expect(aShared.getByText('Tag saved', { exact: true })).toBeVisible();

  await openStats(b.page);
  const bShared = roundWith(calendarFor(b.page), 'Tag Alpha');
  await expect(tagBox(bShared)).toHaveValue('');
  await tagBox(bShared).selectOption('study');
  await saveButton(bShared).click();
  await expect(bShared.getByText('Tag saved', { exact: true })).toBeVisible();

  // Reload each side: each person sees only their own tag, never the partner's.
  await a.page.reload();
  await openStats(a.page);
  await expect(tagBox(roundWith(calendarFor(a.page), 'Tag Beta'))).toHaveValue('work');
  await a.page.getByRole('button', { name: 'View detailed stats →' }).click();
  const full = a.page.getByRole('dialog', { name: 'Your stats', exact: true });
  await expect(full.getByRole('combobox', { name: 'Private tag', exact: true }).nth(0)).toBeVisible();
  await expect(tagBox(roundWith(full, 'Tag Beta'))).toHaveValue('work');
  await full.getByRole('button', { name: 'Close', exact: true }).click();

  await b.page.reload();
  await openStats(b.page);
  await expect(tagBox(roundWith(calendarFor(b.page), 'Tag Alpha'))).toHaveValue('study');
  await expect(calendarFor(b.page).getByText('Filter by private tag', { exact: true })).toBeVisible();
});

test('assign, change and clear a solo tag without silent saves, keeping the reflection intact', async ({ duo }) => {
  test.setTimeout(240_000);
  const { a, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Solo Tagger', `st_${suffix}`);
  const room = randomUUID(); roomCodes.add(room);
  const saved = await admin.rpc('record_focus_session', {
    p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: 900,
    p_break_duration: 60, p_actual_focus: 900, p_completed: true,
    p_started_at: new Date(Date.now() - 900_000).toISOString(), p_user_ids: [a.id],
  });
  requireSuccess(saved.error, 'Save solo tag fixture');

  await openStats(a.page);
  const round = soloRounds(calendarFor(a.page)).first();
  await expect(tagBox(round)).toHaveValue('');
  await round.getByRole('button', { name: 'Add reflection', exact: true }).click();
  await round.getByRole('textbox', { name: 'How did this session go?' }).fill('Steady start.');
  await round.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(round.getByText('Reflection saved')).toBeVisible();

  await tagBox(round).selectOption('creative');
  await cancelButton(round).click();
  await expect(tagBox(round)).toHaveValue('');
  await tagBox(round).selectOption('creative');
  await saveButton(round).click();
  await expect(round.getByText('Tag saved', { exact: true })).toBeVisible();

  await tagBox(round).selectOption('planning');
  await saveButton(round).click();
  await expect(round.getByText('Tag saved', { exact: true })).toBeVisible();

  await tagBox(round).selectOption('');
  await saveButton(round).click();
  await expect(round.getByText('Tag removed', { exact: true })).toBeVisible();
  await expect(tagBox(round)).toHaveValue('');
  await expect(round.getByText('Steady start.')).toBeVisible();

  // Reassigning after a clear uses the cleared revision and must succeed.
  await tagBox(round).selectOption('reading');
  await saveButton(round).click();
  await expect(round.getByText('Tag saved', { exact: true })).toBeVisible();

  await a.page.reload();
  await openStats(a.page);
  await expect(tagBox(soloRounds(calendarFor(a.page)).first())).toHaveValue('reading');
  await expect(soloRounds(calendarFor(a.page)).first().getByText('Steady start.')).toBeVisible();
});

test('the tag filter composes with Solo/Duo, reaches rounds beyond the first page, and totals describe matching rounds', async ({ duo }) => {
  test.setTimeout(300_000);
  const { a, b, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Filter Alpha', `fa_${suffix}`);
  await b.page.goto('/');
  await b.page.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: b.session });
  await b.page.reload();
  await onboard(b.page, 'Filter Beta', `fb_${suffix}`);

  async function save(ids: string[], seconds: number) {
    const room = randomUUID(); roomCodes.add(room);
    const saved = await admin.rpc('record_focus_session', {
      p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: Math.max(600, seconds),
      p_break_duration: 60, p_actual_focus: seconds, p_completed: true,
      p_started_at: new Date(Date.now() - seconds * 1000).toISOString(), p_user_ids: ids,
    });
    requireSuccess(saved.error, 'Save filter fixture');
  }
  // The oldest round is tagged and sits beyond the first 20 displayed rounds.
  await save([a.id], 60);
  for (let index = 0; index < 23; index++) await save([a.id], 60);
  await save([a.id, b.id], 1500);

  await openStats(a.page);
  const calendar = calendarFor(a.page);
  await expect(calendar.getByText('49m · 25 completed rounds this month')).toBeVisible();
  await expect(calendar.getByRole('button', { name: 'Show more rounds (5 remaining)' })).toBeVisible();

  // Tag the oldest solo round through the second page so the filter must reach it.
  await calendar.getByRole('button', { name: 'Show more rounds (5 remaining)' }).click();
  const oldest = soloRounds(calendar).last();
  await tagBox(oldest).selectOption('study');
  const tagSave = a.page.waitForResponse(response => response.url().endsWith('/rpc/set_session_focus_tag') && response.request().method() === 'POST');
  await saveButton(oldest).click();
  expect((await tagSave).status()).toBe(200);
  await expect(oldest.getByText('Tag saved', { exact: true })).toBeVisible();

  await filterBox(calendar).selectOption('study');
  await expect(calendar.getByText('1m · 1 matching round this month')).toBeVisible();
  await expect(calendar.getByText(/Matching rounds only/)).toBeVisible();
  await expect(calendar.getByRole('button', { name: /Show more rounds/ })).toHaveCount(0);
  await expect(calendar.getByRole('article')).toHaveCount(1);

  await calendar.getByRole('button', { name: 'Duo', exact: true }).click();
  await expect(calendar.getByText('No completed duo rounds tagged Study on this day.')).toBeVisible();
  await calendar.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(calendar.getByRole('article')).toHaveCount(1);
  await filterBox(calendar).selectOption('untagged');
  await calendar.getByRole('button', { name: 'All', exact: true }).click();
  await expect(calendar.getByRole('button', { name: 'Show more rounds (4 remaining)' })).toBeVisible();

  await a.page.setViewportSize({ width: 375, height: 667 });
  await calendar.getByRole('combobox', { name: 'Filter by private tag', exact: true }).scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('focus-tags-phone-filter.png') });
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.setViewportSize({ width: 667, height: 375 });
  await calendar.getByRole('combobox', { name: 'Filter by private tag', exact: true }).scrollIntoViewIfNeeded();
  await a.page.screenshot({ path: test.info().outputPath('focus-tags-landscape-filter.png') });
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.page.setViewportSize({ width: 1280, height: 800 });
});

test('stale tabs get HTTP 409, keep their selection, and clear or reassign cannot revive an old revision', async ({ duo }) => {
  test.setTimeout(300_000);
  const { a, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Conflict Alpha', `ca2_${suffix}`);
  const room = randomUUID(); roomCodes.add(room);
  const saved = await admin.rpc('record_focus_session', {
    p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: 600,
    p_break_duration: 60, p_actual_focus: 600, p_completed: true,
    p_started_at: new Date(Date.now() - 600_000).toISOString(), p_user_ids: [a.id],
  });
  requireSuccess(saved.error, 'Save conflict fixture');

  await openStats(a.page);
  const round = soloRounds(calendarFor(a.page)).first();
  await tagBox(round).selectOption('work');
  await saveButton(round).click();
  await expect(round.getByText('Tag saved', { exact: true })).toBeVisible();

  const tabTwo = await a.page.context().newPage();
  await tabTwo.goto('/');
  await tabTwo.getByRole('button', { name: 'Open stats', exact: true }).click();
  await tabTwo.getByRole('tab', { name: 'calendar' }).click();
  const other = soloRounds(tabTwo.getByRole('region', { name: 'Focus calendar' })).first();
  await expect(tagBox(other)).toHaveValue('work');

  // Tab two changes the tag, so tab one's revision is now stale.
  await tagBox(other).selectOption('study');
  await saveButton(other).click();
  await expect(other.getByText('Tag saved', { exact: true })).toBeVisible();

  await tagBox(round).selectOption('planning');
  const staleSave = a.page.waitForResponse(response => response.url().endsWith('/rpc/set_session_focus_tag'));
  await saveButton(round).click();
  expect((await staleSave).status()).toBe(409);
  await expect(round.getByText(/changed in another tab or device/)).toBeVisible();
  await expect(tagBox(round)).toHaveValue('planning');

  // Explicit reload fails: the selection stays and the reload can be retried.
  await a.page.route('**/rest/v1/rpc/get_focus_calendar', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
  await round.getByRole('button', { name: /Reload saved tag/ }).click();
  await expect(round.getByText(/Couldn't reload the saved tag/)).toBeVisible();
  await expect(tagBox(round)).toHaveValue('planning');
  await a.page.unroute('**/rest/v1/rpc/get_focus_calendar');
  await round.getByRole('button', { name: /Reload saved tag/ }).click();
  await expect(round.getByText('Saved tag reloaded.')).toBeVisible();
  await expect(tagBox(round)).toHaveValue('study');

  // Tab two clears and reassigns; tab one's old revision must not revive.
  await tagBox(round).selectOption('reading');
  await tagBox(other).selectOption('');
  await saveButton(other).click();
  await expect(other.getByText('Tag removed', { exact: true })).toBeVisible();
  await tagBox(other).selectOption('other');
  await saveButton(other).click();
  await expect(other.getByText('Tag saved', { exact: true })).toBeVisible();
  const oldRevision = a.page.waitForResponse(response => response.url().endsWith('/rpc/set_session_focus_tag'));
  await saveButton(round).click();
  expect((await oldRevision).status()).toBe(409);
  await expect(round.getByText(/changed in another tab or device/)).toBeVisible();
  await expect(tagBox(round)).toHaveValue('reading');
  await tabTwo.close();
});

test('a failed save keeps the draft, a retry saves it, and a save that filters its round out leaves focus on the calendar', async ({ duo }) => {
  test.setTimeout(240_000);
  const { a, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Recover Alpha', `ra2_${suffix}`);
  const room = randomUUID(); roomCodes.add(room);
  const saved = await admin.rpc('record_focus_session', {
    p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: 600,
    p_break_duration: 60, p_actual_focus: 600, p_completed: true,
    p_started_at: new Date(Date.now() - 600_000).toISOString(), p_user_ids: [a.id],
  });
  requireSuccess(saved.error, 'Save recovery fixture');

  await openStats(a.page);
  const calendar = calendarFor(a.page);
  const round = soloRounds(calendar).first();
  await a.page.route('**/rest/v1/rpc/set_session_focus_tag', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
  await tagBox(round).selectOption('work');
  await saveButton(round).click();
  await expect(round.getByRole('alert')).toContainText("The tag couldn't be saved");
  await expect(tagBox(round)).toHaveValue('work');
  await a.page.unroute('**/rest/v1/rpc/set_session_focus_tag');
  await saveButton(round).click();
  await expect(round.getByText('Tag saved', { exact: true })).toBeVisible();

  // Untagged filter: tagging the only untagged round removes it from the list.
  await filterBox(calendar).selectOption('untagged');
  await expect(calendar.getByText('No completed focus rounds without a tag on this day.')).toBeVisible();
  await filterBox(calendar).selectOption('all');
  await expect(round.getByRole('combobox', { name: 'Private tag', exact: true })).toHaveValue('work');
  await filterBox(calendar).selectOption('untagged');
  // A second untagged round is needed to see a save remove a round from the filter.
  const room2 = randomUUID(); roomCodes.add(room2);
  const second = await admin.rpc('record_focus_session', {
    p_recording_key: randomUUID(), p_room_code: room2, p_world: 'forest', p_focus_duration: 600,
    p_break_duration: 60, p_actual_focus: 300, p_completed: true,
    p_started_at: new Date(Date.now() - 300_000).toISOString(), p_user_ids: [a.id],
  });
  requireSuccess(second.error, 'Save second recovery fixture');
  await a.page.reload();
  await openStats(a.page);
  await filterBox(calendarFor(a.page)).selectOption('untagged');
  const untagged = soloRounds(calendarFor(a.page)).first();
  await tagBox(untagged).selectOption('study');
  await saveButton(untagged).click();
  await expect(calendarFor(a.page).getByText(/That round no longer matches the current filters/)).toBeVisible();
  await expect(soloRounds(calendarFor(a.page))).toHaveCount(0);
  await expect(a.page.locator('[aria-pressed="true"][id^="focus-calendar-"]')).toBeFocused();
});

test('a filtered tag save preserves a dirty reflection until it is saved', async ({ duo }) => {
  test.setTimeout(240_000);
  const { a, admin, roomCodes } = duo;
  const suffix = randomUUID().slice(0, 8);
  await a.page.goto('/');
  await onboard(a.page, 'Draft Tagger', `dt_${suffix}`);
  const room = randomUUID(); roomCodes.add(room);
  const saved = await admin.rpc('record_focus_session', {
    p_recording_key: randomUUID(), p_room_code: room, p_world: 'forest', p_focus_duration: 900,
    p_break_duration: 60, p_actual_focus: 900, p_completed: true,
    p_started_at: new Date(Date.now() - 900_000).toISOString(), p_user_ids: [a.id],
  });
  requireSuccess(saved.error, 'Save solo tag fixture');

  await openStats(a.page);
  await filterBox(calendarFor(a.page)).selectOption('untagged');
  const round = soloRounds(calendarFor(a.page)).first();
  await expect(tagBox(round)).toHaveValue('');
  await round.getByRole('button', { name: 'Add reflection', exact: true }).click();
  const draft = round.getByRole('textbox', { name: 'How did this session go?' });
  await draft.fill('Keep this unfinished thought.');
  await tagBox(round).selectOption('work');
  await saveButton(round).click();
  await expect(round.getByText('Tag saved', { exact: true })).toBeVisible();
  await expect(draft).toHaveValue('Keep this unfinished thought.');
  await expect(calendarFor(a.page).getByText('0s · 0 matching rounds this month')).toBeVisible();
  await expect(round.getByText(/stays here while you finish/)).toBeVisible();
  await round.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(soloRounds(calendarFor(a.page))).toHaveCount(0);
  await expect(a.page.locator('[aria-pressed="true"][id^="focus-calendar-"]')).toBeFocused();
  await filterBox(calendarFor(a.page)).selectOption('all');
  await expect(soloRounds(calendarFor(a.page)).first().getByText('Keep this unfinished thought.')).toBeVisible();
});
