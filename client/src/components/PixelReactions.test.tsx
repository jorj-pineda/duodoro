import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PixelReaction, ReactionControls, REACTION_ART } from './PixelReactions';
import ScenePixel from './SceneScale';
import { keysUsed } from '@/lib/pixelMap';
afterEach(() => vi.useRealTimers());
describe('pixel reactions', () => {
  it('renders complete palettes on the shared scene grid at both pixel sizes', () => {
    for (const [reaction, art] of Object.entries(REACTION_ART)) {
      expect(new Set(art.map.map(row => row.length)).size).toBe(1);
      for (const key of keysUsed(art.map)) expect(art.palette).toHaveProperty(key);
      for (const px of [2, 3]) {
        const view = render(<ScenePixel value={px}><PixelReaction reaction={reaction as keyof typeof REACTION_ART} name="Alice" /></ScenePixel>);
        expect(view.container.querySelector('svg')).toHaveAttribute('width', String(art.map[0].length * px));
        expect(view.container.querySelector('svg')).toHaveAttribute('height', String(art.map.length * px));
        expect(screen.getByRole('img')).toHaveAccessibleName(`Alice sent a ${reaction} reaction`);
        view.unmount();
      }
    }
  });
  it('waits for acknowledgement, prevents bursts, and unlocks after cooldown', async () => {
    vi.useFakeTimers();
    let reply!: (value: string | null) => void;
    const onSend = vi.fn(() => new Promise<string | null>(resolve => { reply = resolve; }));
    render(<ReactionControls connected onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send heart' }));
    expect(screen.getByRole('button', { name: 'Send wave' })).toBeDisabled();
    expect(screen.queryByText('Heart sent')).toBeNull();
    await act(async () => reply(null));
    expect(screen.getByRole('status')).toHaveTextContent('Heart sent');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('button', { name: 'Send wave' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: 'Send wave' })).toBeEnabled();
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it('shows server failures and permits retry; disables disconnected sends', async () => {
    const onSend = vi.fn().mockResolvedValue('Wait a moment');
    const view = render(<ReactionControls connected onSend={onSend} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send cheer' })));
    expect(screen.getByRole('status')).toHaveTextContent('Wait a moment');
    expect(screen.getByRole('button', { name: 'Send cheer' })).toBeEnabled();
    view.rerender(<ReactionControls connected={false} onSend={onSend} />);
    expect(screen.getByRole('button', { name: 'Send cheer' })).toBeDisabled();
  });
});
