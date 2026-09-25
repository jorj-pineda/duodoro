import { describe, expect, it, vi } from 'vitest';
import { createReadinessChecker } from './readiness.js';

function fakeSupabase(result) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc }, rpc };
}

describe('database readiness', () => {
  it('reports a usable development server when persistence is disabled', async () => {
    const check = createReadinessChecker(null);
    await expect(check()).resolves.toEqual({
      ok: true,
      mode: 'development',
      dependencies: { database: 'disabled' },
    });
  });

  it('checks service-role access without reading any user history', async () => {
    const { client, rpc } = fakeSupabase({ data: 0, error: null });
    const observe = vi.fn();
    const times = [100, 100, 118, 118];
    const check = createReadinessChecker(client, {
      observe,
      now: () => times.shift() ?? 118,
    });

    await expect(check()).resolves.toEqual({
      ok: true,
      dependencies: { database: 'ready' },
    });
    expect(rpc).toHaveBeenCalledWith('total_focus_seconds', {
      target: '00000000-0000-0000-0000-000000000000',
    });
    expect(observe).toHaveBeenCalledWith({ outcome: 'success', durationMs: 18 });
  });

  it('fails closed without exposing the database error', async () => {
    const { client } = fakeSupabase({
      data: null,
      error: { code: '42501', message: 'permission denied for function' },
    });
    const observe = vi.fn();
    const check = createReadinessChecker(client, { observe });

    await expect(check()).resolves.toEqual({
      ok: false,
      dependencies: { database: 'unavailable' },
    });
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failure',
        error: expect.objectContaining({ code: '42501' }),
      }),
    );
  });

  it('rejects an unusable response from the privileged probe', async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    const check = createReadinessChecker(client);

    await expect(check()).resolves.toEqual({
      ok: false,
      dependencies: { database: 'unavailable' },
    });
  });

  it('caches probes and deduplicates concurrent requests', async () => {
    let resolveProbe;
    const request = new Promise((resolve) => {
      resolveProbe = resolve;
    });
    const rpc = vi.fn(() => request);
    const client = { rpc };
    let now = 100;
    const check = createReadinessChecker(client, { now: () => now });

    const first = check();
    const concurrent = check();
    resolveProbe({ data: 0, error: null });
    await Promise.all([first, concurrent]);
    await check();
    expect(rpc).toHaveBeenCalledTimes(1);

    now = 6000;
    await check();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
