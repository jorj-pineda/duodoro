import { describe, it, expect, vi } from 'vitest';
import { registerCompanionNameHandlers } from './companionNameHandlers';
import { normalizeCompanionName, companionName } from '../shared/companionNames';
import { createSessionState, addPlayer, buildSyncPayload, creditFocus } from './session';
function setup() {
  const session = createSessionState('forest', 'a');
  session.players = { a: { userId: 'alice', pet: 'cat', petName: 'Mochi' }, b: { userId: 'bob', pet: 'dog', petName: 'Buddy' } };
  const socket = { id: 'a', userId: 'alice' }, emit = vi.fn(), allow = vi.fn(() => true);
  let handler;
  registerCompanionNameHandlers({ socket, io: { to: id => { expect(id).toBe(session.id); return { emit }; } }, onPayload: (_s, _e, fn) => { handler = fn; }, getSession: id => id === session.id ? session : null, allow });
  const send = (extra = {}) => { const ack = vi.fn(); handler({ sessionId: session.id, name: '  Luna  ', ...extra }, ack); return ack.mock.calls[0][0]; };
  return { session, socket, emit, allow, send };
}
describe('companion names', () => {
  it('uses gender-neutral defaults, bounds Unicode names, and strips invisible control characters', () => {
    expect(companionName('cat')).toBe('Mochi'); expect(companionName('dog')).toBe('Buddy');
    expect(companionName('dragon')).toBe('Ember'); expect(companionName('rabbit')).toBe('Clover');
    expect(companionName(null, 'Name')).toBeNull();
    expect(normalizeCompanionName('  Moon\n  Bean\u202e  ')).toBe('Moon Bean');
    expect(normalizeCompanionName('🐈'.repeat(24))).toBe('🐈'.repeat(24));
    for (const value of [null, {}, 'x'.repeat(25), '🐈'.repeat(25)]) expect(normalizeCompanionName(value)).toBeNull();
  });
  it('renames only the verified sender, broadcasts the confirmed name, and restores defaults', () => {
    const { send, session, emit } = setup();
    expect(send({ playerId: 'b', userId: 'bob' })).toEqual({ ok: true, name: 'Luna' });
    expect(session.players.b.petName).toBe('Buddy');
    expect(emit).toHaveBeenCalledWith('companion_name_changed', { sessionId: session.id, playerId: 'a', petName: 'Luna' });
    expect(send({ name: ' ' })).toEqual({ ok: true, name: 'Mochi' });
    expect(buildSyncPayload(session, 'a').players.a.petName).toBe('Mochi');
  });
  it('rejects missing rooms, forged membership, no companion, long names and bursts', () => {
    const { send, socket, session, allow, emit } = setup();
    expect(send({ sessionId: 'elsewhere' }).ok).toBe(false);
    socket.id = 'b'; expect(send().ok).toBe(false); socket.id = 'a';
    socket.userId = null; expect(send().ok).toBe(false); socket.userId = 'alice';
    expect(send({ name: 'x'.repeat(25) }).ok).toBe(false);
    session.players.a.pet = null; expect(send().ok).toBe(false); session.players.a.pet = 'cat';
    allow.mockReturnValue(false); expect(send().ok).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
  it('keeps names in public room snapshots beside server-derived growth', () => {
    const session = createSessionState('forest', 'a');
    addPlayer(session, 'a', { userId: 'alice', avatar: {}, pet: 'dragon', petName: 'Nova', focusSeconds: 0 });
    expect(buildSyncPayload(session, 'a').players.a.petName).toBe('Nova');
    creditFocus(session, ["alice"], 10800);
    expect(session.players.a.petStage).toBe("grown");
    // Growth changes only the stage, preserving the chosen name.
    expect(session.players.a.petName).toBe('Nova');
  });
});
