import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const hook = vi.fn();
vi.mock('@/hooks/useFocusCalendar', () => ({ useFocusCalendar: (...args: unknown[]) => hook(...args) }));
vi.mock('@/hooks/useDailyFocusGoal', () => ({ useLocalDay: () => '2026-10-07' }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }) }) }));
import FocusCalendar from './FocusCalendar';
beforeEach(() => hook.mockReset());
it('shows errors independently from empty saved history', () => {
  hook.mockReturnValue({ rows: [], loaded: false, error: 'Unavailable', timezone: 'UTC', retry: vi.fn() });
  render(<FocusCalendar userId="alice" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Unavailable'); expect(screen.queryByText(/0s ·/)).toBeNull();
});
it('filters totals and details, navigates dates by keyboard, and browses months', () => {
  hook.mockReturnValue({ rows: [{ day: '2026-10-07', solo_seconds: 600, duo_seconds: 1500, solo_rounds: 1, duo_rounds: 1, sessions: [
    { id: 'solo', focus_seconds: 600, world: 'forest', ended_at: '2026-10-07T10:00:00Z', is_duo: false, partner_name: 'Partner' },
    { id: 'duo', focus_seconds: 1500, world: 'forest', ended_at: '2026-10-07T11:00:00Z', is_duo: true, partner_name: 'Bob' },
  ] }], loaded: true, error: null, timezone: 'UTC' });
  render(<FocusCalendar userId="alice" />);
  expect(screen.getByText('35m · 2 completed rounds this month')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Duo' }));
  expect(screen.getByText('25m · 1 completed round this month')).toBeVisible();
  expect(screen.queryByText('10m · Solo focus')).toBeNull(); expect(screen.getByText('25m · With Bob')).toBeVisible();
  const date = screen.getByRole('button', { name: /^2026-10-07:/ });
  fireEvent.keyDown(date, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: /^2026-10-08:/ })).toHaveFocus();
  expect(screen.getByRole('button', { name: /^2026-10-08:/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(hook).toHaveBeenLastCalledWith('alice', '2026-09');
});
