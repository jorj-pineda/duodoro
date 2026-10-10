import { describe, it, expect, vi } from 'vitest';
import { registerReactionHandlers } from './reactionHandlers';
import { createSessionState, buildSyncPayload } from './session';
import { parseReaction } from './payloadParsers';
function setup() {
  const session = createSessionState('forest', 'a');
  session.players = { a: { userId: 'alice' }, b: { userId: 'bob' } };
  const socket = { id: 'a', userId: 'alice' }, emit = vi.fn(), to = vi.fn(() => ({ emit })), allow = vi.fn(() => true);
  let handler;
  registerReactionHandlers({ socket, io: { to }, onPayload: (_s, _e, fn) => { handler = fn; }, getSession: id => id === session.id ? session : null, allow });
  function send(extra = {}) { const ack = vi.fn(); handler({ sessionId: session.id, reaction: 'heart', ...extra }, ack); return ack.mock.calls[0][0]; }
  return { session, socket, emit, to, allow, send };
}
describe('live room reactions', () => {
  it('accepts only the three fixed sprites', () => {
    for (const reaction of ['heart', 'cheer', 'wave']) expect(parseReaction({ sessionId: 'r', reaction }).ok).toBe(true);
    for (const reaction of ['text', null, {}, '<script>']) expect(parseReaction({ sessionId: 'r', reaction }).ok).toBe(false);
    expect(parseReaction({ sessionId: 3, reaction: 'heart' }).ok).toBe(false);
  });
  it('broadcasts only to the joined room using trusted identity and never snapshots reactions', () => {
    const { send, session, emit, to } = setup();
    expect(send({ playerId: 'b', userId: 'bob' })).toEqual({ ok: true });
    expect(to).toHaveBeenCalledWith(session.id);
    expect(emit).toHaveBeenCalledWith('room_reaction', { id: expect.any(String), sessionId: session.id, playerId: 'a', reaction: 'heart' });
    const first = emit.mock.calls[0][1].id;
    send({ reaction: 'wave' });
    expect(emit.mock.calls[1][1].id).not.toBe(first);
    expect(buildSyncPayload(session, 'a')).not.toHaveProperty('reactions');
  });
  it('refuses missing rooms, outsiders, forged membership, and bursts without broadcasting', () => {
    const { send, socket, allow, emit } = setup();
    expect(send({ sessionId: 'other' }).ok).toBe(false);
    socket.id = 'outsider'; expect(send().ok).toBe(false);
    socket.id = 'b'; expect(send().ok).toBe(false);
    socket.id = 'a'; socket.userId = null; expect(send().ok).toBe(false);
    socket.userId = 'alice'; allow.mockReturnValue(false); expect(send().ok).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});

it('targets only the sender companion, rejects missing pets and unsupported interactions', () => {
  const { send, session, emit } = setup();
  expect(send({ target: 'companion' }).ok).toBe(false);
  session.players.a.pet = 'cat';
  expect(send({ target: 'companion', playerId: 'b', pet: 'dragon' })).toEqual({ ok: true });
  expect(emit).toHaveBeenCalledWith('room_reaction', expect.objectContaining({ playerId: 'a', target: 'companion', pet: 'cat', reaction: 'heart' }));
  expect(send({ target: 'companion', reaction: 'cheer' }).ok).toBe(false);
  expect(send({ target: 'everyone' }).ok).toBe(false);
});
