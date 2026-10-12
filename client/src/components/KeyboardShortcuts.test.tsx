import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import KeyboardShortcuts from './KeyboardShortcuts';
it('is opt-in and offers accessible help, a close action, and storage failure feedback', async () => {
  const close = vi.fn(), save = vi.fn(() => false);
  render(<KeyboardShortcuts open onClose={close} enabled={false} onEnabledChange={save} />);
  expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  const checkbox = screen.getByRole('checkbox', { name: 'Enable keyboard shortcuts' });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox); expect(save).toHaveBeenCalledWith(true);
  expect(screen.getByRole('status')).toHaveTextContent('Browser storage is unavailable');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close keyboard shortcuts' })).toHaveFocus());
  fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1);
});
