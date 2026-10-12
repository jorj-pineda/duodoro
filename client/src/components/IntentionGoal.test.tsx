import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const save = vi.hoisted(() => vi.fn());
vi.mock('@/lib/intentionGoal', () => ({ saveIntentionGoal: save }));
import IntentionGoal from './IntentionGoal';
import { IntentionRecap } from './SessionIntentions';
const props = { userId: 'alice', roomId: 'room', round: 1, text: 'Finish notes' };
beforeEach(() => { save.mockReset(); });
it('requires a click and blocks repeated clicks until the write is confirmed', async () => {
  let finish!: (value: null) => void;
  save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<IntentionGoal {...props} />);
  expect(save).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Save as personal goal' });
  fireEvent.click(button); fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith('alice','room',1,'Finish notes');
  expect(button).toBeDisabled();
  await act(async () => finish(null));
  expect(screen.getByRole('button', { name: 'Saved as personal goal' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('still unfinished');
});
it('allows a safe retry after an unconfirmed save and never marks it saved early', async () => {
  save.mockResolvedValueOnce('Unconfirmed. Retry safely.').mockResolvedValueOnce(null);
  render(<IntentionGoal {...props} />);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('alert');
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saved'));
  expect(save).toHaveBeenCalledTimes(2);
});
it('offers only the owner’s unfinished intention and leaves existing next-round plans intact', () => {
  const recap = { round: 1, focusSeconds: 60, mode: 'flow' as const, saveState: 'pending' as const,
    intentions: { alice: { text: 'My notes', displayName: 'Alice', completed: false }, bob: { text: 'Partner notes', displayName: 'Bob', completed: false } } };
  const { rerender } = render(<IntentionRecap recap={recap} userId="alice" roomId="room" next="Different next plan" onResolve={vi.fn()} />);
  expect(screen.getAllByRole('button', { name: 'Save as personal goal' })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Next round already planned' })).toBeDisabled();
  rerender(<IntentionRecap recap={{ ...recap, intentions: { ...recap.intentions, alice: { ...recap.intentions.alice, completed: true } } }} userId="alice" roomId="room" next="" onResolve={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Save as personal goal' })).toBeNull();
});
it('releases the button after a thrown transport error', async () => {
  save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
  render(<IntentionGoal {...props} />);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('alert');
  expect(screen.getByRole('button')).toBeEnabled();
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('status');
});
it('starts fresh for a new round and never displays an old round’s delayed confirmation', async () => {
  let finish!: (value: null) => void;
  save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const recap = { round: 1, focusSeconds: 60, mode: 'flow' as const, saveState: 'saved' as const,
    intentions: { alice: { text: 'First round', displayName: 'Alice', completed: false } } };
  const { rerender } = render(<IntentionRecap recap={recap} userId="alice" roomId="room" next="" onResolve={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save as personal goal' }));
  rerender(<IntentionRecap recap={{ ...recap, round: 2 }} userId="alice" roomId="room" next="" onResolve={vi.fn()} />);
  await act(async () => finish(null));
  expect(screen.getByRole('button', { name: 'Save as personal goal' })).toBeEnabled();
  expect(screen.queryByRole('status')).toBeNull();
});
