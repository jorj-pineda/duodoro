import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import WeeklyDuoRecap from './WeeklyDuoRecap';
const hook = vi.fn();
vi.mock('@/hooks/useWeeklyDuoRecap', () => ({ useWeeklyDuoRecap: (...args: unknown[]) => hook(...args) }));
beforeEach(() => hook.mockReset());
it('shows loading and failure without claiming zero focus', () => {
  hook.mockReturnValue({ rows: [], loaded: false, error: null, timezone: null });
  const view = render(<WeeklyDuoRecap userId="alice" connected />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  hook.mockReturnValue({ rows: [], loaded: false, error: 'Unavailable', timezone: null });
  view.rerender(<WeeklyDuoRecap userId="alice" connected />);
  expect(screen.getByRole('alert')).toHaveTextContent('Unavailable');
  expect(screen.queryByText(/No completed/)).toBeNull();
});
it('labels the shared rounds and growth contribution without exposing solo totals', () => {
  hook.mockReturnValue({ rows: [{ partner_id: 'bob', partner_name: 'Bob', focus_seconds: 1800, completed_rounds: 2, week_start: '2026-10-05', week_end: '2026-10-11' }], loaded: true, error: null, timezone: 'UTC' });
  render(<WeeklyDuoRecap userId="alice" connected />);
  expect(screen.getByText('30m together')).toBeVisible(); expect(screen.getByText('2 rounds completed')).toBeVisible();
  expect(screen.getByText(/toward each companion/)).toBeVisible();
});
