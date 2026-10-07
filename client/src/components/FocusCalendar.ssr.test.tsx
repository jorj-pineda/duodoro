import { act, waitFor } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) }) }));
import FocusCalendar from './FocusCalendar';
it('renders a neutral server month and hydrates into the local calendar without mismatch', async () => {
  const html = renderToString(<FocusCalendar userId="ssr" />);
  expect(html).toContain('Loading calendar'); expect(html).not.toContain('Previous month');
  const container = document.createElement('div'); container.innerHTML = html; document.body.append(container);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let root!: Root;
  try {
    await act(async () => { root = hydrateRoot(container, <FocusCalendar userId="ssr" />); });
    await waitFor(() => expect(container.textContent).toContain('completed rounds this month'));
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/hydration|did not match|server rendered/i);
  } finally {
    await act(async () => root.unmount()); container.remove(); errors.mockRestore();
  }
});
