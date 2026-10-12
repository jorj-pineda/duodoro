import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const progress = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useRecapProgress', () => ({ useRecapProgress: progress }));
import SessionWrapUp from './SessionWrapUp';
const props = () => ({ userId: 'alice', phase: 'focus', completedRounds: 2, intentions: { current: {}, next: { alice: 'My next plan', bob: 'Partner plan' } }, recap: null, saveStatus: 'clear', draftOpen: false, onClose: vi.fn(), onLeave: vi.fn() });
beforeEach(() => { progress.mockReturnValue({ seconds: 600, error: false, retry: vi.fn() }); });
it('labels personal daily focus separately from room counts and leaves only by explicit click', () => {
  const p = props(); render(<SessionWrapUp {...p} />);
  expect(screen.getByText('10m')).toBeVisible(); expect(screen.getByText('2')).toBeVisible();
  expect(screen.getByText('My next plan')).toBeVisible(); expect(screen.queryByText('Partner plan')).toBeNull();
  expect(p.onLeave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{ name: 'Finish and leave room' })); expect(p.onLeave).toHaveBeenCalledOnce();
});
it('protects open drafts and marks unconfirmed focus without implying it was saved', () => {
  render(<SessionWrapUp {...props()} draftOpen saveStatus="unconfirmed" />);
  expect(screen.getByRole('button',{ name: 'Finish and leave room' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('only confirmed');
});
it('shows retry instead of false zero progress on failed reads', () => {
  const retry = vi.fn(); progress.mockReturnValue({ seconds: null, error: true, retry });
  render(<SessionWrapUp {...props()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
  fireEvent.click(screen.getByRole('button',{ name: 'Retry today’s focus' })); expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByText('0s')).toBeNull();
});
