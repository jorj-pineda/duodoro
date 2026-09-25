import { describe, expect, it, vi } from 'vitest';
import { createFocusQueue } from './focusQueue.js';

const payload = {
  p_recording_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  p_room_code: 'room-1',
  p_user_ids: ['user-1', 'user-2'],
};

function fakeClient() {
  const hash = new Map();
  return {
    hSetNX: vi.fn(async (_name, key, value) => {
      if (hash.has(key)) return false;
      hash.set(key, value);
      return true;
    }),
    hGet: vi.fn(async (_name, key) => hash.get(key) ?? null),
    hDel: vi.fn(async (_name, key) => Number(hash.delete(key))),
    hLen: vi.fn(async () => hash.size),
    async *hScanIterator() {
      for (const [field, value] of hash) yield { field, value };
    },
    destroy: vi.fn(),
  };
}

describe('focus queue', () => {
  it('keeps a round immutable and finds both participants after a fresh adapter opens', async () => {
    const client = fakeClient();
    const first = createFocusQueue(client);
    await first.put(payload);
    await first.put(payload);

    const reopened = createFocusQueue(client);
    expect(await reopened.hasForUser('user-1')).toBe(true);
    expect(await reopened.hasForUser('user-2')).toBe(true);
    expect(await reopened.hasForUser('other')).toBe(false);
    await expect(reopened.put({ ...payload, p_actual_focus: 99 }))
      .rejects.toThrow('Conflicting queued focus record');
    expect(await reopened.count()).toBe(1);

    await reopened.remove(payload.p_recording_key);
    expect(await first.count()).toBe(0);
  });

  it('discards records that contain a deleted account without touching other records', async () => {
    const queue = createFocusQueue(fakeClient());
    await queue.put(payload);
    await queue.put({
      ...payload,
      p_recording_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      p_user_ids: ['other'],
    });

    expect(await queue.removeForUser('user-2')).toBe(1);
    expect(await queue.hasForUser('user-1')).toBe(false);
    expect(await queue.hasForUser('other')).toBe(true);
  });
});
