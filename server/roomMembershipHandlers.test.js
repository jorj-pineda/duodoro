import { describe, expect, it, vi } from 'vitest';
import { registerRoomMembershipHandlers } from './roomMembershipHandlers.js';
import {
  addPlayer,
  createSessionState,
  createShareInvite,
} from './session.js';
import { FULL_AT_SECONDS } from './petLevel.js';

const AVATAR = {
  skinColor: '#F1C27D',
  hairStyle: 'bob',
  hairColor: '#3B2314',
  eyeStyle: 'normal',
  outfitColor: '#4A6FA5',
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup({ userId = '22222222-2222-4222-8222-222222222222', ...overrides } = {}) {
  const handlers = new Map();
  const registrations = new Map();
  const emissions = [];
  const roomEmissions = [];
  const socket = {
    id: 'joining-socket',
    userId,
    join: vi.fn(),
    leave: vi.fn(),
    emit: vi.fn((event, payload) => emissions.push({ event, payload })),
    to: vi.fn((roomId) => ({
      emit: (event, payload) => roomEmissions.push({ roomId, event, payload }),
    })),
  };
  const sessions = {};
  const socketToSession = {};
  const staleSockets = new Map();
  const metrics = { increment: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const dependencies = {
    socket,
    io: {
      sockets: { sockets: staleSockets },
      to: vi.fn(() => ({ emit: vi.fn() })),
    },
    onPayload: (target, event, handler, options) => {
      handlers.set(event, handler);
      registrations.set(event, options);
    },
    sessions,
    socketToSession,
    getSession: (sessionId) => sessions[sessionId],
    leaveSession: vi.fn(),
    canJoinSession: vi.fn().mockResolvedValue(true),
    cancelPendingDisconnect: vi.fn(),
    totalFocusSeconds: vi.fn().mockResolvedValue(0),
    setPresence: vi.fn(),
    createSessionRateLimit: vi.fn(() => true),
    shareInviteRateLimit: vi.fn(() => true),
    joinSessionRateLimit: vi.fn(() => true),
    metrics,
    logger,
    currentWorld: vi.fn(() => 'space'),
    ...overrides,
  };
  registerRoomMembershipHandlers(dependencies);
  return {
    ...dependencies,
    handlers,
    registrations,
    emissions,
    roomEmissions,
    staleSockets,
  };
}

function roomWithHost() {
  const session = createSessionState('forest', 'host-socket');
  addPlayer(session, 'host-socket', {
    avatar: AVATAR,
    displayName: 'Host',
    userId: '11111111-1111-4111-8111-111111111111',
    pet: null,
    petStage: null,
    focusSeconds: 0,
  });
  return session;
}

describe('room creation and share invites', () => {
  it('announces the verified account identity on live joins instead of a payload claim', async () => {
    const harness = setup();
    const room = roomWithHost();
    harness.sessions[room.id] = room;
    await harness.handlers.get('join_session')({
      sessionId: room.id, avatar: AVATAR, displayName: 'Partner',
      userId: '33333333-3333-4333-8333-333333333333',
    });
    expect(harness.roomEmissions).toContainEqual({
      roomId: room.id, event: 'player_joined',
      payload: expect.objectContaining({ playerId: harness.socket.id, userId: harness.socket.userId }),
    });
  });

  it('leaves the old room and derives world and pet stage on the server', async () => {
    const focus = deferred();
    const harness = setup({ totalFocusSeconds: vi.fn(() => focus.promise) });
    harness.socketToSession[harness.socket.id] = 'old-room';

    const creating = harness.handlers.get('create_session')({
      avatar: AVATAR,
      displayName: 'Player',
      world: 'beach',
      pet: 'cat',
      petStage: 'young',
    });

    expect(harness.leaveSession).toHaveBeenCalledWith(harness.socket, 'old-room');
    focus.resolve(FULL_AT_SECONDS);
    await creating;

    const session = Object.values(harness.sessions)[0];
    expect(session.world).toBe('space');
    expect(session.players[harness.socket.id]).toMatchObject({
      pet: 'cat',
      petStage: 'full',
      focusSeconds: FULL_AT_SECONDS,
    });
  });

  it('only issues a share token to a participant while a seat is open', () => {
    const harness = setup();
    const session = roomWithHost();
    harness.sessions[session.id] = session;
    const reply = vi.fn();

    harness.handlers.get('create_share_invite')({ sessionId: session.id }, reply);
    expect(reply).toHaveBeenLastCalledWith({
      ok: false,
      message: 'You are not in this session',
    });

    harness.socket.id = 'host-socket';
    harness.handlers.get('create_share_invite')({ sessionId: session.id }, reply);
    expect(reply.mock.calls.at(-1)[0]).toMatchObject({ ok: true });
    expect(reply.mock.calls.at(-1)[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    addPlayer(session, 'partner-socket', {
      avatar: AVATAR,
      displayName: 'Partner',
      userId: '33333333-3333-4333-8333-333333333333',
      pet: null,
      petStage: null,
      focusSeconds: 0,
    });
    harness.handlers.get('create_share_invite')({ sessionId: session.id }, reply);
    expect(reply).toHaveBeenLastCalledWith({ ok: false, message: 'Session is full' });
  });
});

describe('room admission ordering', () => {
  it('does not leave an existing room when authorization rejects the target', async () => {
    const harness = setup({ canJoinSession: vi.fn().mockResolvedValue(false) });
    const session = roomWithHost();
    harness.sessions[session.id] = session;
    harness.socketToSession[harness.socket.id] = 'current-room';

    await harness.handlers.get('join_session')({
      sessionId: session.id,
      avatar: AVATAR,
      displayName: 'Intruder',
    });

    expect(harness.leaveSession).not.toHaveBeenCalled();
    expect(harness.emissions).toContainEqual({
      event: 'session_error',
      payload: { message: 'This session is private' },
    });
  });

  it('reserves the last seat before focus lookup and releases it afterward', async () => {
    const focus = deferred();
    const harness = setup({ totalFocusSeconds: vi.fn(() => focus.promise) });
    const session = roomWithHost();
    harness.sessions[session.id] = session;

    const joining = harness.handlers.get('join_session')({
      sessionId: session.id,
      avatar: AVATAR,
      displayName: 'Partner',
    });
    await Promise.resolve();

    expect(session.pendingJoinUserIds).toEqual(new Set([harness.socket.userId]));
    expect(session.players).not.toHaveProperty(harness.socket.id);

    focus.resolve(0);
    await joining;
    expect(session.pendingJoinUserIds.size).toBe(0);
    expect(session.players).toHaveProperty(harness.socket.id);
  });

  it('consumes a share token before awaiting focus and rejects a concurrent replay', async () => {
    const focus = deferred();
    const session = roomWithHost();
    const invite = createShareInvite(session);
    const first = setup({ totalFocusSeconds: vi.fn(() => focus.promise) });
    first.sessions[session.id] = session;

    const joining = first.handlers.get('join_session')({
      shareToken: invite.token,
      avatar: AVATAR,
      displayName: 'First',
    });
    expect(session.shareInvite).toBeNull();

    const replay = setup({ userId: '44444444-4444-4444-8444-444444444444' });
    replay.sessions[session.id] = session;
    await replay.handlers.get('join_session')({
      shareToken: invite.token,
      avatar: AVATAR,
      displayName: 'Replay',
    });
    expect(replay.emissions).toContainEqual({
      event: 'session_error',
      payload: { message: 'Invite link is invalid or expired' },
    });

    focus.resolve(0);
    await joining;
    expect(session.pendingJoinUserIds.size).toBe(0);
  });

  it('rekeys a reconnecting player and transfers host authority', async () => {
    const harness = setup({ userId: '11111111-1111-4111-8111-111111111111' });
    const session = roomWithHost();
    harness.sessions[session.id] = session;
    harness.socketToSession['host-socket'] = session.id;
    const staleSocket = { leave: vi.fn() };
    harness.staleSockets.set('host-socket', staleSocket);

    await harness.handlers.get('join_session')({
      sessionId: session.id,
      avatar: AVATAR,
      displayName: 'Host back',
    });

    expect(harness.cancelPendingDisconnect).toHaveBeenCalledWith('host-socket');
    expect(staleSocket.leave).toHaveBeenCalledWith(session.id);
    expect(harness.socketToSession).not.toHaveProperty('host-socket');
    expect(harness.socketToSession[harness.socket.id]).toBe(session.id);
    expect(session.hostId).toBe(harness.socket.id);
    expect(session.players).not.toHaveProperty('host-socket');
    expect(session.players).toHaveProperty(harness.socket.id);
    expect(harness.metrics.increment).toHaveBeenCalledWith('session_reconnects_total');
  });
});
