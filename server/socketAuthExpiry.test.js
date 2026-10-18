import { afterEach, expect, it, vi } from 'vitest';
import { io as connect } from 'socket.io-client';
import { createRealtimeApp } from './app';
import { createLogger } from './observability';

const apps = new Set(), clients = new Set();
afterEach(async () => { for (const s of clients) s.close(); clients.clear(); await Promise.all([...apps].map(a => a.stop('test'))); apps.clear(); });
const avatar = { skinColor: '#F1C27D', hairStyle: 'bob', hairColor: '#3B2314', eyeStyle: 'normal', outfitColor: '#4A6FA5' };
const token = (sub, exp) => `review.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.verified-by-stub`;
function database() {
  const q = () => { const v = { select: () => v, update: () => v, eq: () => v, not: () => v, then: (r,j) => Promise.resolve({ data: [], error: null }).then(r,j) }; return v; };
  return { auth: { getUser: vi.fn(async value => ({ data: { user: { id: JSON.parse(Buffer.from(value.split('.')[1], 'base64url')).sub } }, error: null })) }, from: q,
    rpc: vi.fn(async (name,payload) => ({ data: name === 'list_accepted_friend_ids' ? [] : name === 'record_focus_session' ? { session_id: payload.p_recording_key, inserted: true } : 0, error: null })) };
}
const once = (socket,event) => new Promise((resolve,reject) => { const t = setTimeout(() => reject(new Error(`No ${event}`)), 3000); socket.once(event,value => { clearTimeout(t); resolve(value); }); });
async function boot(db, authenticationOptions = {}) {
  const app = createRealtimeApp({ supabase: db, authenticationOptions, logger: createLogger({ sink: { log(){},warn(){},error(){} } }) });
  apps.add(app); const { port } = await app.start(0); return { app, url: `http://127.0.0.1:${port}` };
}
async function client(url,value,rejected = false) {
  const s = connect(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: { token: value } }); clients.add(s);
  const result = once(s,rejected ? 'connect_error' : 'connect'); s.connect(); const reply = await result; return rejected ? reply : s;
}
it('rejects verified tokens that have expired or omit a usable expiry', async () => {
  const db = database(), time = Date.now(); const { url } = await boot(db, { now: () => time });
  for (const exp of [Math.floor(time/1000)-1, undefined, '9999999999', 1e20]) {
    const error = await client(url,token('owner',exp),true);
    expect(error.message).toBe('Invalid or expired token');
  }
});
it('closes an expired verified socket even when it sends no further application messages', async () => {
  let time = 1_800_000_000_000; const callbacks = [], cancel = vi.fn();
  const { url } = await boot(database(), { now: () => time, schedule: callback => { callbacks.push(callback); return callbacks.length; }, cancel });
  const socket = await client(url,token('owner',time/1000+2));
  expect(callbacks).toHaveLength(1);
  const expired = once(socket,'authentication_expired'), disconnected = once(socket,'disconnect');
  time += 2001; callbacks[0](); await expired;
  expect(await disconnected).toBe('io server disconnect'); expect(cancel).toHaveBeenCalled();
});
it('checks expiry before dispatch even if the deadline callback is delayed and preserves the round on rejoin', async () => {
  let time = 1_800_000_000_000; const db = database();
  const { url } = await boot(db, { now: () => time, schedule: () => 1, cancel: () => {} });
  const first = await client(url,token('owner',time/1000+2));
  const created = once(first,'session_created'); first.emit('create_session',{ avatar,displayName:'Owner' }); const { sessionId } = await created;
  const focused = once(first,'phase_change'); first.emit('start_session',{ sessionId,mode:'flow',focusDuration:1500,breakDuration:300 });
  const phase = await focused;
  time += 2001; const expired = once(first,'authentication_expired'), disconnected = once(first,'disconnect');
  first.emit('stop_session',{ sessionId }); await expired; await disconnected;
  expect(db.rpc.mock.calls.filter(([name]) => name === 'record_focus_session')).toHaveLength(0);
  const fresh = await client(url,token('owner',time/1000+60));
  const synced = once(fresh,'sync_state'); fresh.emit('join_session',{ sessionId,avatar,displayName:'Owner' });
  expect(await synced).toMatchObject({ sessionId,phase:'focus',phaseStartTime:phase.phaseStartTime,completedRounds:0,playerCount:1 });
});
