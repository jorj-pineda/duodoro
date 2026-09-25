const { createClient } = require('@supabase/supabase-js');
const { createRealtimeApp } = require('./app');
const { createLogger } = require('./observability');
require('dotenv').config({ quiet: true });

function parseAllowedOrigins(value = 'http://localhost:3000') {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function createSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
    },
  });
}

async function main() {
  const logger = createLogger();
  const supabase = createSupabaseClient();

  if (!supabase) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('configuration_invalid', { dependency: 'supabase' });
      process.exitCode = 1;
      return;
    }
    logger.warn('persistence_disabled', { mode: 'development' });
  }

  const realtime = createRealtimeApp({
    supabase,
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGIN),
    reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS) || 60_000,
    logger,
  });
  const startPromise = realtime.start(process.env.PORT || 3001);

  // Render sends SIGTERM before replacing the instance. Clearing on the way
  // out keeps the presence error window bounded to the deployment itself.
  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('shutdown_started', { signal });
      // Bound the full drain: an upstream request can otherwise hang before
      // the HTTP server reaches its close callback.
      // Render's default SIGTERM window is 30 seconds. Leave five seconds for
      // platform cleanup while allowing delayed focus writes to finish.
      setTimeout(() => {
        logger.error('shutdown_timed_out', { signal });
        process.exit(1);
      }, 25_000).unref();
      await realtime.stop('shutdown');
      process.exit(0);
    });
  }

  await startPromise;
}

if (require.main === module) {
  main().catch((error) => {
    const logger = createLogger();
    logger.error('server_start_failed', {
      error_name: typeof error?.name === 'string' ? error.name : 'Error',
    });
    process.exit(1);
  });
}

module.exports = { main, parseAllowedOrigins };
