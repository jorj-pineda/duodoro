import { describe, expect, it, vi } from 'vitest';
import { createFocusRecovery } from './focusRecovery.js';

const payload = {
  p_recording_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  p_room_code: 'room-1',
  p_world: 'forest',
  p_focus_duration: 60,
  p_break_duration: 30,
  p_actual_focus: 60,
  p_completed: true,
  p_started_at: '2026-09-25T18:00:00.000Z',
  p_user_ids: ['user-1', 'user-2'],
};

function fakeQueue() {
  const values = new Map();
  return {
    put: vi.fn(async (row) => { values.set(row.p_recording_key, row); }),
    remove: vi.fn(async (key) => Number(values.delete(key))),
    async *entries() { for (const row of values.values()) yield row; },
    hasForUser: vi.fn(async (id) => [...values.values()].some(
      (row) => row.p_user_ids.includes(id),
    )),
    removeForUser: vi.fn(async (id) => {
      let removed = 0;
      for (const [key, row] of values) {
        if (row.p_user_ids.includes(id)) {
          values.delete(key);
          removed++;
        }
      }
      return removed;
    }),
  };
}

function recovery(supabase, queue, onStatus = vi.fn()) {
  return createFocusRecovery({
    supabase,
    queue,
    onStatus,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    metrics: { increment: vi.fn() },
  });
}

describe('failed focus recovery', () => {
  it('keeps queued rounds when local mode has no database client', async () => {
    const queue = fakeQueue();
    await queue.put(payload);
    await recovery(null, queue).replay();
    expect(await queue.hasForUser('user-1')).toBe(true);
  });

  it('keeps a failed write and replays the identical round after a server restart', async () => {
    const queue = fakeQueue();
    const unavailable = { rpc: vi.fn(async () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })) };
    const firstStatus = vi.fn();
    const first = recovery(unavailable, queue, firstStatus);

    expect(await first.save(payload)).toEqual({ state: 'pending' });
    expect(queue.put).toHaveBeenCalledWith(payload);
    expect(await first.statusForUser('user-1')).toBe('pending');
    expect(firstStatus).toHaveBeenCalledWith('user-2', 'pending');

    const working = { rpc: vi.fn(async () => ({
      data: { session_id: 'saved-row', inserted: true }, error: null,
    })) };
    const recoveredStatus = vi.fn();
    const replacement = recovery(working, queue, recoveredStatus);
    await replacement.replay();

    expect(working.rpc).toHaveBeenCalledWith('record_focus_session', payload);
    expect(await replacement.statusForUser('user-1')).toBe('clear');
    expect(recoveredStatus).toHaveBeenCalledWith('user-1', 'clear');
    expect(recoveredStatus).toHaveBeenCalledWith('user-2', 'clear');
    expect(queue.remove).toHaveBeenCalledWith(payload.p_recording_key);
  });

  it('reports an unconfirmed save when both the queue and database fail', async () => {
    const queue = fakeQueue();
    queue.put.mockRejectedValue(new Error('queue unavailable'));
    const database = { rpc: vi.fn(async () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })) };
    const status = vi.fn();

    const coordinator = recovery(database, queue, status);
    await expect(coordinator.save(payload))
      .rejects.toThrow('permission denied');
    expect(status).toHaveBeenCalledWith('user-1', 'unconfirmed');
    expect(await coordinator.statusForUser('user-1')).toBe('unconfirmed');
    expect(queue.put).toHaveBeenCalledTimes(2);
  });

  it('discards a queued shared round for account deletion and notifies the partner', async () => {
    const queue = fakeQueue();
    await queue.put(payload);
    const status = vi.fn();
    const coordinator = recovery(null, queue, status);

    const prepared = await coordinator.prepareAccountDeletion('user-1');
    expect(await queue.hasForUser('user-1')).toBe(false);
    expect(await coordinator.save(payload)).toEqual({ state: 'discarded' });
    prepared.commit();
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith('user-2', 'unconfirmed'));
    expect(await coordinator.statusForUser('user-2')).toBe('unconfirmed');
  });

  it('keeps a queued round discarded after an uncertain deletion failure', async () => {
    const queue = fakeQueue();
    await queue.put(payload);
    const coordinator = recovery(null, queue);

    const prepared = await coordinator.prepareAccountDeletion('user-1');
    expect(await queue.hasForUser('user-2')).toBe(false);
    prepared.abort();
    expect(await queue.hasForUser('user-2')).toBe(false);
    expect(await coordinator.save(payload)).toEqual({ state: 'discarded' });
    const retry = await coordinator.prepareAccountDeletion('user-1');
    retry.commit();
  });

  it('does not make deletion wait for an unrelated stalled replay', async () => {
    const queue = fakeQueue();
    const unrelated = { ...payload, p_recording_key: 'other-round', p_user_ids: ['other'] };
    await queue.put(unrelated);
    await queue.put(payload);
    let finishReplay;
    const database = { rpc: vi.fn(() => new Promise((resolve) => { finishReplay = resolve; })) };
    const coordinator = recovery(database, queue);
    const replay = coordinator.replay();
    await vi.waitFor(() => expect(database.rpc).toHaveBeenCalledOnce());

    const prepared = await Promise.race([
      coordinator.prepareAccountDeletion('user-1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Deletion stalled')), 500)),
    ]);
    expect(await queue.hasForUser('user-1')).toBe(false);
    prepared.commit();
    finishReplay({ data: { session_id: 'saved-row', inserted: true }, error: null });
    await replay;
  });
});
