const db = require('../database');
const { AD_SLOT_CONFIG, AD_SLOT_KEYS } = require('./constants');

// ---------------------------------------------------------------------------
// Distributed rate-limit and cache state (PostgreSQL-backed)
// ---------------------------------------------------------------------------
const agentPlayersRateTracker = new Map();
const agentPlayersResponseCache = new Map();
const supportContactRateTracker = new Map();
const authLoginRateTracker = new Map();
const authForgotPasswordRateTracker = new Map();
let distributedStateCleanupCounter = 0;

async function maybeCleanupDistributedState() {
  distributedStateCleanupCounter += 1;
  if (distributedStateCleanupCounter % 200 !== 0) return;

  try {
    await Promise.all([
      db.prepare('DELETE FROM distributed_rate_limits WHERE expires_at <= CURRENT_TIMESTAMP').run(),
      db.prepare('DELETE FROM distributed_response_cache WHERE expires_at <= CURRENT_TIMESTAMP').run()
    ]);
  } catch (_) {
    // Best effort cleanup only.
  }
}

async function consumeDistributedRateLimit(bucketKey, windowMs, maxPerWindow) {
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();
  const expiresAt = new Date(windowStartMs + (windowMs * 2)).toISOString();

  const row = await db.prepare(`
    INSERT INTO distributed_rate_limits (bucket_key, window_start, request_count, expires_at, updated_at)
    VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET
      request_count = distributed_rate_limits.request_count + 1,
      updated_at = CURRENT_TIMESTAMP,
      expires_at = EXCLUDED.expires_at
    RETURNING request_count
  `).get(bucketKey, windowStart, expiresAt);

  await maybeCleanupDistributedState();
  return Number(row?.request_count || 0) > maxPerWindow;
}

// ---------------------------------------------------------------------------
// General utilities
// ---------------------------------------------------------------------------

function parseQueryNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = forwarded ? String(forwarded).split(',')[0].trim() : (req.ip || req.socket?.remoteAddress || '');
  return String(rawIp || '').replace(/^::ffff:/, '').trim();
}

function getPublicAppUrl(req) {
  const configured = String(process.env.APP_URL || process.env.PUBLIC_BASE_URL || '').trim();
  const configuredSanitized = configured.replace(/\/$/, '');
  const isConfiguredLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(configuredSanitized);

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req?.get?.('host') || req?.headers?.host;
  const protocol = forwardedProto || req?.protocol || 'https';

  if (configuredSanitized && !isConfiguredLocal) {
    return configuredSanitized;
  }

  if (host) {
    return `${protocol}://${host}`.replace(/\/$/, '');
  }

  if (configuredSanitized) {
    return configuredSanitized;
  }

  return 'https://gridironathletes.com';
}

function normalizeHexColor(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : null;
}

function isLikelyValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

// ---------------------------------------------------------------------------
// Agent players rate-limiter + response cache
// ---------------------------------------------------------------------------

function getAgentPlayersRateKey(req) {
  if (req.session?.userId) return `user:${req.session.userId}`;
  return `ip:${getClientIp(req) || 'unknown'}`;
}

async function isAgentPlayersRateLimited(req) {
  const windowMs = parseInt(process.env.AGENT_PLAYERS_RATE_WINDOW_MS || '60000', 10);
  const authedLimit = parseInt(process.env.AGENT_PLAYERS_RATE_LIMIT_AUTH || '180', 10);
  const anonLimit = parseInt(process.env.AGENT_PLAYERS_RATE_LIMIT_ANON || '90', 10);
  const limit = req.session?.userId ? authedLimit : anonLimit;
  const key = getAgentPlayersRateKey(req);
  return consumeDistributedRateLimit(`agent-players:${key}`, windowMs, limit);
}

function buildAgentPlayersCacheKey(req, normalized) {
  return JSON.stringify({
    actor: req.session?.userId || null,
    role: req.session?.role || null,
    filters: normalized
  });
}

async function getCachedAgentPlayers(cacheKey) {
  const ttlMs = parseInt(process.env.AGENT_PLAYERS_CACHE_TTL_MS || '7000', 10);
  if (ttlMs <= 0) return null;

  const row = await db.prepare(`
    SELECT payload_json
    FROM distributed_response_cache
    WHERE cache_key = ?
      AND expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `).get(cacheKey);

  return row?.payload_json || null;
}

async function setCachedAgentPlayers(cacheKey, payload) {
  const ttlMs = parseInt(process.env.AGENT_PLAYERS_CACHE_TTL_MS || '7000', 10);
  if (ttlMs <= 0) return;

  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await db.prepare(`
    INSERT INTO distributed_response_cache (cache_key, payload_json, expires_at, updated_at)
    VALUES (?, ?::jsonb, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (cache_key)
    DO UPDATE SET
      payload_json = EXCLUDED.payload_json,
      expires_at = EXCLUDED.expires_at,
      updated_at = CURRENT_TIMESTAMP
  `).run(cacheKey, JSON.stringify(payload), expiresAt);

  await maybeCleanupDistributedState();
}

// ---------------------------------------------------------------------------
// Support-contact rate-limiter
// ---------------------------------------------------------------------------

function supportContactRateKey(req) {
  const ip = getClientIp(req) || 'unknown';
  return `support:${ip}`;
}

async function isSupportContactRateLimited(req) {
  const windowMs = parseInt(process.env.SUPPORT_CONTACT_RATE_WINDOW_MS || '600000', 10);
  const maxPerWindow = parseInt(process.env.SUPPORT_CONTACT_RATE_LIMIT || '5', 10);
  const key = supportContactRateKey(req);
  return consumeDistributedRateLimit(`support-contact:${key}`, windowMs, maxPerWindow);
}

// ---------------------------------------------------------------------------
// Auth endpoint rate-limiters
// ---------------------------------------------------------------------------

function authLoginRateKey(req) {
  const ip = getClientIp(req) || 'unknown';
  return `login:${ip}`;
}

async function isLoginRateLimited(req) {
  const windowMs = parseInt(process.env.LOGIN_RATE_WINDOW_MS || '900000', 10);
  const maxPerWindow = parseInt(process.env.LOGIN_RATE_LIMIT || '12', 10);
  const key = authLoginRateKey(req);
  return consumeDistributedRateLimit(`login:${key}`, windowMs, maxPerWindow);
}

function authForgotPasswordRateKey(req) {
  const ip = getClientIp(req) || 'unknown';
  return `forgot:${ip}`;
}

async function isForgotPasswordRateLimited(req) {
  const windowMs = parseInt(process.env.FORGOT_PASSWORD_RATE_WINDOW_MS || '900000', 10);
  const maxPerWindow = parseInt(process.env.FORGOT_PASSWORD_RATE_LIMIT || '6', 10);
  const key = authForgotPasswordRateKey(req);
  return consumeDistributedRateLimit(`forgot-password:${key}`, windowMs, maxPerWindow);
}

// ---------------------------------------------------------------------------
// DB-backed utilities
// ---------------------------------------------------------------------------

async function logSiteTrafficEvent({
  req,
  eventType,
  path = null,
  method = null,
  userId = null,
  role = null,
  metadata = {}
}) {
  try {
    await db.prepare(`
      INSERT INTO site_traffic_events (
        event_type, path, method, user_id, role, ip_address, user_agent, referer, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
    `).run(
      eventType,
      path || req?.path || null,
      method || req?.method || null,
      userId,
      role,
      req ? getClientIp(req) : null,
      req?.headers?.['user-agent'] || null,
      req?.headers?.referer || null,
      JSON.stringify(metadata || {})
    );
  } catch (error) {
    console.error('Site traffic log error:', error.message || error);
  }
}

async function getAdSlotsMap() {
  const rows = await db.prepare('SELECT slot_key, enabled, content_html, updated_at FROM site_ad_slots').all();
  const map = {};

  for (const config of AD_SLOT_CONFIG) {
    map[config.key] = { enabled: false, contentHtml: '', updatedAt: null };
  }

  rows.forEach(row => {
    if (!AD_SLOT_KEYS.has(row.slot_key)) return;
    map[row.slot_key] = {
      enabled: !!row.enabled,
      contentHtml: row.content_html || '',
      updatedAt: row.updated_at || null
    };
  });

  return map;
}

module.exports = {
  agentPlayersRateTracker,
  agentPlayersResponseCache,
  supportContactRateTracker,
  authLoginRateTracker,
  authForgotPasswordRateTracker,
  parseQueryNumber,
  getClientIp,
  getPublicAppUrl,
  normalizeHexColor,
  isLikelyValidEmail,
  getAgentPlayersRateKey,
  isAgentPlayersRateLimited,
  buildAgentPlayersCacheKey,
  getCachedAgentPlayers,
  setCachedAgentPlayers,
  supportContactRateKey,
  isSupportContactRateLimited,
  authLoginRateKey,
  isLoginRateLimited,
  authForgotPasswordRateKey,
  isForgotPasswordRateLimited,
  logSiteTrafficEvent,
  getAdSlotsMap
};
