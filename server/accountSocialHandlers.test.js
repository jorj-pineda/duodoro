import { describe, expect, it, vi } from 'vitest';
import { registerAccountHandlers } from './accountHandlers.js';
import { registerSocialHandlers } from './socialHandlers.js';

function capturePayloadHandlers() {
  const handlers = new Map();
  const options = new Map();
  return {
    handlers,
    options,
    onPayload: vi.fn((socket, event, handler, eventOptions) => {
      handlers.set(event, handler);
      options.set(event, eventOptions);
    }),
  };
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeMetrics() {
  return { increment: vi.fn() };
}

describe('account handlers', () => {
  it('registers only the verified socket identity and broadcasts once', () => {
    const listeners = new Map();
    const socket = {
      id: 'socket-1',
      userId: 'verified-user',
      on: vi.fn((event, handler) => listeners.set(event, handler)),
    };
    const presence = { add: vi.fn().mockReturnValue(true) };
    const broadcastPresence = vi.fn();
    const payloads = capturePayloadHandlers();

    registerAccountHandlers({
      socket,
      io: { sockets: { sockets: new Map() } },
      onPayload: payloads.onPayload,
      supabase: null,
      presence,
      broadcastPresence,
      removeUserFromLiveSessions: vi.fn(),
      metrics: fakeMetrics(),
      logger: fakeLogger(),
    });
    listeners.get('register_user')({ userId: 'attacker' });

    expect(presence.add).toHaveBeenCalledWith('verified-user', 'socket-1');
    expect(broadcastPresence).toHaveBeenCalledWith('verified-user', true);
  });

  it('deletes only the verified account and disconnects all of its tabs', async () => {
    const payloads = capturePayloadHandlers();
    const socket = {
      id: 'socket-1',
      userId: 'verified-user',
      userEmail: 'verified@example.com',
      on: vi.fn(),
    };
    const matchingTab = { userId: 'verified-user', disconnect: vi.fn() };
    const otherTab = { userId: 'other-user', disconnect: vi.fn() };
    const deleteAccount = vi.fn().mockResolvedValue(undefined);
    const commit = vi.fn();
    const prepareAccountDeletion = vi.fn().mockResolvedValue({ commit, rollback: vi.fn() });
    const removeUserFromLiveSessions = vi.fn();
    const respond = vi.fn();

    registerAccountHandlers({
      socket,
      io: { sockets: { sockets: new Map([
        ['matching', matchingTab],
        ['other', otherTab],
      ]) } },
      onPayload: payloads.onPayload,
      supabase: { privileged: true },
      presence: { add: vi.fn() },
      broadcastPresence: vi.fn(),
      removeUserFromLiveSessions,
      prepareAccountDeletion,
      metrics: fakeMetrics(),
      logger: fakeLogger(),
      deleteAccount,
      schedule: (callback) => callback(),
    });
    await payloads.handlers.get('delete_account')({
      confirmation: 'DELETE',
      userId: 'attacker-chosen-user',
    }, respond);

    expect(deleteAccount).toHaveBeenCalledWith(
      { privileged: true },
      { userId: 'verified-user', email: 'verified@example.com' },
    );
    expect(prepareAccountDeletion).toHaveBeenCalledWith('verified-user');
    expect(prepareAccountDeletion.mock.invocationCallOrder[0])
      .toBeLessThan(deleteAccount.mock.invocationCallOrder[0]);
    expect(commit).toHaveBeenCalledOnce();
    expect(removeUserFromLiveSessions).toHaveBeenCalledWith('verified-user');
    expect(respond).toHaveBeenCalledWith({ ok: true });
    expect(matchingTab.disconnect).toHaveBeenCalledWith(true);
    expect(otherTab.disconnect).not.toHaveBeenCalled();
  });

  it('restores deletion availability after a failed privileged operation', async () => {
    const payloads = capturePayloadHandlers();
    const socket = { id: 'socket-1', userId: 'user-1', on: vi.fn() };
    const metrics = fakeMetrics();
    const respond = vi.fn();
    const rollback = vi.fn();

    registerAccountHandlers({
      socket,
      io: { sockets: { sockets: new Map() } },
      onPayload: payloads.onPayload,
      supabase: {},
      presence: { add: vi.fn() },
      broadcastPresence: vi.fn(),
      removeUserFromLiveSessions: vi.fn(),
      metrics,
      logger: fakeLogger(),
      prepareAccountDeletion: vi.fn().mockResolvedValue({ commit: vi.fn(), rollback }),
      deleteAccount: vi.fn().mockRejectedValue(
        Object.assign(new Error('private detail'), { code: 'PGRST001' }),
      ),
    });
    await payloads.handlers.get('delete_account')({ confirmation: 'DELETE' }, respond);

    expect(socket.accountDeletionPending).toBe(false);
    expect(rollback).toHaveBeenCalledOnce();
    expect(metrics.increment).toHaveBeenCalledWith('account_deletion_failures_total');
    expect(respond).toHaveBeenCalledWith({
      ok: false,
      message: 'Could not delete your account. Please try again.',
    });
  });

  it('does not delete the account when pending rounds cannot be discarded', async () => {
    const payloads = capturePayloadHandlers();
    const deleteAccount = vi.fn();
    const respond = vi.fn();
    registerAccountHandlers({
      socket: { id: 'socket-1', userId: 'user-1', on: vi.fn() },
      io: { sockets: { sockets: new Map() } },
      onPayload: payloads.onPayload,
      supabase: {},
      presence: { add: vi.fn() },
      broadcastPresence: vi.fn(),
      removeUserFromLiveSessions: vi.fn(),
      prepareAccountDeletion: vi.fn().mockRejectedValue(new Error('queue unavailable')),
      metrics: fakeMetrics(),
      logger: fakeLogger(),
      deleteAccount,
    });

    await payloads.handlers.get('delete_account')({ confirmation: 'DELETE' }, respond);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({
      ok: false,
      message: 'Could not delete your account. Please try again.',
    });
  });
});

describe('social handlers', () => {
  function setup(overrides = {}) {
    const payloads = capturePayloadHandlers();
    const deliveries = [];
    const socket = {
      id: 'sender-socket',
      userId: 'sender-user',
      emit: vi.fn(),
    };
    const presence = {
      isOnline: vi.fn((id) => id === 'online-friend'),
      socketsFor: vi.fn().mockReturnValue(['target-tab-1', 'target-tab-2']),
    };
    const dependencies = {
      socket,
      io: {
        to: (socketId) => ({
          emit: (event, payload) => deliveries.push({ socketId, event, payload }),
        }),
      },
      onPayload: payloads.onPayload,
      presence,
      sessions: {},
      getFriendIds: vi.fn().mockResolvedValue(['online-friend', 'offline-friend']),
      areFriends: vi.fn().mockResolvedValue(true),
      inviteRateLimit: vi.fn().mockReturnValue(true),
      metrics: fakeMetrics(),
      logger: fakeLogger(),
      ...overrides,
    };
    registerSocialHandlers(dependencies);
    return { ...dependencies, payloads, deliveries };
  }

  it('returns only requested ids that are both accepted and online', async () => {
    const { payloads, getFriendIds } = setup();
    const callback = vi.fn();

    await payloads.handlers.get('get_online_friends')({
      friendIds: ['online-friend', 'offline-friend', 'stranger'],
    }, callback);

    expect(getFriendIds).toHaveBeenCalledWith('sender-user');
    expect(callback).toHaveBeenCalledWith(['online-friend']);
  });

  it('delivers a friend invite to every tab using server-owned room state', async () => {
    const session = {
      world: 'space',
      players: { 'sender-socket': {} },
      pendingJoinUserIds: new Set(),
      invitedUserIds: new Set(),
    };
    const { payloads, deliveries, metrics } = setup({
      sessions: { room: session },
    });

    await payloads.handlers.get('send_invite')({
      targetUserId: 'target-user',
      sessionId: 'room',
      fromName: 'Sender',
      worldId: 'attacker-world',
      fromUserId: 'attacker-user',
    });

    expect(session.invitedUserIds.has('target-user')).toBe(true);
    expect(deliveries).toEqual([
      {
        socketId: 'target-tab-1',
        event: 'session_invite',
        payload: {
          sessionId: 'room',
          worldId: 'space',
          fromName: 'Sender',
          fromUserId: 'sender-user',
        },
      },
      {
        socketId: 'target-tab-2',
        event: 'session_invite',
        payload: {
          sessionId: 'room',
          worldId: 'space',
          fromName: 'Sender',
          fromUserId: 'sender-user',
        },
      },
    ]);
    expect(metrics.increment).toHaveBeenCalledWith('session_invites_sent_total');
  });

  it('applies invite rate limiting before parsing attacker payloads', async () => {
    const inviteRateLimit = vi.fn().mockReturnValue(false);
    const { payloads, socket, areFriends } = setup({ inviteRateLimit });

    await payloads.handlers.get('send_invite')({ targetUserId: null });

    expect(inviteRateLimit).toHaveBeenCalledWith('sender-socket');
    expect(socket.emit).toHaveBeenCalledWith('invite_error', {
      message: 'Too many invites, slow down',
    });
    expect(areFriends).not.toHaveBeenCalled();
  });
});
