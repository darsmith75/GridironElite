const db = require('../database');
const { PROMPT_VERSION } = require('../ai-provider');
const { METRIC_TIP_CONFIG, METRIC_TIP_KEYS } = require('./constants');

let aiRateLimitCleanupCounter = 0;

function isAiGenerationEnabled() {
  return String(process.env.AI_FEATURE_ENABLED || 'false').toLowerCase() === 'true';
}

function getActiveAiProviderName() {
  return String(process.env.AI_PROVIDER || 'openai').toLowerCase();
}

function getActiveAiModelName() {
  const provider = getActiveAiProviderName();
  if (process.env.AI_MODEL_SUMMARY) return process.env.AI_MODEL_SUMMARY;
  if (provider === 'gemini' || provider === 'google') return 'gemini-2.5-flash';
  return 'gpt-4.1-mini';
}

function parseAiPlayerId(rawValue) {
  const id = parseInt(rawValue, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function aiRateLimitKey(actorUserId, playerUserId) {
  return `${actorUserId}:${playerUserId}`;
}

async function maybeCleanupAiRateLimits() {
  aiRateLimitCleanupCounter += 1;
  if (aiRateLimitCleanupCounter % 200 !== 0) return;

  try {
    await db.prepare('DELETE FROM distributed_rate_limits WHERE expires_at <= CURRENT_TIMESTAMP').run();
  } catch (_) {
    // Cleanup is best-effort only.
  }
}

async function isAiGenerationRateLimited(actorUserId, playerUserId) {
  const limitPerHour = parseInt(process.env.AI_GENERATE_MAX_PER_HOUR || '8', 10);
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();
  const expiresAt = new Date(windowStartMs + (windowMs * 2)).toISOString();
  const key = `ai-generate:${aiRateLimitKey(actorUserId, playerUserId)}`;

  const row = await db.prepare(`
    INSERT INTO distributed_rate_limits (bucket_key, window_start, request_count, expires_at, updated_at)
    VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET
      request_count = distributed_rate_limits.request_count + 1,
      updated_at = CURRENT_TIMESTAMP,
      expires_at = EXCLUDED.expires_at
    RETURNING request_count
  `).get(key, windowStart, expiresAt);

  await maybeCleanupAiRateLimits();
  return Number(row?.request_count || 0) > limitPerHour;
}

function mapSummaryRow(row) {
  if (!row) return null;
  return {
    summaryId: row.id,
    playerUserId: row.player_user_id,
    audience: row.generated_for_role,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    sourceHash: row.source_hash,
    summaryText: row.summary_text,
    strengths: Array.isArray(row.strengths_json) ? row.strengths_json : [],
    improvementAreas: Array.isArray(row.improvement_areas_json) ? row.improvement_areas_json : [],
    confidenceScore: row.confidence_score !== null ? Number(row.confidence_score) : null,
    safetyFlags: Array.isArray(row.safety_flags_json) ? row.safety_flags_json : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function logAiEvent({ eventType, actorUserId, playerUserId, summaryId = null, metadata = {} }) {
  try {
    await db.prepare(
      'INSERT INTO ai_events (event_type, actor_user_id, player_user_id, summary_id, metadata_json) VALUES (?, ?, ?, ?, ?::jsonb)'
    ).run(eventType, actorUserId || null, playerUserId || null, summaryId || null, JSON.stringify(metadata || {}));
  } catch (error) {
    console.error('Failed to write AI event:', error.message || error);
  }
}

async function canAccessPlayerSummary(req, playerUserId) {
  if (!req.session.userId) return false;
  if (req.session.role === 'admin' || req.session.role === 'agent' || req.session.role === 'coach') return true;
  return req.session.userId === playerUserId;
}

async function loadPlayerSummarySourceBundle(playerUserId) {
  const profile = await db.prepare(`
    SELECT user_id, full_name, high_school, graduation_year, position, height, weight,
      forty_yard_dash, bench_press, squat, vertical_jump, shuttle_5_10_5, l_drill,
      broad_jump, power_clean, single_leg_squat, catapult, metric_1080, gpa, achievement, bio
    FROM player_profiles
    WHERE user_id = ?
  `).get(playerUserId);

  if (!profile) return null;

  const [highlightVideos, additionalImages, verifiedMetricVideos, linkedVideos] = await Promise.all([
    db.prepare('SELECT COUNT(*)::int AS count FROM player_videos WHERE user_id = ?').get(playerUserId),
    db.prepare('SELECT COUNT(*)::int AS count FROM player_images WHERE user_id = ?').get(playerUserId),
    db.prepare('SELECT COUNT(*)::int AS count FROM player_metric_videos WHERE user_id = ? AND is_verified = true').get(playerUserId),
    db.prepare('SELECT COUNT(*)::int AS count FROM player_video_links WHERE user_id = ?').get(playerUserId)
  ]);

  return {
    full_name: profile.full_name || null,
    high_school: profile.high_school || null,
    graduation_year: profile.graduation_year || null,
    position: profile.position || null,
    height: profile.height || null,
    weight: profile.weight || null,
    forty_yard_dash: profile.forty_yard_dash || null,
    bench_press: profile.bench_press || null,
    squat: profile.squat || null,
    vertical_jump: profile.vertical_jump || null,
    shuttle_5_10_5: profile.shuttle_5_10_5 || null,
    l_drill: profile.l_drill || null,
    broad_jump: profile.broad_jump || null,
    power_clean: profile.power_clean || null,
    single_leg_squat: profile.single_leg_squat || null,
    catapult: profile.catapult || null,
    metric_1080: profile.metric_1080 || null,
    gpa: profile.gpa || null,
    achievement: profile.achievement || null,
    bio: profile.bio || null,
    highlight_video_count: highlightVideos?.count || 0,
    linked_video_count: linkedVideos?.count || 0,
    additional_image_count: additionalImages?.count || 0,
    verified_metric_video_count: verifiedMetricVideos?.count || 0
  };
}

async function getCachedAiSummary(playerUserId, audience, sourceHash) {
  const modelName = process.env.AI_MODEL_SUMMARY || 'gpt-4.1-mini';
  return db.prepare(`
    SELECT *
    FROM ai_player_summaries
    WHERE player_user_id = ?
      AND generated_for_role = ?
      AND source_hash = ?
      AND prompt_version = ?
      AND model_name = ?
      AND is_active = true
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(playerUserId, audience, sourceHash, PROMPT_VERSION, modelName);
}

async function saveAiSummary({ playerUserId, generatedForUserId, audience, sourceHash, modelName, summaryText, strengths, improvementAreas, confidenceScore, safetyFlags }) {
  await db.prepare(`
    UPDATE ai_player_summaries
    SET is_active = false, updated_at = CURRENT_TIMESTAMP
    WHERE player_user_id = ?
      AND generated_for_role = ?
      AND source_hash = ?
      AND prompt_version = ?
      AND model_name = ?
      AND is_active = true
  `).run(playerUserId, audience, sourceHash, PROMPT_VERSION, modelName);

  const insertResult = await db.prepare(`
    INSERT INTO ai_player_summaries (
      player_user_id,
      generated_for_user_id,
      generated_for_role,
      source_hash,
      model_name,
      prompt_version,
      summary_text,
      strengths_json,
      improvement_areas_json,
      confidence_score,
      safety_flags_json,
      is_active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?::jsonb, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    playerUserId,
    generatedForUserId || null,
    audience,
    sourceHash,
    modelName,
    PROMPT_VERSION,
    summaryText,
    JSON.stringify(strengths || []),
    JSON.stringify(improvementAreas || []),
    confidenceScore,
    JSON.stringify(safetyFlags || [])
  );

  return db.prepare('SELECT * FROM ai_player_summaries WHERE id = ?').get(insertResult.lastInsertRowid);
}

async function getMetricTipsMap() {
  const rows = await db.prepare('SELECT metric_key, tip_text FROM metric_pro_tips').all();
  const map = {};
  for (const item of METRIC_TIP_CONFIG) {
    map[item.key] = '';
  }
  rows.forEach(row => {
    if (row.metric_key in map) {
      map[row.metric_key] = row.tip_text || '';
    }
  });
  return map;
}

async function getMetricYoutubeUrlsMap() {
  const rows = await db.prepare('SELECT metric_key, youtube_url FROM metric_pro_tips').all();
  const map = {};
  for (const item of METRIC_TIP_CONFIG) {
    map[item.key] = '';
  }
  rows.forEach(row => {
    if (row.metric_key in map) {
      map[row.metric_key] = row.youtube_url || '';
    }
  });
  return map;
}

async function getPlayerMetricTipOverridesMap(playerUserId) {
  const rows = await db.prepare(
    'SELECT metric_key, tip_text FROM player_metric_pro_tips WHERE player_user_id = ?'
  ).all(playerUserId);

  const map = {};
  rows.forEach(row => {
    if (METRIC_TIP_KEYS.has(row.metric_key)) {
      map[row.metric_key] = row.tip_text || '';
    }
  });
  return map;
}

async function getMergedMetricTipsForPlayer(playerUserId) {
  const defaults = await getMetricTipsMap();
  const overrides = await getPlayerMetricTipOverridesMap(playerUserId);
  const merged = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const overrideText = String(overrides[key] || '').trim();
    if (overrideText) {
      merged[key] = overrideText;
    }
  }
  return { defaults, overrides, merged };
}

module.exports = {
  isAiGenerationEnabled,
  getActiveAiProviderName,
  getActiveAiModelName,
  parseAiPlayerId,
  aiRateLimitKey,
  isAiGenerationRateLimited,
  mapSummaryRow,
  logAiEvent,
  canAccessPlayerSummary,
  loadPlayerSummarySourceBundle,
  getCachedAiSummary,
  saveAiSummary,
  getMetricTipsMap,
  getMetricYoutubeUrlsMap,
  getPlayerMetricTipOverridesMap,
  getMergedMetricTipsForPlayer
};
