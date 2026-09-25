const { createClient } = require('redis');
const { safeErrorFields } = require('./observability');

// Pending records contain participant IDs. Keep the hash private to the
// realtime service; never expose its URL or contents in logs or client events.
const PENDING_KEY = 'duodoro:focus:pending:v1';

function parseEntry(recordingKey, serialized) {
  const payload = JSON.parse(serialized);
  if (
    payload?.p_recording_key !== recordingKey ||
    !Array.isArray(payload.p_user_ids) ||
    payload.p_user_ids.length < 1 ||
    payload.p_user_ids.length > 2
  ) {
    throw new Error('Invalid queued focus record');
  }
  return payload;
}

function createFocusQueue(client) {
  return {
    async put(payload) {
      const key = payload.p_recording_key;
      const value = JSON.stringify(payload);
      const inserted = await client.hSetNX(PENDING_KEY, key, value);
      if (!inserted) {
        // One key must always describe one immutable round. A second process
        // can safely enqueue the same event during a rolling deployment.
        const existing = await client.hGet(PENDING_KEY, key);
        if (existing !== value) throw new Error('Conflicting queued focus record');
      }
    },

    remove(recordingKey) {
      return client.hDel(PENDING_KEY, recordingKey);
    },

    async *entries() {
      for await (const { field, value } of client.hScanIterator(PENDING_KEY)) {
        yield parseEntry(field, value);
      }
    },

    async hasForUser(userId) {
      for await (const payload of this.entries()) {
        if (payload.p_user_ids.includes(userId)) return true;
      }
      return false;
    },

    async removeForUser(userId) {
      let removed = 0;
      for await (const payload of this.entries()) {
        if (!payload.p_user_ids.includes(userId)) continue;
        removed += await this.remove(payload.p_recording_key);
      }
      return removed;
    },

    count() {
      return client.hLen(PENDING_KEY);
    },

    close() {
      client.destroy();
    },
  };
}

async function connectFocusQueue(url, logger) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 3000 },
    commandOptions: { timeout: 5000 },
  });
  client.on('error', (error) => {
    logger.error('focus_queue_connection_failed', safeErrorFields(error));
  });
  try {
    await client.connect();
  } catch (error) {
    client.destroy();
    throw error;
  }
  return createFocusQueue(client);
}

module.exports = { PENDING_KEY, createFocusQueue, connectFocusQueue };
