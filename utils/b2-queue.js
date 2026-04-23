const { b2Enabled, deleteFromB2 } = require('../backblaze');

const B2_DELETE_RETRY_ATTEMPTS = parseInt(process.env.B2_DELETE_RETRY_ATTEMPTS || '3', 10);
const B2_DELETE_RETRY_DELAY_MS = parseInt(process.env.B2_DELETE_RETRY_DELAY_MS || '1200', 10);
const B2_DELETE_QUEUE_INTERVAL_MS = parseInt(process.env.B2_DELETE_QUEUE_INTERVAL_MS || '60000', 10);
const B2_DELETE_QUEUE_MAX_ATTEMPTS = parseInt(process.env.B2_DELETE_QUEUE_MAX_ATTEMPTS || '20', 10);
const pendingB2DeleteQueue = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildB2DeleteCandidateKeys(normalizedFilename) {
  const clean = String(normalizedFilename || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!clean) return [];
  const withoutPrefix = clean.replace(/^uploads\//, '');
  const withPrefix = withoutPrefix.startsWith('uploads/') ? withoutPrefix : `uploads/${withoutPrefix}`;
  return Array.from(new Set([withPrefix, clean])).filter(Boolean);
}

async function tryDeleteB2KeyWithRetries(objectKey, context = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= B2_DELETE_RETRY_ATTEMPTS; attempt++) {
    try {
      const ok = await deleteFromB2(objectKey);
      if (ok) {
        console.log(`[b2-delete] success key="${objectKey}" attempt=${attempt} context=${JSON.stringify(context)}`);
        return true;
      }
      lastError = new Error('deleteFromB2 returned false');
    } catch (error) {
      lastError = error;
    }

    if (attempt < B2_DELETE_RETRY_ATTEMPTS) {
      await sleep(B2_DELETE_RETRY_DELAY_MS * attempt);
    }
  }

  console.error(
    `[b2-delete] retry-exhausted key="${objectKey}" attempts=${B2_DELETE_RETRY_ATTEMPTS} context=${JSON.stringify(context)} error=${lastError?.message || 'unknown'}`
  );
  return false;
}

function enqueuePendingB2Delete(objectKey, context = {}, reason = '') {
  if (!objectKey) return;
  const existing = pendingB2DeleteQueue.get(objectKey);
  const queued = {
    objectKey,
    attempts: existing?.attempts || 0,
    queuedAt: existing?.queuedAt || Date.now(),
    lastAttemptAt: existing?.lastAttemptAt || 0,
    reason: reason || existing?.reason || 'unknown',
    context: { ...(existing?.context || {}), ...(context || {}) }
  };
  pendingB2DeleteQueue.set(objectKey, queued);
  console.warn(`[b2-delete] queued key="${objectKey}" reason="${queued.reason}" context=${JSON.stringify(queued.context)}`);
}

function getPendingB2DeleteQueueSnapshot() {
  const entries = Array.from(pendingB2DeleteQueue.values())
    .map(entry => ({
      objectKey: entry.objectKey,
      attempts: entry.attempts,
      queuedAt: entry.queuedAt,
      lastAttemptAt: entry.lastAttemptAt,
      reason: entry.reason,
      context: entry.context || {}
    }))
    .sort((a, b) => a.queuedAt - b.queuedAt);

  return {
    enabled: b2Enabled,
    size: entries.length,
    entries
  };
}

async function processPendingB2DeleteQueue(options = {}) {
  const force = !!options.force;
  const maxItems = Number.isFinite(options.maxItems) ? Math.max(1, Math.floor(options.maxItems)) : Infinity;
  if (!b2Enabled || pendingB2DeleteQueue.size === 0) return;

  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let droppedCount = 0;

  for (const [objectKey, entry] of pendingB2DeleteQueue.entries()) {
    if (processedCount >= maxItems) break;
    const now = Date.now();
    if (!force && entry.lastAttemptAt && (now - entry.lastAttemptAt) < B2_DELETE_QUEUE_INTERVAL_MS) {
      continue;
    }

    processedCount += 1;
    entry.attempts += 1;
    entry.lastAttemptAt = now;

    const deleted = await tryDeleteB2KeyWithRetries(objectKey, {
      ...entry.context,
      queueAttempt: entry.attempts,
      queuedAt: new Date(entry.queuedAt).toISOString(),
      reason: entry.reason
    });

    if (deleted) {
      successCount += 1;
      pendingB2DeleteQueue.delete(objectKey);
      continue;
    }

    failedCount += 1;

    if (entry.attempts >= B2_DELETE_QUEUE_MAX_ATTEMPTS) {
      console.error(
        `[b2-delete] queue-drop key="${objectKey}" attempts=${entry.attempts} context=${JSON.stringify(entry.context)}`
      );
      droppedCount += 1;
      pendingB2DeleteQueue.delete(objectKey);
    } else {
      pendingB2DeleteQueue.set(objectKey, entry);
    }
  }

  return {
    processedCount,
    successCount,
    failedCount,
    droppedCount,
    remaining: pendingB2DeleteQueue.size
  };
}

// Start the background queue runner if B2 is enabled
if (b2Enabled) {
  const timer = setInterval(() => {
    processPendingB2DeleteQueue().catch(error => {
      console.error('[b2-delete] queue-runner error:', error?.message || error);
    });
  }, B2_DELETE_QUEUE_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

module.exports = {
  sleep,
  buildB2DeleteCandidateKeys,
  tryDeleteB2KeyWithRetries,
  enqueuePendingB2Delete,
  getPendingB2DeleteQueueSnapshot,
  processPendingB2DeleteQueue
};
