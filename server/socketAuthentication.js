// Read expiry only after Supabase has verified the token. Decoding is never
// a substitute for signature/user verification.
function tokenExpiresAt(token) {
  try {
    if (typeof token !== 'string' || token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const { exp } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0 || exp > Number.MAX_SAFE_INTEGER / 1000) return null;
    return Math.floor(exp * 1000);
  } catch { return null; }
}

function createSocketAuthentication({ now = Date.now, schedule = setTimeout, cancel = clearTimeout, expired = () => {} } = {}) {
  const states = new WeakMap();
  function expire(socket) {
    const state = states.get(socket);
    if (!state || state.expired) return;
    state.expired = true; expired();
    socket.emit('authentication_expired');
    socket.disconnect(true);
  }
  return {
    now,
    expire,
    valid(socket) {
      const state = states.get(socket);
      return !!state && !state.expired && now() < state.expiresAt;
    },
    bind(socket, expiresAt) {
      const state = { expiresAt, expired: false, timer: null };
      states.set(socket, state);
      const cleanup = () => {
        cancel(state.timer); states.delete(socket);
        socket.off('disconnect', cleanup); socket.conn.off('close', cleanup);
      };
      socket.once('disconnect', cleanup); socket.conn.once('close', cleanup);
      const arm = () => {
        const remaining = expiresAt - now();
        if (remaining <= 0) { expire(socket); return; }
        // Node clamps larger delays to 1ms. Recheck unusually long-lived
        // verified tokens without prematurely expiring or spinning on them.
        state.timer = schedule(arm, Math.min(remaining, 2_147_483_647));
        state.timer?.unref?.();
      };
      arm();
    },
  };
}
module.exports = { tokenExpiresAt, createSocketAuthentication };
