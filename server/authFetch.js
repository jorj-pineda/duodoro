// Bound remote Auth verification without changing recording/database requests.
// The admission controller keeps its slot until this underlying fetch settles.
function createAuthFetch({ fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname !== '/auth/v1/user') return fetchImpl(input, options);
    const caller = options.signal || input?.signal;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    return fetchImpl(input, { ...options, signal });
  };
}
module.exports = { createAuthFetch };
