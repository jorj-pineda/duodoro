import { expect, it, vi } from 'vitest';
import { createAuthFetch } from './authFetch';
function abortable() {
  return vi.fn((_input, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
}
it('aborts the underlying Auth verification request at its deadline', async () => {
  const fetch = abortable();
  await expect(createAuthFetch({ fetchImpl: fetch, timeoutMs: 10 })('https://example.supabase.co/auth/v1/user')).rejects.toThrow('aborted');
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});
it('preserves caller cancellation, request method, and headers', async () => {
  const fetch = abortable(), controller = new AbortController();
  const options = { method: 'GET', headers: { 'test-header': 'test-value' }, signal: controller.signal };
  const result = createAuthFetch({ fetchImpl: fetch })('https://example.supabase.co/auth/v1/user', options);
  controller.abort(); await expect(result).rejects.toThrow('aborted');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: options.method, headers: options.headers });
});
it('leaves focus writes and all other Supabase requests unchanged', async () => {
  const fetch = vi.fn(async () => 'ok'), options = { method: 'POST', signal: new AbortController().signal };
  const url = 'https://example.supabase.co/rest/v1/rpc/record_focus_session';
  await expect(createAuthFetch({ fetchImpl: fetch })(url, options)).resolves.toBe('ok');
  expect(fetch).toHaveBeenCalledExactlyOnceWith(url, options);
});
