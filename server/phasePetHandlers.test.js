import { describe, expect, it, vi } from 'vitest';
import { registerPhasePetHandlers } from './phasePetHandlers.js';
import { FULL_AT_SECONDS } from './petLevel.js';
import { MAX_BREAK, MAX_FOCUS } from './payloadParsers.js';

function setup(session, overrides = {}) {
  const handlers = new Map();
  const emissions = [];
  const socket = { id: 'player-socket' };
  const schedule = vi.fn().mockReturnValue('new-timer');
  const cancel = vi.fn();
  const advancePhase = vi.fn();
  const queueSessionRecording = vi.fn();
  const metrics = { increment: vi.fn() };
  const logger = { info: vi.fn() };

  const dependencies = {
    socket,
    io: {
      to: (roomId) => ({
        emit: (event, payload) => emissions.push({ roomId, event, payload }),
      }),
    },
    onPayload: (target, event, handler) => handlers.set(event, handler),
    getSession: vi.fn((sessionId) => sessionId === 'room' ? session : null),
    advancePhase,
    queueSessionRecording,
    metrics,
    logger,
    schedule,
    cancel,
    now: () => 500_000,
    ...overrides,
  };
  registerPhasePetHandlers(dependencies);
  return {
    ...dependencies,
    handlers,
    emissions,
  };
}

function waitingSession() {
  return {
    mode: 'pomodoro',
    phase: 'waiting',
    focusDuration: 25 * 60,
    breakDuration: 5 * 60,
    phaseStartTime: null,
    phaseTimer: null,
    focusRoundId: null,
    players: {
      'player-socket': { focusSeconds: 0, pet: null, petStage: null },
    },
  };
}

describe('phase handlers', () => {
  it('restores interrupted intentions for another attempt without completing them', () => {
    const session = waitingSession();
    session.phase = 'focus';
    session.intentions = { current: { alice: { text: 'Write chapter', displayName: 'Alice', completed: false } }, next: {} };
    const { handlers, queueSessionRecording } = setup(session);
    handlers.get('stop_session')({ sessionId: 'room' });
    expect(queueSessionRecording).toHaveBeenCalled();
    expect(session.intentions).toEqual({ current: {}, next: { alice: 'Write chapter' } });
    expect(session.roundRecap).toBeNull();
  });
  it('starts a bounded pomodoro and schedules its authoritative transition', () => {
    const session = waitingSession();
    session.phaseTimer = 'old-timer';
    const { handlers, schedule, cancel, advancePhase, emissions, metrics } = setup(
      session,
      {
        beginRound: (target) => {
          target.phase = 'focus';
          target.phaseStartTime = 123_000;
          target.focusRoundId = 'round-key';
        },
      },
    );

    handlers.get('start_session')({
      sessionId: 'room',
      focusDuration: 5,
      breakDuration: 5,
      mode: 'pomodoro',
    });

    expect(cancel).toHaveBeenCalledWith('old-timer');
    expect(session).toMatchObject({
      phase: 'focus',
      focusDuration: 60,
      breakDuration: 30,
      phaseStartTime: 123_000,
      phaseTimer: 'new-timer',
      focusRoundId: 'round-key',
    });
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 60_000);
    schedule.mock.calls[0][0]();
    expect(advancePhase).toHaveBeenCalledWith('room');
    expect(emissions[0]).toMatchObject({
      roomId: 'room',
      event: 'phase_change',
      payload: { phase: 'focus', mode: 'pomodoro' },
    });
    expect(metrics.increment).toHaveBeenCalledWith('focus_rounds_started_total');
  });

  it('starts flow mode at safety caps without scheduling an automatic finish', () => {
    const session = waitingSession();
    const { handlers, schedule } = setup(session);

    handlers.get('start_session')({ sessionId: 'room', mode: 'flow' });

    expect(session).toMatchObject({
      mode: 'flow',
      phase: 'focus',
      focusDuration: MAX_FOCUS,
      breakDuration: MAX_BREAK,
      phaseTimer: null,
    });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not let a non-player start or reset a focus round', () => {
    const session = waitingSession();
    const { handlers, schedule, metrics } = setup(session, {
      socket: { id: 'attacker-socket' },
    });

    handlers.get('start_session')({ sessionId: 'room' });

    expect(session.phase).toBe('waiting');
    expect(schedule).not.toHaveBeenCalled();
    expect(metrics.increment).not.toHaveBeenCalled();
  });

  it('does not restart a round that has already left the waiting phase', () => {
    const session = waitingSession();
    session.phase = 'focus';
    session.phaseStartTime = 100_000;
    session.focusRoundId = 'existing-round';
    const beginRound = vi.fn();
    const { handlers, schedule } = setup(session, { beginRound });

    handlers.get('start_session')({ sessionId: 'room' });

    expect(beginRound).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      phaseStartTime: 100_000,
      focusRoundId: 'existing-round',
    });
  });

  it('lets a participant start a new focus round from ready without changing rooms', () => {
    const session = waitingSession();
    session.phase = 'ready';
    session.focusRoundId = 'finished-round';
    const { handlers, schedule, emissions } = setup(session);

    handlers.get('start_session')({
      sessionId: 'room', focusDuration: 25 * 60, breakDuration: 5 * 60,
      mode: 'pomodoro',
    });

    expect(session.phase).toBe('focus');
    expect(session.focusRoundId).not.toBe('finished-round');
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(emissions.at(-1)).toMatchObject({
      roomId: 'room', event: 'phase_change', payload: { phase: 'focus' },
    });
  });

  it('derives a flow break from elapsed server time before advancing', () => {
    const session = waitingSession();
    Object.assign(session, {
      mode: 'flow',
      phase: 'focus',
      phaseStartTime: 0,
      focusDuration: MAX_FOCUS,
    });
    const { handlers, advancePhase } = setup(session);

    handlers.get('finish_flow_focus')({ sessionId: 'room' });

    expect(session.breakDuration).toBe(100);
    expect(session.focusDuration).toBe(MAX_FOCUS);
    expect(advancePhase).toHaveBeenCalledWith('room');
  });

  it('records an interrupted focus before clearing its round and timer', () => {
    const session = waitingSession();
    Object.assign(session, {
      phase: 'focus',
      phaseStartTime: 100_000,
      phaseTimer: 'focus-timer',
      focusRoundId: 'round-key',
    });
    const recordingSnapshot = [];
    const { handlers, cancel, emissions } = setup(session, {
      queueSessionRecording: vi.fn((sessionId, target, completed) => {
        recordingSnapshot.push({
          sessionId,
          completed,
          phase: target.phase,
          roundId: target.focusRoundId,
        });
      }),
    });

    handlers.get('stop_session')({ sessionId: 'room' });

    expect(recordingSnapshot).toEqual([{
      sessionId: 'room',
      completed: false,
      phase: 'focus',
      roundId: 'round-key',
    }]);
    expect(cancel).toHaveBeenCalledWith('focus-timer');
    expect(session).toMatchObject({
      phase: 'waiting',
      phaseStartTime: null,
      phaseTimer: null,
      focusRoundId: null,
    });
    expect(emissions.at(-1)).toMatchObject({
      event: 'phase_change',
      payload: { phase: 'waiting', phaseStartTime: null },
    });
  });
});

describe('pet handler', () => {
  it('derives stage from private focus totals and ignores client stage claims', () => {
    const session = waitingSession();
    session.players['player-socket'].focusSeconds = FULL_AT_SECONDS;
    const { handlers, emissions } = setup(session);

    handlers.get('set_pet')({
      sessionId: 'room',
      pet: 'cat',
      petStage: 'young',
    });

    expect(session.players['player-socket']).toMatchObject({
      pet: 'cat',
      petStage: 'full',
    });
    expect(emissions[0]).toEqual({
      roomId: 'room',
      event: 'pet_changed',
      payload: {
        playerId: 'player-socket',
        pet: 'cat',
        petStage: 'full',
      },
    });
  });

  it('does not let a non-player change another participant companion', () => {
    const session = waitingSession();
    const { handlers, emissions } = setup(session, {
      socket: { id: 'attacker-socket' },
    });

    handlers.get('set_pet')({ sessionId: 'room', pet: 'dragon' });

    expect(session.players['player-socket']).toMatchObject({
      pet: null,
      petStage: null,
    });
    expect(emissions).toEqual([]);
  });
});
