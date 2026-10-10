import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CompanionInteraction from './CompanionInteraction';
afterEach(() => vi.useRealTimers());
it('exposes a touch target without changing the sprite dimensions and waits for confirmed interaction', async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockResolvedValue(null);
  const view = render(<CompanionInteraction name="Mochi" label="Your cat" connected onPet={send}><svg width="21" height="15" /></CompanionInteraction>);
  expect(view.container.querySelector('svg')).toHaveAttribute('height', '15');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pet Mochi' })));
  expect(screen.getByRole('button')).toBeDisabled();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('button')).toBeEnabled();
  expect(send).toHaveBeenCalledTimes(1);
});
it('shows errors and permits retry, while partner art remains read-only', async () => {
  const send = vi.fn().mockResolvedValue('Wait a moment');
  const view = render(<CompanionInteraction name="Mochi" label="Your cat" connected onPet={send}><svg /></CompanionInteraction>);
  await act(async () => fireEvent.click(screen.getByRole('button')));
  expect(screen.getByRole('alert')).toHaveTextContent('Wait a moment');
  expect(screen.getByRole('button')).toBeEnabled();
  view.rerender(<CompanionInteraction name="Buddy" label="Partner dog"><svg /></CompanionInteraction>);
  expect(screen.queryByRole('button')).toBeNull();
});
