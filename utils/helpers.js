const db = require('../database');
const { AD_SLOT_CONFIG, AD_SLOT_KEYS } = require('./constants');

// ---------------------------------------------------------------------------
// In-memory rate-limit and cache state
// ---------------------------------------------------------------------------
const agentPlayersRateTracker = new Map();
const agentPlayersResponseCache = new Map();
const supportContactRateTracker = new Map();
const authLoginRateTracker = new Map();
const authForgotPasswordRateTracker = new Map();

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

function isAgentPlayersRateLimited(req) {
  const windowMs = parseInt(process.env.AGENT_PLAYERS_RATE_WINDOW_MS || '60000', 10);
  const authedLimit = parseInt(process.env.AGENT_PLAYERS_RATE_LIMIT_AUTH || '180', 10);
  const anonLimit = parseInt(process.env.AGENT_PLAYERS_RATE_LIMIT_ANON || '90', 10);
  const limit = req.session?.userId ? authedLimit : anonLimit;
  const now = Date.now();
  const key = getAgentPlayersRateKey(req);
  const entry = agentPlayersRateTracker.get(key) || { stamps: [] };
  entry.stamps = entry.stamps.filter(ts => now - ts < windowMs);
  if (entry.stamps.length >= limit) {
    agentPlayersRateTracker.set(key, entry);
    return true;
  }
  entry.stamps.push(now);
  agentPlayersRateTracker.set(key, entry);

  if (agentPlayersRateTracker.size > 2500) {
    const cutoff = now - (windowMs * 2);
    for (const [trackerKey, trackerEntry] of agentPlayersRateTracker.entries()) {
      if (!Array.isArray(trackerEntry?.stamps) || trackerEntry.stamps.every(ts => ts < cutoff)) {
        agentPlayersRateTracker.delete(trackerKey);
      }
    }
  }

  return false;
}

function buildAgentPlayersCacheKey(req, normalized) {
  return JSON.stringify({
    actor: req.session?.userId || null,
    role: req.session?.role || null,
    filters: normalized
  });
}

function getCachedAgentPlayers(cacheKey) {
  const ttlMs = parseInt(process.env.AGENT_PLAYERS_CACHE_TTL_MS || '7000', 10);
  if (ttlMs <= 0) return null;
  const entry = agentPlayersResponseCache.get(cacheKey);
  if (!entry) return null;
  if ((Date.now() - entry.cachedAt) > ttlMs) {
    agentPlayersResponseCache.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function setCachedAgentPlayers(cacheKey, payload) {
  const ttlMs = parseInt(process.env.AGENT_PLAYERS_CACHE_TTL_MS || '7000', 10);
  if (ttlMs <= 0) return;
  agentPlayersResponseCache.set(cacheKey, {
    cachedAt: Date.now(),
    payload
  });

  if (agentPlayersResponseCache.size > 400) {
    const cutoff = Date.now() - (ttlMs * 2);
    for (const [key, value] of agentPlayersResponseCache.entries()) {
      if ((value?.cachedAt || 0) < cutoff) {
        agentPlayersResponseCache.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Support-contact rate-limiter
// ---------------------------------------------------------------------------

function supportContactRateKey(req) {
  const ip = getClientIp(req) || 'unknown';
  return `support:${ip}`;
}

function isSupportContactRateLimited(req) {
  const windowMs = parseInt(process.env.SUPPORT_CONTACT_RATE_WINDOW_MS || '600000', 10);
  const maxPerWindow = parseInt(process.env.SUPPORT_CONTACT_RATE_LIMIT || '5', 10);
  const now = Date.now();
  const key = supportContactRateKey(req);
  const entry = supportContactRateTracker.get(key) || { stamps: [] };
  entry.stamps = entry.stamps.filter(ts => now - ts < windowMs);
  if (entry.stamps.length >= maxPerWindow) {
    supportContactRateTracker.set(key, entry);
    return true;
  }
  entry.stamps.push(now);
  supportContactRateTracker.set(key, entry);

  if (supportContactRateTracker.size > 2000) {
    const cutoff = now - (windowMs * 2);
    for (const [trackerKey, trackerEntry] of supportContactRateTracker.entries()) {
      if (!Array.isArray(trackerEntry?.stamps) || trackerEntry.stamps.every(ts => ts < cutoff)) {
        supportContactRateTracker.delete(trackerKey);
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Auth endpoint rate-limiters
// ---------------------------------------------------------------------------

function authLoginRateKey(req) {
  const ip = getClientIp(req) || 'unknown';
  return `login:${ip}`;
}

function isLoginRateLimited(req) {
  const windowMs = parseInt(process.env.LOGIN_RATE_WINDOW_MS || '900000', 10);
  const maxPerWindow = parseInt(process.env.LOGIN_RATE_LIMIT || '12', 10);
  const now = Date.now();
  const key = authLoginRateKey(req);
  const entry = authLoginRateTracker.get(key) || { stamps: [] };
  entry.stamps = entry.stamps.filter(ts => now - ts < windowMs);
  if (entry.stamps.length >= maxPerWindow) {
    authLoginRateTracker.set(key, entry);
    return true;
  }
  entry.stamps.push(now);
  authLoginRateTracker.set(key, entry);

  if (authLoginRateTracker.size > 2500) {
    const cutoff = now - (windowMs * 2);
    for (const [trackerKey, trackerEntry] of authLoginRateTracker.entries()) {
      if (!Array.isArray(trackerEntry?.stamps) || trackerEntry.stamps.every(ts => ts < cutoff)) {
        authLoginRateTracker.delete(trackerKey);
      }
    }
  }

  return false;
}

function authForgotPasswordRateKey(req) {
  const ip = getClientIp(req) || 'unknown';
  return `forgot:${ip}`;
}

function isForgotPasswordRateLimited(req) {
  const windowMs = parseInt(process.env.FORGOT_PASSWORD_RATE_WINDOW_MS || '900000', 10);
  const maxPerWindow = parseInt(process.env.FORGOT_PASSWORD_RATE_LIMIT || '6', 10);
  const now = Date.now();
  const key = authForgotPasswordRateKey(req);
  const entry = authForgotPasswordRateTracker.get(key) || { stamps: [] };
  entry.stamps = entry.stamps.filter(ts => now - ts < windowMs);
  if (entry.stamps.length >= maxPerWindow) {
    authForgotPasswordRateTracker.set(key, entry);
    return true;
  }
  entry.stamps.push(now);
  authForgotPasswordRateTracker.set(key, entry);

  if (authForgotPasswordRateTracker.size > 2500) {
    const cutoff = now - (windowMs * 2);
    for (const [trackerKey, trackerEntry] of authForgotPasswordRateTracker.entries()) {
      if (!Array.isArray(trackerEntry?.stamps) || trackerEntry.stamps.every(ts => ts < cutoff)) {
        authForgotPasswordRateTracker.delete(trackerKey);
      }
    }
  }

  return false;
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
