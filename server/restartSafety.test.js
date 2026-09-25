import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { createRealtimeApp } from './app.js';
import { createLogger } from './observability.js';

const HOST_ID = '11111111-1111-4111-8111-111111111111';
const PARTNER_ID = '22222222-2222-4222-8222-222222222222';
const AVATAR = {
  skinColor: '#F1C27D', hairStyle: 'bob', hairColor: '#3B2314',
  eyeStyle: 'normal', outfitColor: '#4A6FA5',
};

function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5000);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function fakeDatabase({ recordDelayMs = 0 } = {}) {
  const records = [];
  const presence = new Map();
  const db = {
    records,
    presence,
    recordingUnavailable: false,
    auth: {
      getUser: vi.fn(async (token) => ({ data: { user: { id: token } }, error: null })),
    },
    rpc: vi.fn(async (name, payload) => {
      if (name === 'total_focus_seconds') return { data: 0, error: null };
      if (name === 'record_focus_session') {
        if (db.recordingUnavailable) {
          return { data: null, error: { code: '42501', message: 'permission denied' } };
        }
        if (recordDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, recordDelayMs));
        }
        records.push(payload);
        return { data: { session_id: randomUUID(), inserted: true }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }),
    from: () => ({
      update: (fields) => ({
        eq: async (_column, id) => {
          presence.set(id, fields.current_session_id);
          return { error: null };
        },
        not: async () => {
          for (const id of presence.keys()) presence.set(id, null);
          return { error: null };
        },
      }),
    }),
  };
  return db;
}

const apps = new Set();
const sockets = new Set();

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.clear();
  await Promise.all([...apps].map((app) => app.stop('test')));
  apps.clear();
});

async function start(db, { reconnectGraceMs, focusQueue, replayIntervalMs } = {}) {
  const app = createRealtimeApp({
    supabase: db,
    reconnectGraceMs,
    focusQueue,
    replayIntervalMs,
    logger: createLogger({ sink: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }),
  });
  apps.add(app);
  const address = await app.start(0);
  return { app, url: `http://127.0.0.1:${address.port}` };
}

async function connectUser(url, userId) {
  const socket = connect(url, {
    auth: { token: userId }, transports: ['websocket'], reconnection: false,
  });
  sockets.add(socket);
  await nextEvent(socket, 'connect');
  return socket;
}

describe('graceful restart', () => {
  it('replays a failed save after restart and clears the pending status', async () => {
    const db = fakeDatabase();
    const pending = new Map();
    const focusQueue = {
      put: async (payload) => { pending.set(payload.p_recording_key, payload); },
      remove: async (key) => Number(pending.delete(key)),
      entries: async function* () { yield* pending.values(); },
      hasForUser: async (userId) => [...pending.values()]
        .some((payload) => payload.p_user_ids.includes(userId)),
      close: vi.fn(),
    };
    db.recordingUnavailable = true;
    const { app, url } = await start(db, { focusQueue, replayIntervalMs: 100 });
    const host = await connectUser(url, HOST_ID);
    const created = nextEvent(host, 'sync_state');
    host.emit('create_session', { avatar: AVATAR, displayName: 'Host' });
    const { sessionId } = await created;
    const focusing = nextEvent(host, 'phase_change');
    host.emit('start_session', { sessionId, focusDuration: 60, breakDuration: 30 });
    await focusing;

    const pendingStatus = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for pending save')), 5000);
      const listener = ({ state }) => {
        if (state !== 'pending') return;
        clearTimeout(timeout);
        host.off('focus_save_status', listener);
        resolve();
      };
      host.on('focus_save_status', listener);
    });
    host.emit('stop_session', { sessionId });
    await pendingStatus;
    expect(pending.size).toBe(1);
    expect(db.records).toHaveLength(0);
    await app.stop('shutdown');

    db.recordingUnavailable = false;
    const replacement = await start(db, { focusQueue, replayIntervalMs: 100 });
    await vi.waitFor(() => expect(db.records).toHaveLength(1));
    await vi.waitFor(() => expect(pending.size).toBe(0));
    const reconnected = await connectUser(replacement.url, HOST_ID);
    const clearStatus = nextEvent(reconnected, 'focus_save_status');
    reconnected.emit('request_focus_save_status');
    expect(await clearStatus).toEqual({ state: 'clear' });
  });

  it('does not record a disconnected solo player again when grace expires during shutdown', async () => {
    const db = fakeDatabase({ recordDelayMs: 200 });
    const { app, url } = await start(db, { reconnectGraceMs: 80 });
    const host = await connectUser(url, HOST_ID);
    const created = nextEvent(host, 'sync_state');
    host.emit('create_session', { avatar: AVATAR, displayName: 'Host' });
    const { sessionId } = await created;

    const focusing = nextEvent(host, 'phase_change');
    host.emit('start_session', { sessionId, focusDuration: 60, breakDuration: 30 });
    await focusing;

    const disconnected = nextEvent(app.io.sockets.sockets.get(host.id), 'disconnect');
    host.close();
    await disconnected;
    await app.stop('shutdown');

    expect(db.rpc.mock.calls.filter(([name]) => name === 'record_focus_session'))
      .toHaveLength(1);
    expect(db.records[0]).toMatchObject({
      p_room_code: sessionId,
      p_completed: false,
      p_user_ids: [HOST_ID],
    });
  });

  it('saves one partial round for both users, ends the room, and clears presence', async () => {
    const db = fakeDatabase({ recordDelayMs: 100 });
    const { app, url } = await start(db);
    const host = await connectUser(url, HOST_ID);
    const partner = await connectUser(url, PARTNER_ID);

    const created = nextEvent(host, 'sync_state');
    host.emit('create_session', { avatar: AVATAR, displayName: 'Host' });
    const { sessionId } = await created;
    const inviteReply = new Promise((resolve) => {
      host.emit('create_share_invite', { sessionId }, resolve);
    });
    const { token } = await inviteReply;
    const joined = nextEvent(partner, 'sync_state');
    partner.emit('join_session', { shareToken: token, avatar: AVATAR, displayName: 'Partner' });
    expect((await joined).playerCount).toBe(2);

    const focusing = nextEvent(partner, 'phase_change');
    host.emit('start_session', {
      sessionId, focusDuration: 60, breakDuration: 30, mode: 'pomodoro',
    });
    expect((await focusing).phase).toBe('focus');
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const hostNotice = nextEvent(host, 'session_error');
    const partnerNotice = nextEvent(partner, 'session_error');
    await Promise.all([app.stop('shutdown'), app.stop('shutdown')]);
    const expectedNotice = {
      message: 'Room ended during a server restart. Check History for your focus time.',
    };
    expect(await hostNotice).toEqual(expectedNotice);
    expect(await partnerNotice).toEqual(expectedNotice);
    expect(db.records).toHaveLength(1);
    expect(db.records[0]).toMatchObject({
      p_room_code: sessionId,
      p_completed: false,
      p_focus_duration: 60,
      p_user_ids: [HOST_ID, PARTNER_ID],
    });
    expect(db.records[0].p_actual_focus).toBeGreaterThan(0);
    expect(db.records[0].p_actual_focus).toBeLessThan(60);
    expect(db.presence.get(HOST_ID)).toBeNull();
    expect(db.presence.get(PARTNER_ID)).toBeNull();

    const replacement = await start(db);
    const reconnected = await connectUser(replacement.url, HOST_ID);
    const refused = nextEvent(reconnected, 'session_error');
    reconnected.emit('join_session', { sessionId, avatar: AVATAR });
    expect((await refused).message).toBe('Session not found');
  });
});
