import { act, waitFor } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) }) }));
import FocusInsights from './FocusInsights';
it('hydrates from a neutral loading frame without date or storage mismatches', async () => {
  const html = renderToString(<FocusInsights userId="ssr-insights" />);
  expect(html).toContain('Loading insights');
  expect(html).not.toContain('No completed focus rounds');
  const container = document.createElement('div'); container.innerHTML = html; document.body.append(container);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let root!: Root;
  try {
    await act(async () => { root = hydrateRoot(container, <FocusInsights userId="ssr-insights" />); });
    await waitFor(() => expect(container.textContent).toContain('No completed focus rounds'));
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/hydration|did not match|server rendered/i);
  } finally {
    await act(async () => root.unmount()); container.remove(); errors.mockRestore();
  }
});
