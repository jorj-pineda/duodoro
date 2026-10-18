import { afterEach, expect, it, vi } from 'vitest';
import { io as connect } from 'socket.io-client';
import { createRealtimeApp } from './app';
import { createLogger, createMetrics } from './observability';
const apps = new Set(), clients = new Set();
afterEach(async () => { for (const client of clients) client.close(); clients.clear(); await Promise.all([...apps].map(app => app.stop('test'))); apps.clear(); });
const avatar = { skinColor: '#F1C27D', hairStyle: 'bob', hairColor: '#3B2314', eyeStyle: 'normal', outfitColor: '#4A6FA5' };
function database() {
  const result = { data: [], error: null };
  function query() { const q = { select: () => q, update: () => q, eq: () => q, not: () => q, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }; return q; }
  return { auth: { getUser: vi.fn(async token => ({ data: { user: { id: token } }, error: null })) }, from: query,
    rpc: vi.fn(async name => ({ data: name === 'list_accepted_friend_ids' ? [] : 0, error: null })) };
}
async function boot(options = {}) {
  const logs = [], logger = createLogger({ sink: { log: value => logs.push(value), warn: value => logs.push(value), error: value => logs.push(value) } });
  const metrics = createMetrics({ logger });
  const app = createRealtimeApp({ logger, metrics, ...options }); apps.add(app);
  const { port } = await app.start(0); return { app, url: `http://127.0.0.1:${port}`, logs, metrics };
}
function once(socket, event) {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`No ${event}`)), 3000); socket.once(event, value => { clearTimeout(timer); resolve(value); }); });
}
async function client(url, token, options = {}, rejected = false) {
  const socket = connect(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: { token }, ...options }); clients.add(socket);
  const result = once(socket, rejected ? 'connect_error' : 'connect'); socket.connect();
  const error = await result; if (rejected) { socket.close(); return error; } return socket;
}
it('rejects repeated HTTP handshakes before authentication, ignores forged IP headers, and keeps liveness available', async () => {
  const db = database(); const { url } = await boot({ supabase: db, abuseOptions: { limits: { handshakeIp: [1, 60_000] } } });
  const path = `${url}/socket.io/?EIO=4&transport=polling`;
  expect((await fetch(path, { headers: { 'x-forwarded-for': '198.51.100.1' } })).status).toBe(200);
  expect((await fetch(path, { headers: { 'x-forwarded-for': '198.51.100.2' } })).status).toBe(403);
  expect(db.auth.getUser).not.toHaveBeenCalled(); expect((await fetch(`${url}/health`)).status).toBe(200);
});
it('polling and its WebSocket upgrade share one admission instead of spending new handshake tokens', async () => {
  const { url } = await boot({ supabase: database(), abuseOptions: { limits: { handshakeIp: [1, 60_000] } } });
  const socket = await client(url, 'owner', { transports: ['polling', 'websocket'] });
  await vi.waitFor(() => expect(socket.io.engine.transport.name).toBe('websocket'));
  expect(socket.connected).toBe(true); expect((await client(url, 'other', {}, true)).message).toMatch(/websocket error/);
});
it('caps pending verification even if its client disconnects, then drops its late success and releases capacity', async () => {
  const db = database(); let finish;
  db.auth.getUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { app, url } = await boot({ supabase: db, abuseOptions: { limits: { authInFlight: 1 } } });
  const first = connect(url, { reconnection: false, transports: ['websocket'], auth: { token: 'old-owner' } }); clients.add(first);
  await vi.waitFor(() => expect(db.auth.getUser).toHaveBeenCalledTimes(1)); first.close();
  const denied = await client(url, 'new-owner', {}, true); expect(denied.data.code).toBe('RATE_LIMITED');
  expect(db.auth.getUser).toHaveBeenCalledTimes(1);
  finish({ data: { user: { id: 'old-owner' } }, error: null });
  await vi.waitFor(() => expect(app.io.sockets.sockets.size).toBe(0));
  expect((await client(url, 'new-owner')).connected).toBe(true);
  expect([...app.io.sockets.sockets.values()].some(socket => socket.userId === 'old-owner')).toBe(false);
});
it('caps simultaneous verified-account connections without excluding a different account and releases closed slots', async () => {
  const { app, url } = await boot({ supabase: database(), abuseOptions: { limits: { accounts: 1 } } });
  const first = await client(url, 'same-owner');
  expect((await client(url, 'same-owner', {}, true)).data.code).toBe('RATE_LIMITED');
  const other = await client(url, 'other-owner'); expect(other.connected).toBe(true); first.close();
  await vi.waitFor(() => expect(app.io.sockets.sockets.size).toBe(1));
  expect((await client(url, 'same-owner')).connected).toBe(true);
});
it('keeps the room-creation budget through reconnects, isolates accounts, and restores capacity after refill', async () => {
  let time = 0; const db = database(); const { app, url } = await boot({ supabase: db, abuseOptions: { now: () => time } });
  for (let i = 0; i < 5; ++i) {
    const socket = await client(url, 'private-owner');
    const created = once(socket, 'session_created'); socket.emit('create_session', { avatar, displayName: 'Owner' }); await created;
    const serverSocket = app.io.sockets.sockets.get(socket.id); socket.emit('leave_session');
    await vi.waitFor(() => expect(serverSocket.rooms.size).toBe(1)); socket.close();
    await vi.waitFor(() => expect(app.io.sockets.sockets.size).toBe(0));
  }
  const reconnect = await client(url, 'private-owner');
  const denied = once(reconnect, 'session_error'); reconnect.emit('create_session', { avatar, displayName: 'Owner' });
  expect((await denied).message).toMatch(/Too many/);
  expect(db.rpc.mock.calls.filter(([name]) => name === 'total_focus_seconds')).toHaveLength(5);
  const other = await client(url, 'other-owner'); const allowed = once(other, 'session_created'); other.emit('create_session', { avatar, displayName: 'Other' }); await allowed;
  time = 60_001; const refilled = once(reconnect, 'session_created'); reconnect.emit('create_session', { avatar, displayName: 'Owner' }); await refilled;
});
it('meters every event including payload-free messages across reconnects and disconnects a flood', async () => {
  const { url } = await boot({ supabase: database(), abuseOptions: { limits: { events: [2, 60_000] } } });
  const socket = await client(url, 'flood-owner'); const closed = once(socket, 'disconnect');
  socket.emit('register_user'); socket.emit('request_sync'); socket.emit('request_sync');
  expect(await closed).toBe('io server disconnect');
  const again = await client(url, 'flood-owner'); const secondClose = once(again, 'disconnect'); again.emit('register_user'); await secondClose;
  const innocent = await client(url, 'other-owner'); innocent.emit('request_sync'); expect(innocent.connected).toBe(true);
});
it('throttles HTTP with retry guidance, leaves probes reachable, and emits aggregate metrics without IP/token payloads', async () => {
  const { url, logs, metrics } = await boot({ abuseOptions: { limits: { httpIp: [1, 60_000] } } });
  expect((await fetch(url)).status).toBe(200);
  const denied = await fetch(url, { headers: { 'x-forwarded-for': '198.51.100.77' } }); expect(denied.status).toBe(429);
  expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
  expect((await fetch(`${url}/health`)).status).toBe(200);
  expect(metrics.snapshot().counters.abuse_rejections_http_ip_total).toBe(1);
  expect(logs.join('')).not.toContain('198.51.100.77');
});
it('coalesces overlapping room creation and cancels an awaited room change when Leave arrives', async () => {
  const db = database(); let finish;
  let focusCalls = 0;
  db.rpc.mockImplementation(name => name === 'total_focus_seconds' && ++focusCalls === 1
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: name === 'list_accepted_friend_ids' ? [] : 0, error: null }));
  const { url, metrics } = await boot({ supabase: db });
  const socket = await client(url, 'owner');
  const payload = { avatar, displayName: 'Owner' };
  socket.emit('create_session', payload); socket.emit('create_session', payload);
  await vi.waitFor(() => expect(db.rpc.mock.calls.filter(([name]) => name === 'total_focus_seconds')).toHaveLength(1));
  // A following acknowledged event confirms both creation packets were read.
  await new Promise(resolve => socket.emit('get_online_friends', { friendIds: [] }, resolve));
  expect(db.rpc.mock.calls.filter(([name]) => name === 'total_focus_seconds')).toHaveLength(1);
  socket.emit('leave_session');
  await new Promise(resolve => socket.emit('get_online_friends', { friendIds: [] }, resolve));
  finish({ data: 0, error: null });
  await new Promise(resolve => socket.emit('get_online_friends', { friendIds: [] }, resolve));
  expect(metrics.snapshot().counters.sessions_created_total).toBeUndefined();
  const created = once(socket, 'session_created'); socket.emit('create_session', payload); await created;
  expect(metrics.snapshot().counters.sessions_created_total).toBe(1);
});
it('retains async-operation slots through disconnect, then releases without creating a ghost room', async () => {
  const db = database(); let finish;
  let focusCalls = 0;
  db.rpc.mockImplementation(name => name === 'total_focus_seconds' && ++focusCalls === 1
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: name === 'list_accepted_friend_ids' ? [] : 0, error: null }));
  const { app, url, metrics } = await boot({ supabase: db, abuseOptions: { limits: { actionsPerAccount: 1 } } });
  const first = await client(url, 'owner');
  first.emit('create_session', { avatar, displayName: 'Owner' });
  await vi.waitFor(() => expect(db.rpc.mock.calls.filter(([name]) => name === 'total_focus_seconds')).toHaveLength(1)); first.close();
  await vi.waitFor(() => expect(app.io.sockets.sockets.size).toBe(0));
  const second = await client(url, 'owner');
  const busy = once(second, 'session_error'); second.emit('create_session', { avatar, displayName: 'Owner' });
  expect((await busy).message).toMatch(/busy/); expect(db.rpc.mock.calls.filter(([name]) => name === 'total_focus_seconds')).toHaveLength(1);
  finish({ data: 0, error: null });
  // Waiting for an unrelated client's acknowledgement allows the settled
  // read/finally to run without spending this account's occupied slot.
  const other = await client(url, 'other'); await new Promise(resolve => other.emit('get_online_friends', { friendIds: [] }, resolve));
  expect(metrics.snapshot().counters.sessions_created_total).toBeUndefined();
  const created = once(second, 'session_created'); second.emit('create_session', { avatar, displayName: 'Owner' }); await created;
});
it('rejects global event overload with an acknowledgement without disconnecting an innocent account', async () => {
  let time = 0; const { url, metrics } = await boot({ supabase: database(), abuseOptions: { now: () => time, limits: { eventsGlobal: [1, 1000] } } });
  const first = await client(url, 'first'), second = await client(url, 'second');
  await new Promise(resolve => first.emit('get_online_friends', { friendIds: [] }, resolve));
  await new Promise(resolve => second.emit('get_online_friends', { friendIds: [] }, resolve));
  expect(metrics.snapshot().counters.abuse_rejections_events_global_total).toBe(1); expect(second.connected).toBe(true);
  time = 1001; await new Promise(resolve => second.emit('get_online_friends', { friendIds: [] }, resolve));
  expect(second.connected).toBe(true);
});
it('applies backpressure to new rounds while preserving Stop and exactly one recording for accepted focus', async () => {
  const db = database(), records = [], pending = []; let blocked = true;
  db.rpc.mockImplementation((name, payload) => {
    if (name !== 'record_focus_session') return Promise.resolve({ data: name === 'list_accepted_friend_ids' ? [] : 0, error: null });
    records.push(payload);
    const result = { data: { session_id: payload.p_recording_key, inserted: true }, error: null };
    return blocked ? new Promise(resolve => pending.push(() => resolve(result))) : Promise.resolve(result);
  });
  const { url, metrics } = await boot({ supabase: db, abuseOptions: { focusSaveHighWater: 1 } });
  async function room(owner) {
    const socket = await client(url, owner), created = once(socket, 'session_created');
    socket.emit('create_session', { avatar, displayName: 'Owner' }); const { sessionId } = await created;
    const focus = once(socket, 'phase_change'); socket.emit('start_session', { sessionId, mode: 'flow', focusDuration: 1500, breakDuration: 300 });
    expect((await focus).phase).toBe('focus'); return { socket, sessionId };
  }
  const a = await room('a'), b = await room('b');
  const waiting = once(a.socket, 'phase_change'); a.socket.emit('stop_session', { sessionId: a.sessionId }); await waiting;
  await vi.waitFor(() => expect(records).toHaveLength(1));
  const denied = once(a.socket, 'session_error'); a.socket.emit('start_session', { sessionId: a.sessionId, mode: 'flow', focusDuration: 1500, breakDuration: 300 });
  expect((await denied).message).toMatch(/catching up/);
  const blockedBreak = once(b.socket, 'session_error'); b.socket.emit('finish_flow_focus', { sessionId: b.sessionId }); await blockedBreak;
  const stopped = once(b.socket, 'phase_change'); b.socket.emit('stop_session', { sessionId: b.sessionId }); expect((await stopped).phase).toBe('waiting');
  await vi.waitFor(() => expect(records).toHaveLength(2));
  expect(new Set(records.map(record => record.p_recording_key)).size).toBe(2);
  blocked = false; pending.forEach(finish => finish());
  await vi.waitFor(() => expect(metrics.snapshot().counters.focus_record_success_total).toBe(2));
  const resumed = once(a.socket, 'phase_change'); a.socket.emit('start_session', { sessionId: a.sessionId, mode: 'flow', focusDuration: 1500, breakDuration: 300 });
  expect((await resumed).phase).toBe('focus');
});
