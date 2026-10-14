import { describe, it, expect, vi } from 'vitest';
import { startBreakExtension, registerBreakExtensionHandlers } from './breakExtensionHandlers';
import { beginFocusRound, buildSyncPayload } from './session';
import { MAX_BREAK } from './payloadParsers';

function setup() {
  const session = { id: 'room', phase: 'break', phaseStartTime: 1000, phaseTimer: 'original', breakDuration: 60,
    focusDuration: 1500, players: { a: { userId: 'alice' }, b: { userId: 'bob' } } };
  session.breakExtension = startBreakExtension(session);
  let clock = 5000;
  const emissions = [], handlers = {}, cancel = vi.fn(), schedule = vi.fn(() => 'extended'), advancePhase = vi.fn(), allow = vi.fn(() => true);
  function socket(id, userId) {
    const events = {};
    registerBreakExtensionHandlers({ socket: { id, userId }, io: { to: () => ({ emit: (event, payload) => emissions.push({ event, payload: structuredClone(payload) }) }) },
      onPayload: (_, event, handler) => { events[event] = handler; }, getSession: id => id === 'room' ? session : null,
      advancePhase, allow, now: () => clock, cancel, schedule, newId: () => '00000000-0000-4000-8000-000000000001' });
    handlers[id] = events;
  }
  socket('a', 'alice'); socket('b', 'bob'); socket('intruder', 'mallory');
  function call(id, responding = false, extra = {}) {
    const respond = vi.fn();
    handlers[id][responding ? 'respond_break_extension' : 'request_break_extension']({ sessionId: 'room', phaseStartTime: 1000,
      ...(responding ? { proposalId: session.breakExtension.proposalId, accept: true } : {}), ...extra }, respond);
    return respond.mock.calls[0]?.[0];
  }
  return { session, call, socket, emissions, cancel, schedule, advancePhase, allow, clock: value => { clock = value; } };
}

describe('mutual break extensions', () => {
  it('requires the other account to agree, schedules only this break, and ignores duplicate votes', () => {
    const s = setup();
    expect(s.call('a')).toEqual({ ok: true });
    expect(s.session.breakExtension.status).toBe('pending');
    expect(s.cancel).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled();
    expect(s.call('a', true).ok).toBe(false);
    expect(s.call('b', true)).toEqual({ ok: true });
    expect(s.session.breakExtension.extraSeconds).toBe(120);
    expect(s.session.breakDuration).toBe(60); expect(s.session.phaseStartTime).toBe(1000);
    expect(s.cancel).toHaveBeenCalledExactlyOnceWith('original');
    expect(s.schedule.mock.calls[0][1]).toBe(176000);
    s.schedule.mock.calls[0][0](); expect(s.advancePhase).toHaveBeenCalledWith('room');
    expect(s.call('b', true).ok).toBe(false); expect(s.schedule).toHaveBeenCalledTimes(1);
    expect(buildSyncPayload(s.session, 'a').breakExtension.extraSeconds).toBe(120);
    beginFocusRound(s.session, 200000);
    expect(s.session.breakExtension).toBeNull(); expect(s.session.breakDuration).toBe(60);
  });
  it('decline is final for this break, and nonresponse never postpones the deadline', () => {
    const s = setup(); s.call('a');
    expect(s.call('b', true, { accept: false })).toEqual({ ok: true });
    expect(s.session.breakExtension.status).toBe('declined');
    expect(s.call('b').ok).toBe(false); expect(s.call('b', true).ok).toBe(false);
    expect(s.cancel).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled();
    const pending = setup(); pending.call('a'); pending.clock(61000);
    expect(pending.call('b', true).ok).toBe(false); expect(pending.schedule).not.toHaveBeenCalled();
  });
  it('rejects outsiders, stale phases/proposals, malformed payloads and rate-limited requests', () => {
    const s = setup();
    for (const payload of [{ phaseStartTime: 0 }, { phaseStartTime: '1000' }, { sessionId: 'other' }]) expect(s.call('a', false, payload).ok).toBe(false);
    expect(s.call('intruder').ok).toBe(false);
    s.allow.mockReturnValue(false); expect(s.call('a').ok).toBe(false);
    s.allow.mockReturnValue(true); s.call('a');
    expect(s.call('b', true, { accept: 'yes' }).ok).toBe(false);
    expect(s.call('b', true, { proposalId: '00000000-0000-4000-8000-000000000002' }).ok).toBe(false);
    s.session.phase = 'returning'; expect(s.call('b', true).ok).toBe(false);
    expect(s.schedule).not.toHaveBeenCalled();
  });
  it('preserves consent across re-keying, but refuses disconnected or replacement partners', () => {
    const s = setup(); s.call('a');
    s.session.players.b.disconnected = true; expect(s.call('b', true).ok).toBe(false);
    delete s.session.players.b; s.session.players.new = { userId: 'bob' }; s.socket('new', 'bob');
    expect(s.call('new', true)).toEqual({ ok: true });
    const replaced = setup(); replaced.call('a'); replaced.session.players.b.userId = 'mallory'; replaced.socket('b', 'mallory');
    expect(replaced.call('b', true).ok).toBe(false);
    delete replaced.session.players.b; expect(replaced.call('a', true).ok).toBe(false);
  });
  it('offers only authenticated duo breaks that can fit the fixed extension', () => {
    const s = setup();
    s.session.breakDuration = MAX_BREAK; expect(startBreakExtension(s.session).eligibleUserIds).toEqual([]);
    s.session.breakDuration = 60; delete s.session.players.b; expect(startBreakExtension(s.session).eligibleUserIds).toEqual([]);
    s.session.players.b = { userId: 'alice' }; expect(startBreakExtension(s.session).eligibleUserIds).toEqual([]);
  });
});
