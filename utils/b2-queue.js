const db = require('../database');
const { b2Enabled, deleteFromB2 } = require('../backblaze');

const B2_DELETE_RETRY_ATTEMPTS = parseInt(process.env.B2_DELETE_RETRY_ATTEMPTS || '3', 10);
const B2_DELETE_RETRY_DELAY_MS = parseInt(process.env.B2_DELETE_RETRY_DELAY_MS || '1200', 10);
const B2_DELETE_QUEUE_INTERVAL_MS = parseInt(process.env.B2_DELETE_QUEUE_INTERVAL_MS || '60000', 10);
const B2_DELETE_QUEUE_MAX_ATTEMPTS = parseInt(process.env.B2_DELETE_QUEUE_MAX_ATTEMPTS || '20', 10);
const B2_DELETE_QUEUE_CLAIM_MS = parseInt(process.env.B2_DELETE_QUEUE_CLAIM_MS || '120000', 10);
const queueWorkerId = `pid-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

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

async function enqueuePendingB2Delete(objectKey, context = {}, reason = '') {
  if (!objectKey) return;
  const normalizedReason = String(reason || '').trim() || 'unknown';
  const contextJson = JSON.stringify(context || {});

  await db.prepare(`
    INSERT INTO b2_delete_queue (
      object_key,
      attempts,
      queued_at,
      next_attempt_at,
      locked_until,
      locked_by,
      reason,
      context_json
    )
    VALUES (?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, NULL, ?, ?::jsonb)
    ON CONFLICT (object_key)
    DO UPDATE SET
      next_attempt_at = CURRENT_TIMESTAMP,
      locked_until = NULL,
      locked_by = NULL,
      reason = EXCLUDED.reason,
      context_json = COALESCE(b2_delete_queue.context_json, '{}'::jsonb) || EXCLUDED.context_json
  `).run(objectKey, normalizedReason, contextJson);

  console.warn(`[b2-delete] queued key="${objectKey}" reason="${normalizedReason}" context=${contextJson}`);
}

async function getPendingB2DeleteQueueSnapshot() {
  const rows = await db.prepare(`
    SELECT object_key, attempts, queued_at, last_attempt_at, next_attempt_at, locked_until, locked_by, reason, context_json
    FROM b2_delete_queue
    ORDER BY queued_at ASC, object_key ASC
  `).all();

  const entries = rows.map(row => ({
    objectKey: row.object_key,
    attempts: Number(row.attempts || 0),
    queuedAt: row.queued_at,
    lastAttemptAt: row.last_attempt_at,
    nextAttemptAt: row.next_attempt_at,
    lockedUntil: row.locked_until,
    lockedBy: row.locked_by,
    reason: row.reason,
    context: row.context_json || {}
  }));

  return {
    enabled: b2Enabled,
    size: entries.length,
    entries
  };
}

async function claimPendingB2DeleteEntries(force, maxItems) {
  return db.prepare(`
    UPDATE b2_delete_queue AS queue
    SET locked_until = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond'),
        locked_by = ?,
        last_attempt_at = CURRENT_TIMESTAMP,
        attempts = queue.attempts + 1
    WHERE queue.object_key IN (
      SELECT object_key
      FROM b2_delete_queue
      WHERE (? OR next_attempt_at <= CURRENT_TIMESTAMP)
        AND (locked_until IS NULL OR locked_until <= CURRENT_TIMESTAMP)
      ORDER BY queued_at ASC, object_key ASC
      LIMIT ?
      FOR UPDATE SKIP LOCKED
    )
    RETURNING object_key, attempts, queued_at, last_attempt_at, reason, context_json
  `).all(B2_DELETE_QUEUE_CLAIM_MS, queueWorkerId, force, maxItems);
}

async function processPendingB2DeleteQueue(options = {}) {
  const force = !!options.force;
  const maxItems = Number.isFinite(options.maxItems) ? Math.max(1, Math.floor(options.maxItems)) : Infinity;
  if (!b2Enabled) {
    return {
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      droppedCount: 0,
      remaining: 0
    };
  }

  const claimCount = Number.isFinite(maxItems) ? maxItems : 100;
  const claimedEntries = await claimPendingB2DeleteEntries(force, claimCount);
  if (!claimedEntries.length) {
    const remainingRow = await db.prepare('SELECT COUNT(*)::int AS count FROM b2_delete_queue').get();
    return {
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      droppedCount: 0,
      remaining: remainingRow?.count || 0
    };
  }

  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let droppedCount = 0;

  for (const entry of claimedEntries) {
    if (processedCount >= maxItems) break;
    const objectKey = entry.object_key;
    processedCount += 1;

    const deleted = await tryDeleteB2KeyWithRetries(objectKey, {
      ...(entry.context_json || {}),
      queueAttempt: Number(entry.attempts || 0),
      queuedAt: entry.queued_at,
      reason: entry.reason
    });

    if (deleted) {
      successCount += 1;
      await db.prepare('DELETE FROM b2_delete_queue WHERE object_key = ? AND locked_by = ?').run(objectKey, queueWorkerId);
      continue;
    }

    failedCount += 1;

    if (Number(entry.attempts || 0) >= B2_DELETE_QUEUE_MAX_ATTEMPTS) {
      console.error(
        `[b2-delete] queue-drop key="${objectKey}" attempts=${entry.attempts} context=${JSON.stringify(entry.context_json || {})}`
      );
      droppedCount += 1;
      await db.prepare('DELETE FROM b2_delete_queue WHERE object_key = ? AND locked_by = ?').run(objectKey, queueWorkerId);
    } else {
      await db.prepare(`
        UPDATE b2_delete_queue
        SET next_attempt_at = CURRENT_TIMESTAMP + (? * INTERVAL '1 millisecond'),
            locked_until = NULL,
            locked_by = NULL
        WHERE object_key = ? AND locked_by = ?
      `).run(B2_DELETE_QUEUE_INTERVAL_MS, objectKey, queueWorkerId);
    }
  }

  const remainingRow = await db.prepare('SELECT COUNT(*)::int AS count FROM b2_delete_queue').get();

  return {
    processedCount,
    successCount,
    failedCount,
    droppedCount,
    remaining: remainingRow?.count || 0
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
