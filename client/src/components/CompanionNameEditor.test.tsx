import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CompanionNameEditor from './CompanionNameEditor';
describe('companion name editor', () => {
  it('retains failed drafts, supports cancel and explicit default restoration', async () => {
    const save = vi.fn().mockResolvedValueOnce('Reconnect first').mockResolvedValue(null);
    render(<CompanionNameEditor pet="cat" name="Mochi" connected onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename companion' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Companion name' }), { target: { value: 'Moon Bean' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save name' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Reconnect first');
    expect(screen.getByRole('textbox')).toHaveValue('Moon Bean');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Mochi')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Rename companion' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use default name' })));
    expect(save).toHaveBeenLastCalledWith('');
  });
  it('validates long names locally and disables disconnected changes', async () => {
    const save = vi.fn();
    const view = render(<CompanionNameEditor pet="dog" name="Buddy" connected onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename companion' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x'.repeat(25) } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save name' })));
    expect(screen.getByRole('alert')).toHaveTextContent('24 characters'); expect(save).not.toHaveBeenCalled();
    view.rerender(<CompanionNameEditor pet="dog" name="Buddy" connected={false} onSave={save} />);
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
  });
});
