import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createSocketAuthentication, tokenExpiresAt } from './socketAuthentication';

it('rejects malformed expiry claims without throwing and preserves numeric dates', () => {
  for (const value of [null, '', 'not-a-jwt', 'a.e30.b', 'a.!invalid.b']) expect(tokenExpiresAt(value)).toBeNull();
  const jwt = exp => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.verified`;
  expect(tokenExpiresAt(jwt('123'))).toBeNull();
  expect(tokenExpiresAt(jwt(-1))).toBeNull();
  expect(tokenExpiresAt(jwt(1e20))).toBeNull();
  expect(tokenExpiresAt(jwt(1800000000.5))).toBe(1800000000500);
});
it('bounds long timer delays, rearms until actual expiry, and cancels when the underlying transport closes', () => {
  let time = 0; const timers = [], cancel = vi.fn();
  const guard = createSocketAuthentication({ now: () => time, schedule: (callback,delay) => { timers.push({ callback,delay }); return timers.length; }, cancel });
  const socket = new EventEmitter(); socket.conn = new EventEmitter(); socket.disconnect = vi.fn();
  guard.bind(socket, 3_000_000_000);
  expect(timers[0].delay).toBe(2_147_483_647); expect(guard.valid(socket)).toBe(true);
  time = 2_147_483_647; timers[0].callback();
  expect(timers[1].delay).toBe(852_516_353); expect(socket.disconnect).not.toHaveBeenCalled();
  socket.conn.emit('close'); expect(cancel).toHaveBeenCalledWith(2); expect(guard.valid(socket)).toBe(false);
});
