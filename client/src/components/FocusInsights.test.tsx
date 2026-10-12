import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ day: '2026-10-03', calendar: vi.fn(), retry: vi.fn() }));
vi.mock('@/hooks/useDailyFocusGoal', () => ({ useLocalDay: () => mocks.day }));
vi.mock('@/hooks/useFocusCalendar', () => ({ useFocusCalendar: mocks.calendar }));
import FocusInsights from './FocusInsights';
import { rememberFocusTags, resetFocusTagStore, retainFocusTagAccount } from '@/hooks/useSessionFocusTags';
const state = (overrides = {}) => ({ rows: [], loaded: true, error: null, timezone: 'America/Chicago', tagsAvailable: true, retry: mocks.retry, ...overrides });
const row = (day: string, seconds: number, tag: string) => ({ day, solo_seconds: seconds, duo_seconds: 0, solo_rounds: 1, duo_rounds: 0, sessions: [{ focus_seconds: seconds, private_tag: tag }] });
beforeEach(() => { resetFocusTagStore(); vi.clearAllMocks(); mocks.day = '2026-10-03'; mocks.calendar.mockReturnValue(state()); });
it('waits for both months instead of showing a partial seven-day total', () => {
  mocks.calendar.mockImplementation((_user, month) => month === '2026-09' ? state({ loaded: false }) : state({ rows: [row('2026-10-03', 600, 'work')] }));
  render(<FocusInsights userId="owner" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading insights');
  expect(screen.queryByText('Completed focus')).toBeNull();
  expect(mocks.calendar).toHaveBeenCalledWith('owner', '2026-09');
});
it('combines month boundaries and switches to month-to-date without prior-month data', () => {
  mocks.calendar.mockImplementation((_user, month) => state({ rows: month === '2026-09' ? [row('2026-09-30', 1200, 'study')] : [row('2026-10-03', 600, 'work')] }));
  render(<FocusInsights userId="owner" />);
  expect(screen.getByText('30m')).toBeVisible();
  expect(within(screen.getByRole('list', { name: 'Focus by private tag' })).getByText('Study')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'month' } });
  expect(screen.getAllByText('10m').length).toBeGreaterThan(0);
  expect(screen.queryByText('Study')).toBeNull();
});
it('provides retry for failures and never claims an empty successful period', () => {
  mocks.calendar.mockReturnValue(state({ loaded: false, error: 'failed' }));
  render(<FocusInsights userId="owner" />);
  expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load");
  expect(screen.queryByText(/No completed focus rounds/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry insights' }));
  expect(mocks.retry).toHaveBeenCalledTimes(2);
});
it('labels stale totals and unavailable tags without claiming untagged data', () => {
  mocks.day = '2026-10-12';
  mocks.calendar.mockReturnValue(state({ rows: [row('2026-10-12', 600, 'work')], error: 'refresh failed', tagsAvailable: false }));
  render(<FocusInsights userId="owner" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Showing the last loaded rounds');
  expect(screen.getByText(/Private tags are unavailable/)).toBeVisible();
  expect(screen.queryByRole('list', { name: 'Focus by private tag' })).toBeNull();
});
it('shows a neutral loading frame before the local day is known', () => {
  mocks.day = ''; mocks.calendar.mockReturnValue(state({ loaded: false }));
  render(<FocusInsights userId="owner" />);
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.queryByText(/Invalid Date/)).toBeNull();
});

it('uses newer confirmed edits without borrowing another account’s private tags', () => {
  mocks.day = '2026-10-12';
  retainFocusTagAccount('owner');
  const savedRow = { ...row('2026-10-12', 600, 'work'), sessions: [{ id: 'saved', focus_seconds: 600, private_tag: 'work', private_tag_version: 1 }] };
  mocks.calendar.mockReturnValue(state({ rows: [savedRow] }));
  render(<FocusInsights userId="owner" />);
  expect(screen.getByText('Work')).toBeVisible();
  act(() => rememberFocusTags('owner', [{ sessionId: 'saved', tag: 'creative', version: 2 }]));
  expect(screen.getByText('Creative')).toBeVisible();
  expect(screen.queryByText('Work')).toBeNull();
  act(() => rememberFocusTags('partner', [{ sessionId: 'saved', tag: 'study', version: 3 }]));
  expect(screen.queryByText('Study')).toBeNull();
});
