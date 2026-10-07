import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const hook = vi.fn();
vi.mock('@/hooks/useSharedMilestones', () => ({ useSharedMilestones: (...args: unknown[]) => hook(...args) }));
import SharedMilestones from './SharedMilestones';
beforeEach(() => hook.mockReset());
it('separates loading, errors/retry and a successfully empty history', () => {
  const retry = vi.fn(); hook.mockReturnValue({ rows: [], loaded: false, error: null, retry });
  const view = render(<SharedMilestones userId="alice" connected />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading'); expect(screen.queryByText(/Complete a duo/)).toBeNull();
  hook.mockReturnValue({ rows: [], loaded: false, error: 'Unavailable', retry }); view.rerender(<SharedMilestones userId="alice" connected />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry milestones' })); expect(retry).toHaveBeenCalledOnce();
  hook.mockReturnValue({ rows: [], loaded: true, error: null, retry }); view.rerender(<SharedMilestones userId="alice" connected />);
  expect(screen.getByText('Complete a duo round to start milestones together.')).toBeVisible();
});
it('shows achieved badges and exact next progress from saved duo totals', () => {
  hook.mockReturnValue({ rows: [{ partnerId: 'bob', partnerName: 'Bob', seconds: 3600, rounds: 10 }], loaded: true, error: null });
  render(<SharedMilestones userId="alice" connected />);
  expect(screen.getByText('10 rounds together')).toBeVisible(); expect(screen.getByText('First shared hour')).toBeVisible();
  expect(screen.getByRole('progressbar', { name: '25 rounds together with Bob' })).toHaveAttribute('aria-valuenow', '40');
  expect(screen.getByRole('progressbar', { name: '10 hours together with Bob' })).toHaveAttribute('aria-valuenow', '10');
  expect(screen.queryByText(/grew|new milestone/i)).toBeNull();
});
