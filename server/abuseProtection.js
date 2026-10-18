const { BlockList, isIP } = require('node:net');

const DEFAULT_LIMITS = Object.freeze({
  keys: 20_000,
  transports: 256,
  transportsPerIp: 96,
  accounts: 8,
  authInFlight: 16,
  actionsInFlight: 64,
  actionsPerAccount: 8,
  handshakeIp: [120, 60_000],
  handshakeGlobal: [600, 60_000],
  authIp: [120, 60_000],
  authGlobal: [300, 60_000],
  accountConnect: [30, 60_000],
  events: [100, 10_000],
  eventsGlobal: [1000, 10_000],
  httpIp: [300, 60_000],
  httpGlobal: [1200, 60_000],
});
const ACTION_LIMITS = Object.freeze({
  createSession: [5, 60_000], joinSession: [30, 60_000],
  sendInvite: [10, 60_000], shareInvite: [10, 60_000],
  companionName: [20, 60_000], reaction: [1, 3000],
  breakExtension: [10, 60_000], intention: [30, 60_000],
  companionProgress: [10, 60_000],
  roundControl: [30, 60_000], onlineFriends: [20, 60_000],
  sync: [30, 60_000], saveStatus: [12, 60_000], pet: [30, 60_000],
});

function canonicalIp(raw) {
  if (typeof raw !== 'string' || raw.includes('%') || !isIP(raw)) return null;
  if (isIP(raw) === 4) return raw;
  const ip = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  const [left, right] = ip.split('::');
  const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
  const words = [...a, ...Array(8 - a.length - b.length).fill('0'), ...b].map(word => parseInt(word, 16));
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 65535) {
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
  }
  return words.map(word => word.toString(16)).join(':');
}
function ipGroup(ip) {
  // IPv6 privacy addresses within the same /64 share a network budget.
  return ip?.includes(':') ? `${ip.split(':').slice(0, 4).join(':')}::/64` : ip || 'unknown';
}
function addressResolver(cidrs = []) {
  const trusted = new BlockList();
  for (const cidr of cidrs) {
    const [raw, prefix, extra] = cidr.split('/');
    const ip = canonicalIp(raw), bits = Number(prefix);
    if (!ip || extra !== undefined || !/^\d+$/.test(prefix ?? '') || bits < 1 || bits > (ip.includes(':') ? 128 : 32)) {
      throw new Error('Invalid trusted proxy CIDR');
    }
    trusted.addSubnet(ip, bits, ip.includes(':') ? 'ipv6' : 'ipv4');
  }
  const isTrusted = ip => !!ip && trusted.check(ip, ip.includes(':') ? 'ipv6' : 'ipv4');
  return req => {
    const peer = canonicalIp(req.socket?.remoteAddress);
    if (!isTrusted(peer)) return ipGroup(peer);
    const header = req.headers?.['x-forwarded-for'];
    if (typeof header !== 'string' || header.length > 1024) return ipGroup(peer);
    const chain = header.split(',').map(value => canonicalIp(value.trim()));
    if (chain.length > 16 || chain.some(ip => !ip)) return ipGroup(peer);
    // Walk only the explicitly trusted suffix; never trust the leftmost value
    // merely because a caller supplied a forwarded header.
    let ip = peer;
    for (let i = chain.length - 1; i >= 0 && isTrusted(ip); --i) ip = chain[i];
    return ipGroup(ip);
  };
}

function createAbuseProtection({ now = () => performance.now(), limits: overrides = {}, trustedProxyCidrs = [], rejected = () => {} } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const resolveAddress = addressResolver(trustedProxyCidrs);
  const buckets = new Map(), transportsByIp = new Map(), accounts = new Map(), actionCounts = new Map();
  const leases = new Set();
  let lastSweep = -Infinity, authInFlight = 0, actionsInFlight = 0;
  const deny = (reason, retryAfterMs = 1000) => { rejected(reason); return { allowed: false, reason, retryAfterMs }; };
  function take(key, [capacity, windowMs]) {
    const time = now();
    if (time - lastSweep >= 1000) {
      for (const [id, bucket] of buckets) if (bucket.expires <= time) buckets.delete(id);
      lastSweep = time;
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= limits.keys) return { allowed: false, retryAfterMs: 1000 };
      bucket = { tokens: capacity, at: time, expires: time + windowMs }; buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, time - bucket.at) * capacity / windowMs);
    bucket.at = time;
    if (bucket.tokens < 1) return { allowed: false, retryAfterMs: Math.ceil((1 - bucket.tokens) * windowMs / capacity) };
    bucket.tokens -= 1; bucket.expires = time + windowMs;
    return { allowed: true, retryAfterMs: 0 };
  }
  function budget(key, setting, reason) {
    const result = take(key, setting); return result.allowed ? result : deny(reason, result.retryAfterMs);
  }
  function pair(kind, ip) {
    const ipResult = budget(`${kind}:ip:${ip}`, limits[`${kind}Ip`], `${kind}_ip`);
    return ipResult.allowed ? budget(`${kind}:global`, limits[`${kind}Global`], `${kind}_global`) : ipResult;
  }
  function acquire(counts, key, maximum) {
    if ((counts.get(key) || 0) >= maximum) return null;
    counts.set(key, (counts.get(key) || 0) + 1);
    let released = false;
    return () => {
      if (released) return; released = true;
      const count = counts.get(key) - 1;
      if (count) counts.set(key, count); else counts.delete(key);
    };
  }
  return {
    address: resolveAddress,
    http: req => pair('http', resolveAddress(req)),
    admit(req) {
      const ip = resolveAddress(req), result = pair('handshake', ip);
      if (!result.allowed) return result;
      if (leases.size >= limits.transports) return deny('transport_capacity');
      const releaseIp = acquire(transportsByIp, ip, limits.transportsPerIp);
      if (!releaseIp) return deny('ip_capacity');
      let released = false, bound = false;
      const release = () => {
        if (released) return; released = true;
        clearTimeout(timer); req.socket?.off('close', release);
        leases.delete(lease); releaseIp();
      };
      const lease = { ip, release, bind(connection) {
        if (released) { connection.close(true); return; }
        bound = true; clearTimeout(timer); req.socket?.off('close', release);
        connection.once('close', release);
      } };
      const timer = setTimeout(() => { if (!bound) { release(); req.socket?.destroy(); } }, 10_000);
      timer.unref?.(); req.socket?.once('close', release); leases.add(lease);
      return { allowed: true, lease };
    },
    beginAuth(ip) {
      const result = pair('auth', ip);
      if (!result.allowed) return result;
      if (authInFlight >= limits.authInFlight) return deny('auth_capacity');
      ++authInFlight; let released = false;
      return { allowed: true, release() { if (!released) { released = true; --authInFlight; } } };
    },
    account(key) {
      const result = budget(`connect:${key}`, limits.accountConnect, 'account_connect');
      if (!result.allowed) return result;
      const release = acquire(accounts, key, limits.accounts);
      return release ? { allowed: true, release } : deny('account_capacity');
    },
    event(key, cleanup = false) {
      const result = budget(`events:account:${key}`, limits.events, 'events');
      return result.allowed && !cleanup ? budget('events:global', limits.eventsGlobal, 'events_global') : result;
    },
    action(name, key) {
      const setting = ACTION_LIMITS[name];
      if (!setting) throw new Error('Unknown action budget');
      return budget(`action:${name}:${key}`, setting, `action_${name}`).allowed;
    },
    beginAction(key) {
      if (actionsInFlight >= limits.actionsInFlight) return deny('action_capacity');
      const releaseAccount = acquire(actionCounts, key, limits.actionsPerAccount);
      if (!releaseAccount) return deny('account_action_capacity');
      ++actionsInFlight; let released = false;
      return { allowed: true, release() { if (!released) { released = true; --actionsInFlight; releaseAccount(); } } };
    },
    snapshot: () => ({ buckets: buckets.size, transports: leases.size, accounts: accounts.size, authInFlight, actionsInFlight }),
    clear() { for (const lease of leases) lease.release(); buckets.clear(); },
  };
}
module.exports = { createAbuseProtection, addressResolver, canonicalIp, DEFAULT_LIMITS, ACTION_LIMITS };
