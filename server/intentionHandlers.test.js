import { describe, expect, it, vi } from 'vitest';
import { registerIntentionHandlers } from './intentionHandlers';
import { createSessionState, beginFocusRound, completeFocusRound, buildSyncPayload } from './session';
import { parseSetIntention, parseResolveIntention } from './payloadParsers';

function setup() {
  const session = createSessionState('forest', 'a');
  session.players = { a: { userId: 'alice', displayName: 'Alice' }, b: { userId: 'bob', displayName: 'Bob' } };
  const socket = { id: 'a', userId: 'alice' };
  const handlers = {};
  const emit = vi.fn();
  const allow = vi.fn(() => true);
  registerIntentionHandlers({ socket, io: { to: () => ({ emit }) }, onPayload: (_socket, event, handler) => { handlers[event] = handler; },
    getSession: (id) => id === session.id ? session : null, allow });
  function request(event, extra) {
    const respond = vi.fn();
    handlers[event]({ sessionId: session.id, ...extra }, respond);
    return respond.mock.calls[0]?.[0];
  }
  return { session, socket, emit, allow, request };
}

describe('room intentions', () => {
  it('normalizes bounded optional text, ignores payload identity, and rejects malformed input', () => {
    expect(parseSetIntention({ sessionId: 'room', text: '  Write\nchapter  ' }).value.text).toBe('Write chapter');
    expect(parseSetIntention({ sessionId: 'room', text: 'x'.repeat(161) }).ok).toBe(false);
    expect(parseSetIntention({ sessionId: 'room', text: 42 }).ok).toBe(false);
    expect(parseResolveIntention({ sessionId: 'room', round: 1.5, action: 'done' }).ok).toBe(false);
    const { session, request } = setup();
    expect(request('set_intention', { text: 'Draft', userId: 'bob' })).toEqual({ ok: true });
    expect(session.intentions.next).toEqual({ alice: 'Draft' });
    request('set_intention', { text: ' ' });
    expect(session.intentions.next).toEqual({});
  });
  it('refuses outsiders, forged membership, focus edits, and rate-limited mutations', () => {
    const { session, socket, request, allow, emit } = setup();
    socket.id = 'outsider';
    expect(request('set_intention', { text: 'Forged' }).ok).toBe(false);
    socket.id = 'b';
    expect(request('set_intention', { text: 'Forged' }).ok).toBe(false);
    socket.id = 'a';
    session.phase = 'focus';
    expect(request('set_intention', { text: 'Too late' }).ok).toBe(false);
    session.phase = 'waiting';
    allow.mockReturnValue(false);
    expect(request('set_intention', { text: 'Too fast' }).ok).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
  it('freezes round text, preserves it across reconnects, and carries only by an explicit owner action', () => {
    const { session, request, socket } = setup();
    request('set_intention', { text: 'Write chapter' });
    session.intentions.next.bob = 'Read notes';
    beginFocusRound(session, 1000, 'one');
    expect(session.intentions.next).toEqual({});
    expect(session.intentions.current.alice).toMatchObject({ text: 'Write chapter', completed: false });
    completeFocusRound(session, 1501000);
    session.phase = 'break';
    expect(request('resolve_intention', { round: 1, action: 'done', userId: 'bob' })).toEqual({ ok: true });
    expect(session.roundRecap.intentions.bob.completed).toBe(false);
    expect(session.roundRecap.intentions.alice.completed).toBe(true);
    expect(session.intentions.next).toEqual({});
    session.players.reconnected = session.players.a;
    delete session.players.a;
    socket.id = 'reconnected';
    expect(buildSyncPayload(session, socket.id).roundRecap.intentions.alice.completed).toBe(true);
    request('resolve_intention', { round: 1, action: 'undo' });
    expect(session.roundRecap.intentions.alice.completed).toBe(false);
    request('resolve_intention', { round: 1, action: 'carry' });
    expect(session.intentions.next.alice).toBe('Write chapter');
    beginFocusRound(session, 1600000, 'two');
    expect(session.intentions.current).toEqual({ alice: { text: 'Write chapter', displayName: 'Alice', completed: false } });
    expect(request('resolve_intention', { round: 1, action: 'done' }).ok).toBe(false);
  });
  it('does not overwrite a newer draft with a stale carry or change a prior round', () => {
    const { session, request } = setup();
    request('set_intention', { text: 'Original' });
    beginFocusRound(session);
    completeFocusRound(session);
    session.phase = 'ready';
    request('set_intention', { text: 'Next plan' });
    expect(session.roundRecap.intentions.alice.text).toBe('Original');
    expect(request('resolve_intention', { round: 1, action: 'carry' }).ok).toBe(false);
    expect(request('resolve_intention', { round: 2, action: 'done' }).ok).toBe(false);
    expect(session.intentions.next.alice).toBe('Next plan');
  });
});
