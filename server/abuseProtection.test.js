import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { addressResolver, canonicalIp, createAbuseProtection } from './abuseProtection';
const request = (ip = '192.0.2.1', forwarded) => ({ socket: Object.assign(new EventEmitter(), { remoteAddress: ip }), headers: forwarded ? { 'x-forwarded-for': forwarded } : {} });
it('ignores spoofed headers until the actual peer belongs to a configured trusted CIDR', () => {
  expect(addressResolver()(request('192.0.2.1', '203.0.113.8'))).toBe('192.0.2.1');
  const resolve = addressResolver(['10.0.0.0/8']);
  expect(resolve(request('192.0.2.1', '203.0.113.8'))).toBe('192.0.2.1');
  expect(resolve(request('10.0.0.2', '198.51.100.9, 192.0.2.1, 10.1.1.1'))).toBe('192.0.2.1');
  expect(resolve(request('10.0.0.2', '192.0.2.1, garbage'))).toBe('10.0.0.2');
  expect(resolve(request('10.0.0.2', 'x'.repeat(1025)))).toBe('10.0.0.2');
  expect(() => addressResolver(['0.0.0.0/0'])).toThrow('Invalid trusted proxy CIDR');
});
it('canonicalizes mapped IPv4 and IPv6 and groups IPv6 privacy addresses by /64', () => {
  expect(canonicalIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
  expect(canonicalIp('::ffff:c000:201')).toBe('192.0.2.1');
  expect(addressResolver()(request('2001:db8:1:2::123'))).toBe(addressResolver()(request('2001:db8:0001:0002:abcd::4')));
  expect(addressResolver()(request('2001:db8:1:3::1'))).not.toBe(addressResolver()(request('2001:db8:1:2::1')));
  expect(canonicalIp('not an IP')).toBeNull();
});
it('allows a bounded burst, refills steadily, and does not reset a budget on denial', () => {
  let time = 0; const guard = createAbuseProtection({ now: () => time });
  for (let i = 0; i < 5; i++) expect(guard.action('createSession', 'account')).toBe(true);
  expect(guard.action('createSession', 'account')).toBe(false);
  time = 11_999; expect(guard.action('createSession', 'account')).toBe(false);
  time = 12_001; expect(guard.action('createSession', 'account')).toBe(true);
  expect(guard.action('createSession', 'account')).toBe(false);
  expect(guard.action('createSession', 'other')).toBe(true);
});
it('caps counter memory without evicting live budgets and expires idle entries', () => {
  let time = 0; const guard = createAbuseProtection({ now: () => time, limits: { keys: 2 } });
  expect(guard.action('reaction', 'a')).toBe(true); expect(guard.action('reaction', 'b')).toBe(true);
  expect(guard.action('reaction', 'c')).toBe(false); expect(guard.action('reaction', 'a')).toBe(false);
  expect(guard.snapshot().buckets).toBe(2);
  time = 3001; expect(guard.action('reaction', 'c')).toBe(true); expect(guard.snapshot().buckets).toBe(1);
});
it('reserves concurrent transports atomically and releases only on transport close after binding', () => {
  const guard = createAbuseProtection({ limits: { transports: 1 } });
  const req = request(), result = guard.admit(req);
  expect(result.allowed).toBe(true); expect(guard.admit(request()).allowed).toBe(false);
  const connection = new EventEmitter(); result.lease.bind(connection);
  req.socket.emit('close'); expect(guard.snapshot().transports).toBe(1);
  connection.emit('close'); connection.emit('close'); expect(guard.snapshot().transports).toBe(0);
  guard.clear();
});
it('releases failed/unbound transports, caps accounts and async work, and makes releases idempotent', () => {
  const guard = createAbuseProtection({ limits: { accounts: 1, authInFlight: 1, actionsPerAccount: 1, actionsInFlight: 2 } });
  const req = request(); expect(guard.admit(req).allowed).toBe(true); req.socket.emit('close'); expect(guard.snapshot().transports).toBe(0);
  const auth = guard.beginAuth('ip'); expect(guard.beginAuth('ip').allowed).toBe(false); auth.release(); auth.release(); expect(guard.snapshot().authInFlight).toBe(0);
  const account = guard.account('a'); expect(guard.account('a').allowed).toBe(false); expect(guard.account('b').allowed).toBe(true); account.release(); account.release(); expect(guard.account('a').allowed).toBe(true);
  const op = guard.beginAction('a'), other = guard.beginAction('b'); expect(guard.beginAction('a').allowed).toBe(false); expect(guard.beginAction('c').allowed).toBe(false);
  op.release(); op.release(); other.release(); expect(guard.snapshot().actionsInFlight).toBe(0); guard.clear();
});
it('bounds aggregate event work and distinguishes it from an individual account flood', () => {
  let time = 0; const guard = createAbuseProtection({ now: () => time, limits: { eventsGlobal: [1, 1000] } });
  expect(guard.event('a').allowed).toBe(true);
  expect(guard.event('b')).toMatchObject({ allowed: false, reason: 'events_global' });
  expect(guard.event('b', true).allowed).toBe(true); // Stop/Leave remain usable under global overload.
  time = 1001; expect(guard.event('b').allowed).toBe(true);
});
