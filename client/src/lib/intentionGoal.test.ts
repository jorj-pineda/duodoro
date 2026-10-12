import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), read: vi.fn(), eq: vi.fn(), is: vi.fn() }));
vi.mock('./supabase', () => ({ getSupabase: () => ({ from: () => ({
  upsert: (...args: unknown[]) => { mocks.upsert(...args); return { select: () => ({ maybeSingle: () => mocks.read('insert') }) }; },
  select: () => ({ eq: (...args: unknown[]) => { mocks.eq(...args); return { eq: (...ownerArgs: unknown[]) => {
    mocks.eq(...ownerArgs); return { is: (...roomArgs: unknown[]) => { mocks.is(...roomArgs); return { maybeSingle: () => mocks.read('existing') }; } };
  } }; } }),
}) }) }));
import { intentionGoalId, saveIntentionGoal } from './intentionGoal';
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks(); });
it('uses a stable UUID across retries and isolates account, room and round identities', async () => {
  const id = await intentionGoalId('alice', 'room', 1);
  expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  expect(await intentionGoalId('alice', 'room', 1)).toBe(id);
  expect(await intentionGoalId('bob', 'room', 1)).not.toBe(id);
  expect(await intentionGoalId('alice', 'other', 1)).not.toBe(id);
  expect(await intentionGoalId('alice', 'room', 2)).not.toBe(id);
});
it('saves a private unfinished goal and confirms its owner and ID', async () => {
  const id = await intentionGoalId('alice','room',1);
  mocks.read.mockResolvedValue({ data: { id, owner_id: 'alice', room_code: null, is_shared: false }, error: null });
  expect(await saveIntentionGoal('alice','room',1,'  Finish notes  ')).toBeNull();
  expect(mocks.upsert).toHaveBeenCalledWith({ id, owner_id: 'alice', room_code: null, content: 'Finish notes', is_done: false, is_shared: false }, { onConflict: 'id', ignoreDuplicates: true });
});
it('confirms an already-created goal after a duplicate insert without updating its content or completion', async () => {
  const id = await intentionGoalId('alice','room',1);
  mocks.read.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { id, owner_id: 'alice', room_code: null, is_shared: false }, error: null });
  expect(await saveIntentionGoal('alice','room',1,'Original intention')).toBeNull();
  expect(mocks.eq).toHaveBeenCalledWith('owner_id','alice');
  expect(mocks.is).toHaveBeenCalledWith('room_code',null);
  expect(mocks.read).toHaveBeenCalledWith('existing');
});
it('never calls an error, empty read, shared goal or mismatched owner confirmed', async () => {
  const id = await intentionGoalId('alice','room',1);
  for (const result of [
    { data: null, error: {} }, { data: null, error: null },
    { data: { id, owner_id: 'bob', room_code: null, is_shared: false }, error: null },
    { data: { id, owner_id: 'alice', room_code: 'room' }, error: null },
    { data: { id: 'other', owner_id: 'alice', room_code: null, is_shared: false }, error: null },
  ]) {
    mocks.read.mockResolvedValue(result);
    expect(await saveIntentionGoal('alice','room',1,'Finish notes')).toMatch(/Couldn't confirm/);
  }
  mocks.read.mockRejectedValue(new Error('lost response'));
  expect(await saveIntentionGoal('alice','room',1,'Finish notes')).toMatch(/Retry safely/);
});
it('rejects malformed round or empty/oversized content before a write', async () => {
  expect(await saveIntentionGoal('alice','room',0,'Notes')).toMatch(/can't be saved/);
  expect(await saveIntentionGoal('alice','room',1,' ')).toMatch(/can't be saved/);
  expect(await saveIntentionGoal('alice','room',1,'x'.repeat(161))).toMatch(/can't be saved/);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
