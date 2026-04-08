// Some transitive dependencies emit DEP0005 on newer Node runtimes.
// Filter only that code so real warnings still surface in logs.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function patchedEmitWarning(warning, ...args) {
  const codeFromWarning = warning && typeof warning === 'object' ? warning.code : undefined;
  const codeFromArgs = typeof args[1] === 'string' ? args[1] : undefined;
  if (codeFromWarning === 'DEP0005' || codeFromArgs === 'DEP0005') {
    return;
  }
  return originalEmitWarning.call(process, warning, ...args);
};

try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const db = require('./database');
const { b2Enabled, uploadToB2, deleteFromB2, deleteFromB2Prefix, getB2Url, checkB2Health } = require('./backblaze');
const { PROMPT_VERSION, normalizeAudience, buildSourceHash, generateScoutingSummary, generateBioAssistance } = require('./ai-provider');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

const METRIC_VIDEO_CONFIG = [
  { key: 'forty_yard_dash', fieldName: 'metricVideoFortyYardDash', verifiedField: 'metricVerifiedFortyYardDash', verifiedByField: 'metricVerifiedByFortyYardDash' },
  { key: 'vertical_jump', fieldName: 'metricVideoVerticalJump', verifiedField: 'metricVerifiedVerticalJump', verifiedByField: 'metricVerifiedByVerticalJump' },
  { key: 'bench_press', fieldName: 'metricVideoBenchPress', verifiedField: 'metricVerifiedBenchPress', verifiedByField: 'metricVerifiedByBenchPress' },
  { key: 'squat', fieldName: 'metricVideoSquat', verifiedField: 'metricVerifiedSquat', verifiedByField: 'metricVerifiedBySquat' },
  { key: 'shuttle_5_10_5', fieldName: 'metricVideoShuttle5105', verifiedField: 'metricVerifiedShuttle5105', verifiedByField: 'metricVerifiedByShuttle5105' },
  { key: 'l_drill', fieldName: 'metricVideoLDrill', verifiedField: 'metricVerifiedLDrill', verifiedByField: 'metricVerifiedByLDrill' },
  { key: 'broad_jump', fieldName: 'metricVideoBroadJump', verifiedField: 'metricVerifiedBroadJump', verifiedByField: 'metricVerifiedByBroadJump' },
  { key: 'power_clean', fieldName: 'metricVideoPowerClean', verifiedField: 'metricVerifiedPowerClean', verifiedByField: 'metricVerifiedByPowerClean' },
  { key: 'single_leg_squat', fieldName: 'metricVideoSingleLegSquat', verifiedField: 'metricVerifiedSingleLegSquat', verifiedByField: 'metricVerifiedBySingleLegSquat' }
];

const METRIC_TIP_CONFIG = [
  { key: 'forty_yard_dash', label: '40-Yard Dash' },
  { key: 'vertical_jump', label: 'Vertical Jump' },
  { key: 'bench_press', label: 'Bench Press' },
  { key: 'squat', label: 'Squat' },
  { key: 'shuttle_5_10_5', label: '5-10-5 Shuttle' },
  { key: 'l_drill', label: 'L-Drill' },
  { key: 'broad_jump', label: 'Broad Jump' },
  { key: 'power_clean', label: 'Power Clean' },
  { key: 'single_leg_squat', label: 'Single Leg Squat' }
];
const METRIC_TIP_KEYS = new Set(METRIC_TIP_CONFIG.map(item => item.key));
const AD_SLOT_CONFIG = [
  { key: 'agent_dashboard_leaderboard', label: 'Agent Dashboard Top Leaderboard (728x90)' },
  { key: 'player_detail_top_leaderboard', label: 'Player Detail Top Leaderboard (728x90)' },
  { key: 'player_detail_inline', label: 'Player Detail Inline Banner (468x120)' }
];
const AD_SLOT_KEYS = new Set(AD_SLOT_CONFIG.map(item => item.key));
const aiGenerateRateTracker = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = forwarded ? String(forwarded).split(',')[0].trim() : (req.ip || req.socket?.remoteAddress || '');
  return String(rawIp || '').replace(/^::ffff:/, '').trim();
}

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

function isAiGenerationRateLimited(actorUserId, playerUserId) {
  const limitPerHour = parseInt(process.env.AI_GENERATE_MAX_PER_HOUR || '8', 10);
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const key = aiRateLimitKey(actorUserId, playerUserId);
  const entry = aiGenerateRateTracker.get(key) || { stamps: [] };
  entry.stamps = entry.stamps.filter(ts => now - ts < windowMs);
  if (entry.stamps.length >= limitPerHour) {
    aiGenerateRateTracker.set(key, entry);
    return true;
  }
  entry.stamps.push(now);
  aiGenerateRateTracker.set(key, entry);
  return false;
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
  if (req.session.role === 'admin' || req.session.role === 'agent') return true;
  return req.session.userId === playerUserId;
}

async function loadPlayerSummarySourceBundle(playerUserId) {
  const profile = await db.prepare(`
    SELECT user_id, full_name, high_school, graduation_year, position, height, weight,
      forty_yard_dash, bench_press, squat, vertical_jump, shuttle_5_10_5, l_drill,
      broad_jump, power_clean, single_leg_squat, gpa, achievement, bio
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

const PROFILE_UPLOAD_FIELD_MAX_COUNTS = {
  profilePicture: 1,
  cardPhoto: 1,
  reportCardImage: 1,
  highlightVideos: 5,
  additionalImages: 10,
  ...Object.fromEntries(METRIC_VIDEO_CONFIG.map(config => [config.fieldName, 1]))
};

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

// Needed for correct secure-cookie handling behind IIS/reverse proxies.
app.set('trust proxy', 1);

// Create uploads directory
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync(path.join('images', 'collegelogos'))) fs.mkdirSync(path.join('images', 'collegelogos'), { recursive: true });

// Migrate existing flat uploads into per-user folders
async function migrateUploads() {
  try {
    // Migrate profile_picture, card_photo, and report_card_image
    const profiles = await db.prepare('SELECT user_id, profile_picture, card_photo, report_card_image FROM player_profiles').all();
    for (const p of profiles) {
      for (const col of ['profile_picture', 'card_photo', 'report_card_image']) {
        const filename = p[col];
        if (filename && !filename.includes('/')) {
          const src = path.join('uploads', filename);
          const userDir = path.join('uploads', String(p.user_id));
          const dest = path.join(userDir, filename);
          if (fs.existsSync(src)) {
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
            fs.renameSync(src, dest);
          }
          await db.prepare(`UPDATE player_profiles SET ${col} = ? WHERE user_id = ?`)
            .run(p.user_id + '/' + filename, p.user_id);
        }
      }
    }
    // Migrate player_videos
    const videos = await db.prepare('SELECT id, user_id, filename FROM player_videos').all();
    for (const v of videos) {
      if (!v.filename.includes('/')) {
        const src = path.join('uploads', v.filename);
        const userDir = path.join('uploads', String(v.user_id));
        const dest = path.join(userDir, v.filename);
        if (fs.existsSync(src)) {
          if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
          fs.renameSync(src, dest);
        }
        await db.prepare('UPDATE player_videos SET filename = ? WHERE id = ?')
          .run(v.user_id + '/' + v.filename, v.id);
      }
    }
    // Migrate player_images
    const images = await db.prepare('SELECT id, user_id, filename FROM player_images').all();
    for (const i of images) {
      if (!i.filename.includes('/')) {
        const src = path.join('uploads', i.filename);
        const userDir = path.join('uploads', String(i.user_id));
        const dest = path.join(userDir, i.filename);
        if (fs.existsSync(src)) {
          if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
          fs.renameSync(src, dest);
        }
        await db.prepare('UPDATE player_images SET filename = ? WHERE id = ?')
          .run(i.user_id + '/' + i.filename, i.id);
      }
    }
    // Migrate player_metric_videos
    const metricVideos = await db.prepare('SELECT id, user_id, video_filename FROM player_metric_videos').all();
    for (const mv of metricVideos) {
      if (mv.video_filename && !mv.video_filename.includes('/')) {
        const src = path.join('uploads', mv.video_filename);
        const userDir = path.join('uploads', String(mv.user_id));
        const dest = path.join(userDir, mv.video_filename);
        if (fs.existsSync(src)) {
          if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
          fs.renameSync(src, dest);
        }
        await db.prepare('UPDATE player_metric_videos SET video_filename = ? WHERE id = ?')
          .run(mv.user_id + '/' + mv.video_filename, mv.id);
      }
    }
    console.log('Upload migration check complete');
  } catch (err) {
    console.error('Upload migration error:', err.message);
  }
}

// Allowed file types for uploads
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const MAX_HIGHLIGHT_VIDEO_MB = parseInt(process.env.MAX_HIGHLIGHT_VIDEO_MB || '35', 10);
const MAX_HIGHLIGHT_VIDEO_BYTES = MAX_HIGHLIGHT_VIDEO_MB * 1024 * 1024;
const VIDEO_OPTIMIZATION_MODE = String(process.env.VIDEO_OPTIMIZATION_MODE || 'off').toLowerCase();

const IMAGE_PRESETS = {
  reportCardImage: { maxWidth: 2200, quality: 88 },
  cardPhoto: { maxWidth: 1800, quality: 82 },
  profilePicture: { maxWidth: 1600, quality: 80 },
  additionalImages: { maxWidth: 1800, quality: 78 }
};

const VIDEO_PRESETS = {
  highlightVideos: { maxWidth: 960, crf: 27, preset: 'veryfast', audioBitrate: '128k' }
};

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function logUploadEvent(level, message, meta = {}) {
  const payload = {
    at: new Date().toISOString(),
    ...meta
  };
  const line = `[upload] ${message} ${JSON.stringify(payload)}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function getImagePreset(fieldName) {
  return IMAGE_PRESETS[fieldName] || { maxWidth: 1600, quality: 80 };
}

function getVideoPreset(fieldName) {
  return VIDEO_PRESETS[fieldName] || { maxWidth: 1280, crf: 27, preset: 'veryfast', audioBitrate: '128k' };
}

function shouldOptimizeVideoField(fieldName) {
  if (VIDEO_OPTIMIZATION_MODE === 'all') return true;
  if (VIDEO_OPTIMIZATION_MODE === 'highlight-only') return fieldName === 'highlightVideos';
  return false;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('ffmpeg binary not found'));
    }

    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    let settled = false;
    const timeoutMs = parseInt(process.env.FFMPEG_TIMEOUT_MS || '180000', 10);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      reject(new Error('ffmpeg timed out during video optimization'));
    }, timeoutMs);

    proc.stderr.on('data', chunk => {
      stderr += String(chunk || '');
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error('ffmpeg exited with code ' + code + (stderr ? `: ${stderr.slice(-500)}` : '')));
    });
  });
}

async function optimizeImageFile(file) {
  if ((!file?.buffer && !file?.path) || file.mimetype === 'image/gif') {
    return {
      filePath: file.path,
      buffer: file.buffer,
      extension: path.extname(file.originalname).toLowerCase() || '.bin',
      mimeType: file.mimetype
    };
  }

  const preset = getImagePreset(file.fieldname);
  const source = file.path || file.buffer;
  const optimizedBuffer = await sharp(source)
    .rotate()
    .resize({ width: preset.maxWidth, withoutEnlargement: true })
    .webp({ quality: preset.quality })
    .toBuffer();

  const tempDir = path.join(os.tmpdir(), 'gridiron-elite-media-opt');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`);
  fs.writeFileSync(tempPath, optimizedBuffer);

  return {
    filePath: tempPath,
    buffer: optimizedBuffer,
    extension: '.webp',
    mimeType: 'image/webp'
  };
}

async function optimizeVideoFile(file) {
  if ((!file?.buffer && !file?.path)) {
    return {
      filePath: file.path,
      buffer: file.buffer,
      extension: path.extname(file.originalname).toLowerCase() || '.bin',
      mimeType: file.mimetype
    };
  }

  // ffmpeg transcoding can exceed memory limits on smaller instances.
  // Keep original video unless explicitly enabled via VIDEO_OPTIMIZATION_MODE.
  if (!shouldOptimizeVideoField(file.fieldname)) {
    return {
      filePath: file.path,
      buffer: file.buffer,
      extension: path.extname(file.originalname).toLowerCase() || '.bin',
      mimeType: file.mimetype
    };
  }

  const preset = getVideoPreset(file.fieldname);
  const tempDir = path.join(os.tmpdir(), 'gridiron-elite-media-opt');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const sourceExt = path.extname(file.originalname).toLowerCase() || '.mp4';
  const tempBase = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const inputPath = file.path || path.join(tempDir, `${tempBase}${sourceExt}`);
  const outputPath = path.join(tempDir, `${tempBase}-optimized.mp4`);
  const createdInputTemp = !file.path;

  try {
    if (createdInputTemp) {
      fs.writeFileSync(inputPath, file.buffer);
    }

    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-vf', `scale=min(${preset.maxWidth}\\,iw):-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-c:v', 'libx264',
      '-preset', String(preset.preset),
      '-crf', String(preset.crf),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', String(preset.audioBitrate),
      outputPath
    ]);

    return {
      filePath: outputPath,
      extension: '.mp4',
      mimeType: 'video/mp4'
    };
  } finally {
    if (createdInputTemp && fs.existsSync(inputPath)) {
      try { fs.unlinkSync(inputPath); } catch (_) {}
    }
  }
}

// Multer configuration for file uploads
// Use temp disk storage to avoid high RAM usage for larger media uploads.
const incomingUploadDir = path.join(os.tmpdir(), 'gridiron-elite-incoming');
if (!fs.existsSync(incomingUploadDir)) fs.mkdirSync(incomingUploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, incomingUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images and videos are allowed.'), false);
  }
};
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter });

function playerProfileUploadMiddleware(req, res, next) {
  upload.any()(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: `Unexpected upload field: ${err.field || 'unknown'}`,
        expectedFields: Object.keys(PROFILE_UPLOAD_FIELD_MAX_COUNTS)
      });
    }

    return next(err);
  });
}

// Process uploaded files: assign a safe filename, then upload to B2 or save to local disk.
// Must be awaited at the start of any route handler that receives user file uploads.
async function processUploadedFiles(userId, reqFiles) {
  if (!reqFiles) return;
  const allFiles = Object.values(reqFiles).flat();
  for (const file of allFiles) {
    const startedAt = Date.now();
    const originalTempPath = file.path;
    let processed = {
      filePath: file.path,
      buffer: file.buffer,
      extension: path.extname(file.originalname).toLowerCase() || '.bin',
      mimeType: file.mimetype
    };

    logUploadEvent('info', 'start', {
      userId,
      field: file.fieldname,
      originalName: file.originalname,
      sizeBytes: file.size,
      sizeMb: formatMb(file.size),
      mimeType: file.mimetype
    });

    try {
      try {
        if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
          processed = await optimizeImageFile(file);
        } else if (ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
          processed = await optimizeVideoFile(file);
        }
      } catch (error) {
        console.warn('Media optimization failed, using original upload:', error.message);
      }

      const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + processed.extension;
      file.filename = safeName; // keep existing field-name references working
      file.mimetype = processed.mimeType;
      if (b2Enabled) {
        const uploadBody = processed.filePath
          ? fs.createReadStream(processed.filePath)
          : processed.buffer;
        await uploadToB2('uploads/' + userId + '/' + safeName, uploadBody, processed.mimeType);
      } else {
        const userDir = path.join('uploads', String(userId));
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
        const destination = path.join(userDir, safeName);
        if (processed.filePath) {
          fs.copyFileSync(processed.filePath, destination);
        } else {
          fs.writeFileSync(destination, processed.buffer);
        }
      }

      logUploadEvent('info', 'complete', {
        userId,
        field: file.fieldname,
        originalName: file.originalname,
        storedName: file.filename,
        outputType: file.mimetype,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      logUploadEvent('error', 'failed', {
        userId,
        field: file.fieldname,
        originalName: file.originalname,
        durationMs: Date.now() - startedAt,
        error: error.message
      });
      throw error;
    } finally {
      if (processed.filePath && processed.filePath !== originalTempPath && fs.existsSync(processed.filePath)) {
        try { fs.unlinkSync(processed.filePath); } catch (_) {}
      }
      if (originalTempPath && fs.existsSync(originalTempPath)) {
        try { fs.unlinkSync(originalTempPath); } catch (_) {}
      }
    }
  }
}

// Multer configuration for college logos
const collegeLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join('images', 'collegelogos')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, safeName);
  }
});
const collegeLogoUpload = multer({ storage: collegeLogoStorage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter });

// Helper: resolve a safe file path within uploads directory
function safeUploadPath(filename) {
  // filename may be "userId/file.ext" or legacy "file.ext"
  const normalized = path.normalize(filename).replace(/^\.[\/\\]+/, '');
  const resolved = path.resolve('uploads', normalized);
  const uploadsDir = path.resolve('uploads');
  if (!resolved.startsWith(uploadsDir + path.sep)) {
    return null;
  }
  return resolved;
}

function normalizeUploadFilename(filename) {
  if (!filename) return '';
  const decoded = decodeURIComponent(String(filename));
  const trimmed = decoded.replace(/^\/+/, '');
  const withoutUploadsPrefix = trimmed.startsWith('uploads/') ? trimmed.slice('uploads/'.length) : trimmed;
  return withoutUploadsPrefix;
}

function normalizeOptionalInteger(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeOptionalFloat(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const parsed = parseFloat(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

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

async function deleteUploadFile(filename) {
  if (!filename) return false;
  const normalizedFilename = normalizeUploadFilename(filename);

  let deletedInB2 = false;
  // Delete from Backblaze B2 using normalized and legacy key shapes.
  if (b2Enabled) {
    const candidateKeys = buildB2DeleteCandidateKeys(normalizedFilename);
    for (const objectKey of candidateKeys) {
      const deleted = await tryDeleteB2KeyWithRetries(objectKey, {
        filename: normalizedFilename,
        source: 'deleteUploadFile'
      });
      if (deleted) {
        deletedInB2 = true;
      } else {
        enqueuePendingB2Delete(objectKey, { filename: normalizedFilename, source: 'deleteUploadFile' }, 'immediate-delete-failed');
      }
    }
  }

  // Also remove local copy for legacy files that pre-date B2 migration
  const safePath = safeUploadPath(normalizedFilename);
  if (safePath && fs.existsSync(safePath)) {
    try { fs.unlinkSync(safePath); } catch (_) {}
    return true;
  }

  // If B2 is enabled and no key existed/deleted, signal failure so route can inform UI.
  if (b2Enabled) return deletedInB2;
  return false;
}

async function replacePlayerProfileFile(userId, columnName, newFilename) {
  const current = await db.prepare(`SELECT ${columnName} AS filename FROM player_profiles WHERE user_id = ?`).get(userId);

  if (current?.filename && current.filename !== newFilename) {
    await deleteUploadFile(current.filename);
  }

  await db.prepare(`UPDATE player_profiles SET ${columnName} = ? WHERE user_id = ?`).run(newFilename, userId);
}

async function clearPlayerProfileFile(userId, columnName) {
  const current = await db.prepare(`SELECT ${columnName} AS filename FROM player_profiles WHERE user_id = ?`).get(userId);

  if (current?.filename) {
    await deleteUploadFile(current.filename);
    await db.prepare(`UPDATE player_profiles SET ${columnName} = NULL WHERE user_id = ?`).run(userId);
  }
}

async function replaceUserFile(userId, columnName, newFilename) {
  const current = await db.prepare(`SELECT ${columnName} AS filename FROM users WHERE id = ?`).get(userId);

  if (current?.filename && current.filename !== newFilename) {
    await deleteUploadFile(current.filename);
  }

  await db.prepare(`UPDATE users SET ${columnName} = ? WHERE id = ?`).run(newFilename, userId);
}

async function deleteOwnedPlayerMedia(tableName, playerId, filename) {
  const normalizedFilename = normalizeUploadFilename(filename);
  const media = await db.prepare(`SELECT id, filename FROM ${tableName} WHERE user_id = ? AND (filename = ? OR filename = ? OR filename = ?)`)
    .get(playerId, filename, normalizedFilename, normalizedFilename.replace(/^uploads\//, ''));
  if (!media) {
    return false;
  }

  const fileDeleted = await deleteUploadFile(media.filename);
  if (b2Enabled && !fileDeleted) {
    return false;
  }

  await db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(media.id);
  return true;
}

async function deleteOwnedPlayerMetricVideo(playerId, metricKey) {
  const media = await db.prepare(
    'SELECT id, video_filename FROM player_metric_videos WHERE user_id = ? AND metric_key = ?'
  ).get(playerId, metricKey);
  if (!media?.video_filename) {
    return false;
  }

  const fileDeleted = await deleteUploadFile(media.video_filename);
  if (b2Enabled && !fileDeleted) {
    return false;
  }

  await db.prepare('DELETE FROM player_metric_videos WHERE id = ?').run(media.id);
  return true;
}

// Guard against accidental double-submit of the same profile upload payload.
const recentProfileUploadSignatures = new Map();
function buildProfileUploadSignature(userId, reqBody, reqFiles) {
  const fileEntries = Object.entries(reqFiles || {})
    .flatMap(([field, files]) => (files || []).map(f => `${field}:${f.originalname}:${f.size}:${f.mimetype}`))
    .sort();

  const bodyFields = [
    reqBody.fullName || '',
    reqBody.highSchool || '',
    reqBody.position || '',
    reqBody.graduationYear || '',
    reqBody.gpa || ''
  ].join('|');

  return `${userId}|${bodyFields}|${fileEntries.join('|')}`;
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Root path: show agent-dashboard (public landing page)
app.get('/', (req, res) => {
  res.redirect('/agent-dashboard.html');
});

// Explicit login page route
app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.use(express.static('public'));

// User uploads: redirect to Backblaze B2 when enabled; otherwise serve from local disk.
if (b2Enabled) {
  app.use('/uploads', (req, res) => {
    // req.path is e.g. "/5/abc.jpg" – prepend "uploads" to form the B2 object key
    const key = 'uploads' + req.path;
    res.redirect(302, getB2Url(key));
  });
} else {
  app.use('/uploads', express.static('uploads'));
}
app.use('/images', express.static('images'));
app.use('/logos', express.static('logos'));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'gridiron-elite',
    uptimeSec: Math.round(process.uptime()),
    ai: {
      enabled: isAiGenerationEnabled(),
      provider: getActiveAiProviderName(),
      model: getActiveAiModelName()
    }
  });
});

app.get('/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');

    const b2 = await checkB2Health();
    if (b2Enabled && !b2.ok) {
      return res.status(503).json({
        ok: false,
        db: 'ok',
        b2: 'error',
        reason: b2.reason || 'b2-not-ready',
        ai: {
          enabled: isAiGenerationEnabled(),
          provider: getActiveAiProviderName(),
          model: getActiveAiModelName()
        }
      });
    }

    res.json({
      ok: true,
      db: 'ok',
      b2: b2Enabled ? 'ok' : 'disabled',
      ai: {
        enabled: isAiGenerationEnabled(),
        provider: getActiveAiProviderName(),
        model: getActiveAiModelName()
      }
    });
  } catch (error) {
    res.status(503).json({ ok: false, db: 'error', reason: error.message || 'db-not-ready' });
  }
});

app.use(session({
  store: new PgSession({
    pool: db.pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'football-agent-secret-key',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.SESSION_COOKIE_SECURE === 'true' ? true : 'auto',
    sameSite: 'lax'
  }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

app.get('/api/upload-proxy', async (req, res) => {
  try {
    const requestedPath = normalizeUploadFilename(req.query.path || '');
    if (!requestedPath) {
      return res.status(400).send('Missing upload path');
    }

    if (b2Enabled) {
      const objectKey = 'uploads/' + requestedPath;
      const upstream = await fetch(getB2Url(objectKey));
      if (!upstream.ok) {
        return res.status(upstream.status).send('File not found');
      }

      const contentType = upstream.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      res.setHeader('Cache-Control', 'public, max-age=86400');

      const arrayBuffer = await upstream.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }

    const safePath = safeUploadPath(requestedPath);
    if (!safePath || !fs.existsSync(safePath)) {
      return res.status(404).send('File not found');
    }

    return res.sendFile(safePath);
  } catch (error) {
    console.error('Upload proxy error:', error);
    return res.status(500).send('Failed to load file');
  }
});

// Helper: Enrich a player profile with data from normalized tables
async function enrichPlayerProfile(profile) {
  if (!profile) return profile;

  // Keep API compatibility: expose player id as the account/user id.
  profile.id = profile.user_id;

  const playerId = profile.user_id;

  let collegeLogoOrderState = {};
  if (profile.college_logo_order) {
    try {
      if (typeof profile.college_logo_order === 'string') {
        const parsed = JSON.parse(profile.college_logo_order);
        collegeLogoOrderState = parsed && typeof parsed === 'object' ? parsed : {};
      } else if (typeof profile.college_logo_order === 'object') {
        collegeLogoOrderState = profile.college_logo_order;
      }
    } catch (_) {
      collegeLogoOrderState = {};
    }
  }

  function applyCollegeOrder(group, schools) {
    if (!Array.isArray(schools) || schools.length === 0) return [];
    const ids = Array.isArray(collegeLogoOrderState[group])
      ? collegeLogoOrderState[group].map(id => Number(id)).filter(Number.isFinite)
      : [];
    if (ids.length === 0) return schools;

    const indexMap = new Map(ids.map((id, index) => [id, index]));
    return [...schools].sort((a, b) => {
      const ai = indexMap.has(Number(a.id)) ? indexMap.get(Number(a.id)) : Number.MAX_SAFE_INTEGER;
      const bi = indexMap.has(Number(b.id)) ? indexMap.get(Number(b.id)) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  const videos = await db.prepare('SELECT filename FROM player_videos WHERE user_id = ? ORDER BY id').all(playerId);
  profile.highlight_videos = videos.length > 0 ? JSON.stringify(videos.map(v => v.filename)) : null;

  const videoLinks = await db.prepare('SELECT id, url, title FROM player_video_links WHERE user_id = ? ORDER BY id').all(playerId);
  profile.video_links = videoLinks.length > 0 ? JSON.stringify(videoLinks) : null;

  const images = await db.prepare('SELECT filename FROM player_images WHERE user_id = ? ORDER BY id').all(playerId);
  profile.additional_images = images.length > 0 ? JSON.stringify(images.map(i => i.filename)) : null;

  const metricVideos = await db.prepare(
    'SELECT metric_key, video_filename, is_verified, verified_by FROM player_metric_videos WHERE user_id = ? ORDER BY id'
  ).all(playerId);
  profile.metric_videos = metricVideos.length > 0 ? JSON.stringify(metricVideos) : null;

  const offerSchoolsRaw = await db.prepare(`SELECT c.id, c.name, c.logo, c.conference, c.team FROM player_school_interests psi JOIN colleges c ON psi.college_id = c.id WHERE psi.user_id = ? AND psi.has_offer = 1 ORDER BY c.name`).all(playerId);
  const offerSchools = applyCollegeOrder('offers', offerSchoolsRaw);
  profile.college_offer_schools = offerSchools.length > 0 ? JSON.stringify(offerSchools) : null;

  const favoriteSchoolsRaw = await db.prepare(`SELECT c.id, c.name, c.logo, c.conference, c.team FROM player_school_interests psi JOIN colleges c ON psi.college_id = c.id WHERE psi.user_id = ? AND psi.is_favorite = 1 AND (psi.has_offer = 0 OR psi.has_offer IS NULL) ORDER BY c.name`).all(playerId);
  const favoriteSchools = applyCollegeOrder('favorites', favoriteSchoolsRaw);
  profile.college_favorite_schools = favoriteSchools.length > 0 ? JSON.stringify(favoriteSchools) : null;

  // Include college logo ordering from database
  profile.college_logo_order = profile.college_logo_order || null;

  const contacts = await db.prepare('SELECT role, name, email, phone FROM player_contacts WHERE user_id = ?').all(playerId);
  contacts.forEach(c => {
    profile[c.role + '_name'] = c.name;
    profile[c.role + '_email'] = c.email;
    profile[c.role + '_phone'] = c.phone;
  });

  return profile;
}

async function sendVerificationEmail(toEmail, token) {
  const appUrl = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const verifyUrl = `${appUrl}/api/verify-email?token=${token}`;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'Verify your Gridiron Elite account',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#1e3a5f">Welcome to Gridiron Elite!</h2>
        <p>Thanks for registering. Click the button below to verify your email address and activate your account.</p>
        <p style="margin:32px 0">
          <a href="${verifyUrl}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">Verify Email Address</a>
        </p>
        <p style="color:#6b7280;font-size:13px">If you didn't create a Gridiron Elite account, you can safely ignore this email.</p>
      </div>
    `,
    text: `Welcome to Gridiron Elite!\n\nPlease verify your email address by visiting the link below:\n\n${verifyUrl}\n\nIf you didn't create an account, please ignore this email.`
  });
}

async function sendPasswordResetEmail(toEmail, token) {
  const appUrl = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const resetUrl = `${appUrl}/reset-password.html?token=${token}`;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'Reset your Gridiron Elite password',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#1e3a5f">Password reset request</h2>
        <p>We received a request to reset your password. Click the button below to choose a new one.</p>
        <p style="margin:32px 0">
          <a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">Reset Password</a>
        </p>
        <p style="color:#6b7280;font-size:13px">This link expires in 60 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
    text: `Use this link to reset your password (valid for 60 minutes):\n\n${resetUrl}`
  });
}

// Register
app.post('/api/register', async (req, res) => {
  const { email, password, role, fullName } = req.body;
  const ALLOWED_PUBLIC_ROLES = ['player', 'agent', 'coach'];
  if (!ALLOWED_PUBLIC_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const result = await db.prepare(
      'INSERT INTO users (email, password, role, email_verified, email_verification_token) VALUES (?, ?, ?, false, ?)'
    ).run(email, hashedPassword, role, verificationToken);

    if (role === 'player') {
      await db.prepare('INSERT INTO player_profiles (user_id, full_name) VALUES (?, ?)').run(result.lastInsertRowid, fullName);
    }

    if (role === 'coach') {
      const teamName = (fullName ? fullName + "'s Team" : 'My Team');
      await db.prepare('INSERT INTO hs_teams (coach_id, team_name) VALUES (?, ?)').run(result.lastInsertRowid, teamName);
    }

    // Notify all admin users about the new registration
    const admins = await db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    const roleLabel = role === 'player' ? 'Athlete' : role.charAt(0).toUpperCase() + role.slice(1);
    const notifMessage = `New ${roleLabel} registration: ${fullName || email} (${email})`;
    const insertMsg = db.prepare('INSERT INTO messages (sender_id, recipient_id, message) VALUES (?, ?, ?)');
    for (const admin of admins) {
      await insertMsg.run(result.lastInsertRowid, admin.id, notifMessage);
    }

    // Send verification email (non-fatal – log error but still return success)
    try {
      await sendVerificationEmail(email, verificationToken);
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr.message);
    }

    res.json({ success: true, message: 'Registration successful! Please check your email to verify your account.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: 'Email already exists or registration failed' });
  }
});

// Email verification
app.get('/api/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    return res.redirect('/?verified=invalid');
  }
  try {
    const user = await db.prepare('SELECT id, email_verified FROM users WHERE email_verification_token = ?').get(token);
    if (!user) {
      return res.redirect('/?verified=invalid');
    }
    if (user.email_verified) {
      return res.redirect('/?verified=already');
    }
    await db.prepare('UPDATE users SET email_verified = true, email_verification_token = NULL WHERE id = ?').run(user.id);
    res.redirect('/?verified=true');
  } catch (error) {
    console.error('Email verification error:', error);
    res.redirect('/?verified=error');
  }
});

// Forgot password - always return success so emails cannot be enumerated
app.post('/api/forgot-password', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  try {
    const user = await db.prepare('SELECT id, email FROM users WHERE LOWER(email) = ?').get(email);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + (60 * 60 * 1000));
      await db.prepare('UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?').run(token, expiresAt.toISOString(), user.id);
      try {
        await sendPasswordResetEmail(user.email, token);
      } catch (emailErr) {
        console.error('Failed to send password reset email:', emailErr.message);
      }
    }
    return res.json({ success: true, message: 'If an account exists with that email, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Reset password with token
app.post('/api/reset-password', async (req, res) => {
  const token = (req.body?.token || '').trim().toLowerCase();
  const newPassword = req.body?.newPassword || '';

  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ error: 'Invalid reset token' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  try {
    const user = await db.prepare(
      'SELECT id, password_reset_expires FROM users WHERE password_reset_token = ?'
    ).get(token);

    if (!user) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }

    const expiresAtMs = user.password_reset_expires ? new Date(user.password_reset_expires).getTime() : NaN;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.prepare(
      'UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?'
    ).run(hashedPassword, user.id);

    return res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email address before logging in. Check your inbox for the verification link.' });
  }

  await db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, login_count = COALESCE(login_count, 0) + 1 WHERE id = ?').run(user.id);

  req.session.userId = user.id;
  req.session.role = user.role;
  await logSiteTrafficEvent({
    req,
    eventType: 'login',
    path: '/login',
    method: 'POST',
    userId: user.id,
    role: user.role,
    metadata: { email: user.email }
  });
  res.json({ success: true, role: user.role });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
app.get('/api/user', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

// Get player profile
app.get('/api/player/profile', requireAuth, async (req, res) => {
  const profile = await db.prepare('SELECT * FROM player_profiles WHERE user_id = ?').get(req.session.userId);
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  await enrichPlayerProfile(profile);
  res.json({ ...(profile || {}), email: user?.email || '' });
});

// Player: Get pro tips for athletic metrics
app.get('/api/player/metric-pro-tips', requireAuth, async (req, res) => {
  try {
    if (req.session.role === 'player') {
      const tips = await getMergedMetricTipsForPlayer(req.session.userId);
      return res.json({ tips: tips.merged, metrics: METRIC_TIP_CONFIG });
    }

    const tips = await getMetricTipsMap();
    res.json({ tips, metrics: METRIC_TIP_CONFIG });
  } catch (error) {
    console.error('Player get metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to load metric tips' });
  }
});

app.get('/api/ad-slots', async (req, res) => {
  try {
    const slots = await getAdSlotsMap();
    res.json({ slots });
  } catch (error) {
    console.error('Get ad slots error:', error);
    res.status(500).json({ error: 'Failed to load ad slots' });
  }
});

app.post('/api/traffic/page-view', requireAuth, async (req, res) => {
  try {
    const pageKey = String(req.body?.pageKey || '').trim();
    const pagePath = String(req.body?.pagePath || '').trim();
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

    if (!pageKey) {
      return res.status(400).json({ error: 'Missing page key' });
    }

    await logSiteTrafficEvent({
      req,
      eventType: 'page_view',
      path: pagePath || pageKey,
      method: 'GET',
      userId: req.session.userId,
      role: req.session.role,
      metadata: { pageKey, ...metadata }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Page view traffic log error:', error);
    res.status(500).json({ error: 'Failed to log page view' });
  }
});

// Player: AI-assisted bio writing/improvement
app.post('/api/player/bio-assist', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'player') {
      return res.status(403).json({ error: 'Only players can use bio assistance' });
    }

    if (!isAiGenerationEnabled()) {
      return res.status(503).json({ error: 'AI assistance is currently disabled' });
    }

    const mode = req.body?.mode === 'improve' ? 'improve' : 'write';
    const currentBio = String(req.body?.currentBio || '').trim().slice(0, 2400);
    const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};

    const profileContext = {
      full_name: context.fullName ? String(context.fullName).trim().slice(0, 120) : null,
      high_school: context.highSchool ? String(context.highSchool).trim().slice(0, 120) : null,
      graduation_year: context.graduationYear ? String(context.graduationYear).trim().slice(0, 10) : null,
      position: context.position ? String(context.position).trim().slice(0, 30) : null,
      height: context.height ? String(context.height).trim().slice(0, 24) : null,
      weight: context.weight ? String(context.weight).trim().slice(0, 24) : null,
      gpa: context.gpa ? String(context.gpa).trim().slice(0, 10) : null,
      achievement: context.achievement ? String(context.achievement).trim().slice(0, 240) : null
    };

    const generated = await generateBioAssistance({
      mode,
      currentBio,
      profileContext
    });

    await logAiEvent({
      eventType: mode === 'improve' ? 'bio_assist_improve' : 'bio_assist_write',
      actorUserId: req.session.userId,
      playerUserId: req.session.userId,
      metadata: {
        modelName: generated.modelName,
        promptVersion: generated.promptVersion
      }
    });

    res.json({
      success: true,
      mode,
      bioText: generated.bioText,
      suggestions: generated.suggestions,
      modelName: generated.modelName,
      promptVersion: generated.promptVersion
    });
  } catch (error) {
    console.error('Player bio assist error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate bio assistance' });
  }
});

// Update player profile
app.post('/api/player/profile', requireAuth, playerProfileUploadMiddleware, async (req, res) => {
  const data = req.body;
  const files = {};

  for (const file of (req.files || [])) {
    const fieldName = file.fieldname;
    const allowedMaxCount = PROFILE_UPLOAD_FIELD_MAX_COUNTS[fieldName];

    if (!allowedMaxCount) {
      return res.status(400).json({ error: `Unsupported upload field: ${fieldName}` });
    }

    if (!files[fieldName]) files[fieldName] = [];
    files[fieldName].push(file);

    if (files[fieldName].length > allowedMaxCount) {
      return res.status(400).json({ error: `Too many files uploaded for ${fieldName}` });
    }
  }
  
  console.log('Update request for user:', req.session.userId);
  console.log('Upload fields received:', (req.files || []).map(f => `${f.fieldname}:${f.originalname}`));
  console.log('Data received:', data);
  
  try {
    if (files?.highlightVideos && files.highlightVideos.length > 1) {
      return res.status(400).json({
        error: 'Please upload only one highlight video at a time.'
      });
    }

    if (files?.highlightVideos?.[0] && files.highlightVideos[0].size > MAX_HIGHLIGHT_VIDEO_BYTES) {
      return res.status(400).json({
        error: `Highlight video is too large. Maximum allowed is ${MAX_HIGHLIGHT_VIDEO_MB}MB.`
      });
    }

    const hasIncomingMedia = Object.values(files || {}).some(arr => Array.isArray(arr) && arr.length > 0);
    if (hasIncomingMedia) {
      const now = Date.now();
      const signature = buildProfileUploadSignature(req.session.userId, data, files);
      const previousAt = recentProfileUploadSignatures.get(signature);
      if (previousAt && now - previousAt < 15000) {
        return res.json({ success: true, deduped: true });
      }
      recentProfileUploadSignatures.set(signature, now);
      if (recentProfileUploadSignatures.size > 200) {
        const cutoff = now - 60000;
        for (const [sig, ts] of recentProfileUploadSignatures.entries()) {
          if (ts < cutoff) recentProfileUploadSignatures.delete(sig);
        }
      }
    }

    // Upload any incoming files to B2 (or local disk if B2 not configured)
    await processUploadedFiles(req.session.userId, files);
    // Update basic profile info
    const result = await db.prepare(`
      UPDATE player_profiles SET
        full_name = ?, high_school = ?, graduation_year = ?, position = ?,
        height = ?, weight = ?, forty_yard_dash = ?, bench_press = ?,
        squat = ?, vertical_jump = ?, shuttle_5_10_5 = ?, l_drill = ?,
        broad_jump = ?, power_clean = ?, single_leg_squat = ?, gpa = ?, achievement = ?, bio = ?,
        phone = ?,
        hudl_link = ?, instagram_link = ?, twitter_link = ?,
        hudl_username = ?, instagram_username = ?, twitter_username = ?
      WHERE user_id = ?
    `).run(
      data.fullName || null, 
      data.highSchool || null, 
      data.graduationYear || null, 
      data.position || null,
      data.height || null, 
      data.weight || null, 
      data.fortyYardDash || null, 
      data.benchPress || null,
      data.squat || null, 
      data.verticalJump || null,
      data.shuttle5105 || null,
      data.lDrill || null,
      data.broadJump || null,
      data.powerClean || null,
      data.singleLegSquat || null,
      data.gpa || null, 
      data.achievement || null,
      data.bio || null,
      data.phone || null,
      data.hudlLink || null,
      data.instagramLink || null,
      data.twitterLink || null,
      data.hudlUsername || null,
      data.instagramUsername || null,
      data.twitterUsername || null,
      req.session.userId
    );

    // Update contacts in normalized table
    await db.prepare('DELETE FROM player_contacts WHERE user_id = ?').run(req.session.userId);
    const insertContact = db.prepare('INSERT INTO player_contacts (user_id, role, name, email, phone) VALUES (?, ?, ?, ?, ?)');
    if (data.fatherName || data.fatherEmail || data.fatherPhone) {
      await insertContact.run(req.session.userId, 'father', data.fatherName || null, data.fatherEmail || null, data.fatherPhone || null);
    }
    if (data.motherName || data.motherEmail || data.motherPhone) {
      await insertContact.run(req.session.userId, 'mother', data.motherName || null, data.motherEmail || null, data.motherPhone || null);
    }
    if (data.coachName || data.coachEmail || data.coachPhone) {
      await insertContact.run(req.session.userId, 'coach', data.coachName || null, data.coachEmail || null, data.coachPhone || null);
    }
    
    console.log(`Profile update result: ${result.changes} rows changed`);
    
    const userPrefix = req.session.userId + '/';
    
    // Update profile picture if provided
    if (files?.profilePicture) {
      await replacePlayerProfileFile(req.session.userId, 'profile_picture', userPrefix + files.profilePicture[0].filename);
    }
    
    // Update card photo if provided
    if (files?.cardPhoto) {
      await replacePlayerProfileFile(req.session.userId, 'card_photo', userPrefix + files.cardPhoto[0].filename);
    }

    // Update report card image if provided
    if (files?.reportCardImage) {
      await replacePlayerProfileFile(req.session.userId, 'report_card_image', userPrefix + files.reportCardImage[0].filename);
    }
    
    // Add new videos to normalized table
    if (files?.highlightVideos) {
      const insertVideo = db.prepare('INSERT INTO player_videos (user_id, filename) VALUES (?, ?)');
      for (const f of files.highlightVideos) {
        await insertVideo.run(req.session.userId, userPrefix + f.filename);
      }
    }
    
    // Add new images to normalized table
    if (files?.additionalImages) {
      const insertImage = db.prepare('INSERT INTO player_images (user_id, filename) VALUES (?, ?)');
      for (const f of files.additionalImages) {
        await insertImage.run(req.session.userId, userPrefix + f.filename);
      }
    }

    // Upsert per-metric proof videos and verification metadata.
    for (const config of METRIC_VIDEO_CONFIG) {
      const uploadedMetricVideo = files?.[config.fieldName]?.[0];
      const existingMetricVideo = await db.prepare(
        'SELECT video_filename FROM player_metric_videos WHERE user_id = ? AND metric_key = ?'
      ).get(req.session.userId, config.key);

      let resolvedFilename = existingMetricVideo?.video_filename || null;
      if (uploadedMetricVideo) {
        resolvedFilename = userPrefix + uploadedMetricVideo.filename;
        if (existingMetricVideo?.video_filename && existingMetricVideo.video_filename !== resolvedFilename) {
          await deleteUploadFile(existingMetricVideo.video_filename);
        }
      }

      if (!resolvedFilename) {
        continue;
      }

      const isVerified = !!data[config.verifiedField];
      const verifiedBy = (data[config.verifiedByField] || '').trim() || null;

      await db.prepare(`
        INSERT INTO player_metric_videos (user_id, metric_key, video_filename, is_verified, verified_by, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, metric_key)
        DO UPDATE SET
          video_filename = EXCLUDED.video_filename,
          is_verified = EXCLUDED.is_verified,
          verified_by = EXCLUDED.verified_by,
          updated_at = CURRENT_TIMESTAMP
      `).run(req.session.userId, config.key, resolvedFilename, isVerified, verifiedBy);
    }
    
    // Verify the update
    const updated = await db.prepare('SELECT gpa, vertical_jump FROM player_profiles WHERE user_id = ?').get(req.session.userId);
    console.log('Verified data in DB:', updated);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Profile update error:', error);
    const details = error && typeof error === 'object'
      ? {
          message: error.message || null,
          code: error.code || null,
          field: error.field || null
        }
      : null;
    res.status(500).json({ error: 'Failed to update profile', details });
  }
});

// Upload one metric proof video at a time (auto-save flow from profile form).
app.post('/api/player/metric-video', requireAuth, playerProfileUploadMiddleware, async (req, res) => {
  const data = req.body || {};
  const files = {};

  for (const file of (req.files || [])) {
    const fieldName = file.fieldname;
    if (!PROFILE_UPLOAD_FIELD_MAX_COUNTS[fieldName]) {
      return res.status(400).json({ error: `Unsupported upload field: ${fieldName}` });
    }
    if (!files[fieldName]) files[fieldName] = [];
    files[fieldName].push(file);
  }

  try {
    const metricEntries = METRIC_VIDEO_CONFIG
      .map(config => ({ config, upload: files[config.fieldName]?.[0] || null }))
      .filter(item => !!item.upload);

    if (metricEntries.length !== 1) {
      return res.status(400).json({
        error: 'Upload exactly one metric proof video at a time.'
      });
    }

    const { config, upload } = metricEntries[0];
    await processUploadedFiles(req.session.userId, { [config.fieldName]: [upload] });

    const userPrefix = req.session.userId + '/';
    const existingMetricVideo = await db.prepare(
      'SELECT video_filename FROM player_metric_videos WHERE user_id = ? AND metric_key = ?'
    ).get(req.session.userId, config.key);

    const resolvedFilename = userPrefix + upload.filename;
    if (existingMetricVideo?.video_filename && existingMetricVideo.video_filename !== resolvedFilename) {
      await deleteUploadFile(existingMetricVideo.video_filename);
    }

    const isVerified = !!data[config.verifiedField];
    const verifiedBy = (data[config.verifiedByField] || '').trim() || null;

    await db.prepare(`
      INSERT INTO player_metric_videos (user_id, metric_key, video_filename, is_verified, verified_by, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, metric_key)
      DO UPDATE SET
        video_filename = EXCLUDED.video_filename,
        is_verified = EXCLUDED.is_verified,
        verified_by = EXCLUDED.verified_by,
        updated_at = CURRENT_TIMESTAMP
    `).run(req.session.userId, config.key, resolvedFilename, isVerified, verifiedBy);

    res.json({
      success: true,
      metricKey: config.key,
      videoFilename: resolvedFilename,
      isVerified,
      verifiedBy
    });
  } catch (error) {
    console.error('Metric proof upload error:', error);
    const details = error && typeof error === 'object'
      ? {
          message: error.message || null,
          code: error.code || null,
          field: error.field || null
        }
      : null;
    res.status(500).json({ error: 'Failed to upload metric proof video', details });
  }
});

// Delete card photo
app.delete('/api/player/card-photo', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'card_photo');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete card photo error:', error);
    res.status(500).json({ error: 'Failed to delete card photo' });
  }
});

// Delete profile picture
app.delete('/api/player/profile-picture', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'profile_picture');

    res.json({ success: true });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ error: 'Failed to delete profile picture' });
  }
});

// Delete report card image
app.delete('/api/player/report-card', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'report_card_image');

    res.json({ success: true });
  } catch (error) {
    console.error('Delete report card image error:', error);
    res.status(500).json({ error: 'Failed to delete report card image' });
  }
});

// Delete report card image via POST (for environments that block DELETE)
app.post('/api/player/report-card/delete', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'report_card_image');

    res.json({ success: true });
  } catch (error) {
    console.error('Delete report card image error:', error);
    res.status(500).json({ error: 'Failed to delete report card image' });
  }
});

// Agent: Get all players with filters
app.get('/api/agent/players', async (req, res) => {
  // Disable caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  let query = 'SELECT * FROM player_profiles WHERE 1=1';
  const params = [];
  
  // Filter by favorites only (only works if authenticated)
  if (req.query.favoritesOnly === 'true' && req.session.userId) {
    query = `SELECT pp.* FROM player_profiles pp 
             INNER JOIN agent_favorites af ON pp.user_id = af.user_id 
             WHERE af.agent_id = ?`;
    params.push(req.session.userId);
  }
  
  if (req.query.position) {
    query += ' AND position = ?';
    params.push(req.query.position);
  }
  if (req.query.graduationYear) {
    query += ' AND graduation_year = ?';
    params.push(req.query.graduationYear);
  }
  if (req.query.minGpa) {
    query += ' AND gpa >= ?';
    params.push(req.query.minGpa);
  }
  
  const players = await db.prepare(query).all(...params);
  await Promise.all(players.map(enrichPlayerProfile));
  console.log(`Agent query returned ${players.length} players at ${new Date().toISOString()}`);
  
  // Log Brandon's GPA for debugging
  const brandon = players.find(p => p.full_name.includes('Brandon'));
  if (brandon) {
    console.log(`Brandon Mitchell GPA: ${brandon.gpa}`);
  }
  
  res.json(players);
});

// Agent: Get single player detail (public access)
app.get('/api/agent/player/:id', async (req, res) => {
  // Disable caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  const player = await db.prepare('SELECT pp.*, u.email FROM player_profiles pp JOIN users u ON pp.user_id = u.id WHERE pp.user_id = ?').get(req.params.id);
  
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const updatedViewStats = await db.prepare(
    'UPDATE player_profiles SET profile_view_count = COALESCE(profile_view_count, 0) + 1, last_viewed_at = CURRENT_TIMESTAMP WHERE user_id = ? RETURNING profile_view_count, last_viewed_at'
  ).get(req.params.id);

  if (updatedViewStats) {
    player.profile_view_count = updatedViewStats.profile_view_count;
    player.last_viewed_at = updatedViewStats.last_viewed_at;
  }

  await logSiteTrafficEvent({
    req,
    eventType: 'player_profile_view',
    path: '/player-detail',
    method: 'GET',
    userId: req.session.userId,
    role: req.session.role,
    metadata: {
      playerUserId: Number(req.params.id),
      profileViewCount: Number(player.profile_view_count || 0)
    }
  });
  
  await enrichPlayerProfile(player);
  res.json(player);
});

// Agent: Get agent profile
app.get('/api/agent/profile', requireAuth, async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  const agent = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  res.json({
    email: agent.email,
    full_name: agent.full_name,
    phone: agent.phone,
    organization: agent.organization,
    title: agent.title,
    experience: agent.experience,
    bio: agent.bio,
    profile_picture: agent.profile_picture
  });
});

// Agent: Update agent profile
app.post('/api/agent/profile', requireAuth, upload.fields([
  { name: 'profilePicture', maxCount: 1 }
]), async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  const data = req.body;
  const files = req.files;
  try {
    const normalizedExperience = normalizeOptionalInteger(data.experience);
    // Upload any incoming files to B2 (or local disk if B2 not configured)
    await processUploadedFiles(req.session.userId, files);
    const existingAgent = await db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.session.userId);
    let profilePicFilename = existingAgent?.profile_picture || null;
    if (files && files.profilePicture && files.profilePicture[0]) {
      profilePicFilename = req.session.userId + '/' + files.profilePicture[0].filename;
      console.log('Profile picture saved as:', profilePicFilename);
    } else {
      console.log('No profile picture uploaded.');
    }
    // Log received data for debugging
    console.log('Agent profile update:', {
      userId: req.session.userId,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      organization: data.organization,
      title: data.title,
      experience: normalizedExperience,
      bio: data.bio,
      profile_picture: profilePicFilename
    });
    const result = await db.prepare(`UPDATE users SET full_name = ?, email = ?, phone = ?, organization = ?, title = ?, experience = ?, bio = ? WHERE id = ?`).run(
      data.fullName?.trim() || null,
      data.email?.trim() || null,
      data.phone?.trim() || null,
      data.organization?.trim() || null,
      data.title?.trim() || null,
      normalizedExperience,
      data.bio?.trim() || null,
      req.session.userId
    );
    if (files && files.profilePicture && files.profilePicture[0]) {
      await replaceUserFile(req.session.userId, 'profile_picture', profilePicFilename);
    }
    console.log('DB update result:', result);
    res.json({ success: true });
  } catch (error) {
    console.error('Agent update profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to update profile' });
  }
});

// Agent: Change password
app.post('/api/agent/change-password', requireAuth, async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  const { currentPassword, newPassword } = req.body;
  
  const agent = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  
  if (!agent || !(await bcrypt.compare(currentPassword, agent.password))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Agent: Add player to favorites
app.post('/api/agent/favorites/:playerId', requireAuth, async (req, res) => {
  try {
    await db.prepare('INSERT OR IGNORE INTO agent_favorites (agent_id, user_id) VALUES (?, ?)').run(req.session.userId, req.params.playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// Agent: Remove player from favorites
app.delete('/api/agent/favorites/:playerId', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM agent_favorites WHERE agent_id = ? AND user_id = ?').run(req.session.userId, req.params.playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

// Agent: Get all favorite player IDs
app.get('/api/agent/favorites', async (req, res) => {
  try {
    // Return empty array for unauthenticated users
    if (!req.session.userId) {
      return res.json([]);
    }
    
    const favorites = await db.prepare('SELECT user_id FROM agent_favorites WHERE agent_id = ?').all(req.session.userId);
    res.json(favorites.map(f => f.user_id));
  } catch (error) {
    console.error('Error getting favorites:', error);
    res.status(500).json({ error: 'Failed to get favorites' });
  }
});

// Agent: Check if player is favorited
app.get('/api/agent/favorites/:playerId', requireAuth, async (req, res) => {
  try {
    const favorite = await db.prepare('SELECT id FROM agent_favorites WHERE agent_id = ? AND user_id = ?').get(req.session.userId, req.params.playerId);
    res.json({ isFavorite: !!favorite });
  } catch (error) {
    console.error('Error checking favorite:', error);
    res.status(500).json({ error: 'Failed to check favorite' });
  }
});

// Messaging endpoints
// Send a message
app.post('/api/messages/send', requireAuth, async (req, res) => {
  const { recipientId, message } = req.body;
  
  if (!recipientId || !message) {
    return res.status(400).json({ error: 'Recipient and message are required' });
  }
  
  try {
    await db.prepare('INSERT INTO messages (sender_id, recipient_id, message) VALUES (?, ?, ?)')
      .run(req.session.userId, recipientId, message);
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get conversations list
app.get('/api/messages/conversations', requireAuth, async (req, res) => {
  try {
    // First get all unique conversation partners
    const conversationPartners = await db.prepare(`
      SELECT DISTINCT
        CASE 
          WHEN sender_id = ? THEN recipient_id
          ELSE sender_id
        END as other_user_id
      FROM messages
      WHERE sender_id = ? OR recipient_id = ?
    `).all(req.session.userId, req.session.userId, req.session.userId);
    
    // Then get details for each conversation
    const conversations = await Promise.all(conversationPartners.map(async partner => {
      const user = await db.prepare('SELECT email, full_name, role FROM users WHERE id = ?').get(partner.other_user_id);
      
      // If the user is a player, get their name from player_profiles
      let displayName = user.full_name || user.email;
      if (user.role === 'player') {
        const playerProfile = await db.prepare('SELECT full_name FROM player_profiles WHERE user_id = ?').get(partner.other_user_id);
        if (playerProfile && playerProfile.full_name) {
          displayName = playerProfile.full_name;
        }
      }
      
      const lastMessage = await db.prepare(`
        SELECT message, created_at 
        FROM messages 
        WHERE (sender_id = ? AND recipient_id = ?) 
           OR (sender_id = ? AND recipient_id = ?)
        ORDER BY created_at DESC 
        LIMIT 1
      `).get(req.session.userId, partner.other_user_id, partner.other_user_id, req.session.userId);
      
      const unreadCount = await db.prepare(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE sender_id = ? AND recipient_id = ? AND read = 0
      `).get(partner.other_user_id, req.session.userId);
      
      return {
        other_user_id: partner.other_user_id,
        email: user.email,
        full_name: displayName,
        role: user.role,
        last_message: lastMessage ? lastMessage.message : null,
        last_message_time: lastMessage ? lastMessage.created_at : null,
        unread_count: unreadCount.count
      };
    }));
    
    // Sort by last message time
    conversations.sort((a, b) => {
      if (!a.last_message_time) return 1;
      if (!b.last_message_time) return -1;
      return new Date(b.last_message_time) - new Date(a.last_message_time);
    });
    
    res.json(conversations);
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get messages with a specific user
app.get('/api/messages/:userId', requireAuth, async (req, res) => {
  try {
    const messages = await db.prepare(`
      SELECT m.*, 
        sender.email as sender_email, 
        sender.full_name as sender_name,
        recipient.email as recipient_email,
        recipient.full_name as recipient_name
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users recipient ON m.recipient_id = recipient.id
      WHERE (sender_id = ? AND recipient_id = ?) 
         OR (sender_id = ? AND recipient_id = ?)
      ORDER BY created_at ASC
    `).all(req.session.userId, req.params.userId, req.params.userId, req.session.userId);
    
    // Mark messages as read
    await db.prepare('UPDATE messages SET read = 1 WHERE sender_id = ? AND recipient_id = ? AND read = 0')
      .run(req.params.userId, req.session.userId);
    
    res.json(messages);
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get unread message count
app.get('/api/messages/unread/count', requireAuth, async (req, res) => {
  try {
    const result = await db.prepare('SELECT COUNT(*) as count FROM messages WHERE recipient_id = ? AND read = 0')
      .get(req.session.userId);
    res.json({ count: result.count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Delete video from player profile (query param variant)
app.delete('/api/player/video', requireAuth, async (req, res) => {
  try {
    const filename = req.query.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_videos', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Video file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Delete video from player profile via POST (for environments that block DELETE)
app.post('/api/player/video/delete', requireAuth, async (req, res) => {
  try {
    const filename = req.body?.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_videos', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Video file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Delete metric proof video from player profile via POST (for environments that block DELETE)
app.post('/api/player/metric-video/delete', requireAuth, async (req, res) => {
  try {
    const metricKey = String(req.body?.metricKey || '').trim();
    if (!metricKey) return res.status(400).json({ error: 'Metric key is required' });

    const deleted = await deleteOwnedPlayerMetricVideo(req.session.userId, metricKey);
    if (!deleted) return res.status(404).json({ error: 'Metric proof video not found' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete metric proof video error:', error);
    res.status(500).json({ error: 'Failed to delete metric proof video' });
  }
});

// Delete metric proof video from player profile
app.delete('/api/player/metric-video', requireAuth, async (req, res) => {
  try {
    const metricKey = String(req.query.metricKey || '').trim();
    if (!metricKey) return res.status(400).json({ error: 'Metric key is required' });

    const deleted = await deleteOwnedPlayerMetricVideo(req.session.userId, metricKey);
    if (!deleted) return res.status(404).json({ error: 'Metric proof video not found' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete metric proof video error:', error);
    res.status(500).json({ error: 'Failed to delete metric proof video' });
  }
});

// Delete video from player profile
app.delete('/api/player/video/:filename', requireAuth, async (req, res) => {
  try {
    const filename = req.query.filename || req.params.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_videos', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Video file not found in storage' });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Support prefixed filenames that include slashes (e.g. "123/file.mp4")
app.delete('/api/player/video/*', requireAuth, async (req, res) => {
  try {
    const wildcardFilename = req.params[0];
    const filename = req.query.filename || wildcardFilename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_videos', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Video file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Add video link to player profile
app.post('/api/player/video-link', requireAuth, async (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    // Basic URL validation
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    const result = await db.prepare('INSERT INTO player_video_links (user_id, url, title) VALUES (?, ?, ?)')
      .run(req.session.userId, url, title || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add video link error:', error);
    res.status(500).json({ error: 'Failed to add video link' });
  }
});

// Delete video link from player profile
app.delete('/api/player/video-link/:id', requireAuth, async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    if (isNaN(linkId)) return res.status(400).json({ error: 'Invalid ID' });
    await db.prepare('DELETE FROM player_video_links WHERE id = ? AND user_id = ?')
      .run(linkId, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete video link error:', error);
    res.status(500).json({ error: 'Failed to delete video link' });
  }
});

// Delete image from player profile (query param variant)
app.delete('/api/player/image', requireAuth, async (req, res) => {
  try {
    const filename = req.query.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_images', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Image file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Delete image from player profile via POST (for environments that block DELETE)
app.post('/api/player/image/delete', requireAuth, async (req, res) => {
  try {
    const filename = req.body?.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_images', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Image file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Delete image from player profile
app.delete('/api/player/image/:filename', requireAuth, async (req, res) => {
  try {
    const filename = req.query.filename || req.params.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_images', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Image file not found in storage' });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Support prefixed filenames that include slashes (e.g. "123/file.png")
app.delete('/api/player/image/*', requireAuth, async (req, res) => {
  try {
    const wildcardFilename = req.params[0];
    const filename = req.query.filename || wildcardFilename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_images', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Image file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Admin middleware
const requireAdmin = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Coach middleware (admin can also access coach routes)
const requireCoach = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'coach' && req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
};

async function sendTeamInviteEmail(toEmail, inviteToken, coachName, teamName, schoolName) {
  const appUrl = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const acceptUrl = `${appUrl}/coach-dashboard.html?acceptInvite=${inviteToken}`;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  });
  const displaySchool = schoolName ? ` at ${schoolName}` : '';
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: `You've been invited to join ${teamName} on Gridiron Elite`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#1e3a5f">Team Invitation</h2>
        <p>${coachName || 'Your coach'} has invited you to join <strong>${teamName}</strong>${displaySchool} on Gridiron Elite.</p>
        <p>Click the button below to accept the invitation and join the team.</p>
        <p style="margin:32px 0">
          <a href="${acceptUrl}" style="background:#2563eb;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px">Accept Invitation</a>
        </p>
        <p style="color:#6b7280;font-size:13px">This invitation expires in 7 days. If you don't have an account yet, please register as an Athlete first, then click the link above.</p>
        <p style="color:#6b7280;font-size:13px">If you did not expect this invitation, you can safely ignore this email.</p>
      </div>
    `,
    text: `${coachName || 'Your coach'} has invited you to join ${teamName}${displaySchool} on Gridiron Elite.\n\nAccept the invitation here:\n${acceptUrl}\n\nThis invitation expires in 7 days.`
  });
}

// ============================================================
// Coach routes
// ============================================================

// Coach: Get own team info
app.get('/api/coach/team', requireCoach, async (req, res) => {
  try {
    let coachId = req.session.userId;
    // admin impersonation: pass ?coachId=X
    if (req.session.role === 'admin' && req.query.coachId) {
      coachId = parseInt(req.query.coachId, 10);
    }
    const team = await db.prepare('SELECT * FROM hs_teams WHERE coach_id = ?').get(coachId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const coach = await db.prepare('SELECT full_name, email, phone FROM users WHERE id = ?').get(coachId);
    res.json({ ...team, coach });
  } catch (error) {
    console.error('Coach get team error:', error);
    res.status(500).json({ error: 'Failed to get team' });
  }
});

// Coach: Update team info
app.put('/api/coach/team', requireCoach, async (req, res) => {
  try {
    const { teamName, schoolName, city, state } = req.body;
    if (!teamName || !teamName.trim()) {
      return res.status(400).json({ error: 'Team name is required' });
    }
    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    await db.prepare(
      'UPDATE hs_teams SET team_name = ?, school_name = ?, city = ?, state = ? WHERE id = ?'
    ).run(teamName.trim(), schoolName?.trim() || null, city?.trim() || null, state?.trim() || null, team.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach update team error:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// Coach: Upload/update school logo for team banner customization
app.post('/api/coach/team/logo', requireCoach, upload.single('schoolLogo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'School logo file is required' });
    }

    const team = await db.prepare('SELECT id, school_logo FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    await processUploadedFiles(req.session.userId, { schoolLogo: [req.file] });
    const schoolLogo = req.session.userId + '/' + req.file.filename;

    if (team.school_logo && team.school_logo !== schoolLogo) {
      await deleteUploadFile(team.school_logo);
    }

    await db.prepare('UPDATE hs_teams SET school_logo = ? WHERE id = ?').run(schoolLogo, team.id);
    res.json({ success: true, schoolLogo });
  } catch (error) {
    console.error('Coach upload school logo error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload school logo' });
  }
});

// Coach: Get team roster (enriched player profiles)
app.get('/api/coach/team/roster', requireCoach, async (req, res) => {
  try {
    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const players = await db.prepare(`
      SELECT pp.*, u.email, tp.joined_at
      FROM team_players tp
      JOIN users u ON u.id = tp.player_id
      JOIN player_profiles pp ON pp.user_id = tp.player_id
      WHERE tp.team_id = ?
      ORDER BY pp.full_name ASC
    `).all(team.id);
    for (const p of players) {
      await enrichPlayerProfile(p);
    }
    res.json(players);
  } catch (error) {
    console.error('Coach get roster error:', error);
    res.status(500).json({ error: 'Failed to get roster' });
  }
});

// Coach: Remove player from team
app.delete('/api/coach/team/roster/:playerId', requireCoach, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId, 10);
    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    await db.prepare('DELETE FROM team_players WHERE team_id = ? AND player_id = ?').run(team.id, playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach remove player error:', error);
    res.status(500).json({ error: 'Failed to remove player' });
  }
});

// Coach: Send invite to a player by email
app.post('/api/coach/invite', requireCoach, async (req, res) => {
  try {
    const { playerEmail } = req.body;
    if (!playerEmail || typeof playerEmail !== 'string') {
      return res.status(400).json({ error: 'Player email is required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(playerEmail.trim())) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const normalizedEmail = playerEmail.trim().toLowerCase();

    const team = await db.prepare('SELECT * FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Prevent duplicate pending invites to the same email for the same team
    const existing = await db.prepare(
      "SELECT id FROM team_invites WHERE team_id = ? AND player_email = ? AND status = 'pending'"
    ).get(team.id, normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'A pending invite already exists for this email' });
    }

    // Check if player already on the team
    const playerUser = await db.prepare("SELECT id FROM users WHERE LOWER(email) = ? AND role = 'player'").get(normalizedEmail);
    if (playerUser) {
      const onTeam = await db.prepare('SELECT id FROM team_players WHERE team_id = ? AND player_id = ?').get(team.id, playerUser.id);
      if (onTeam) {
        return res.status(409).json({ error: 'This player is already on your team' });
      }
    }

    const token = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const result = await db.prepare(
      'INSERT INTO team_invites (team_id, player_email, player_user_id, token, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(team.id, normalizedEmail, playerUser?.id || null, token, 'pending', expiresAt.toISOString());

    const coach = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
    try {
      await sendTeamInviteEmail(normalizedEmail, token, coach?.full_name, team.team_name, team.school_name);
    } catch (emailErr) {
      console.error('Failed to send team invite email:', emailErr.message);
    }

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Coach send invite error:', error);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// Coach: List all invites for this team
app.get('/api/coach/invites', requireCoach, async (req, res) => {
  try {
    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const invites = await db.prepare(
      'SELECT id, player_email, player_user_id, status, sent_at, expires_at FROM team_invites WHERE team_id = ? ORDER BY sent_at DESC'
    ).all(team.id);
    res.json(invites);
  } catch (error) {
    console.error('Coach get invites error:', error);
    res.status(500).json({ error: 'Failed to get invites' });
  }
});

// Coach: Cancel/delete an invite
app.delete('/api/coach/invites/:id', requireCoach, async (req, res) => {
  try {
    const inviteId = parseInt(req.params.id, 10);
    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const invite = await db.prepare('SELECT id FROM team_invites WHERE id = ? AND team_id = ?').get(inviteId, team.id);
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    await db.prepare('DELETE FROM team_invites WHERE id = ?').run(inviteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach delete invite error:', error);
    res.status(500).json({ error: 'Failed to cancel invite' });
  }
});

// Coach: Get own profile
app.get('/api/coach/profile', requireCoach, async (req, res) => {
  try {
    const coach = await db.prepare('SELECT email, full_name, phone, organization FROM users WHERE id = ?').get(req.session.userId);
    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    const team = await db.prepare('SELECT team_name, school_name, city, state FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    res.json({ ...coach, team: team || {} });
  } catch (error) {
    console.error('Coach get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Coach: Update own profile
app.post('/api/coach/profile', requireCoach, async (req, res) => {
  try {
    const { fullName, phone, teamName, schoolName, city, state } = req.body;
    await db.prepare('UPDATE users SET full_name = ?, phone = ? WHERE id = ?')
      .run(fullName?.trim() || null, phone?.trim() || null, req.session.userId);
    if (teamName && teamName.trim()) {
      await db.prepare('UPDATE hs_teams SET team_name = ?, school_name = ?, city = ?, state = ? WHERE coach_id = ?')
        .run(teamName.trim(), schoolName?.trim() || null, city?.trim() || null, state?.trim() || null, req.session.userId);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Coach update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Coach: Change password
app.post('/api/coach/change-password', requireCoach, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const coach = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!coach || !(await bcrypt.compare(currentPassword, coach.password))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Player: Get pending team invites for the logged-in player
app.get('/api/player/team-invites', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'player') return res.status(403).json({ error: 'Forbidden' });
    const player = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    // Match by player_user_id (already linked) OR by email (not yet linked)
    const invites = await db.prepare(`
      SELECT ti.id, ti.token, ti.status, ti.sent_at, ti.expires_at,
        ht.team_name, ht.school_name, ht.city, ht.state,
        u.full_name AS coach_name
      FROM team_invites ti
      JOIN hs_teams ht ON ht.id = ti.team_id
      JOIN users u ON u.id = ht.coach_id
      WHERE ti.status = 'pending'
        AND ti.expires_at > CURRENT_TIMESTAMP
        AND (ti.player_user_id = ? OR LOWER(ti.player_email) = LOWER(?))
      ORDER BY ti.sent_at DESC
    `).all(req.session.userId, player.email);
    res.json(invites);
  } catch (error) {
    console.error('Player get team invites error:', error);
    res.status(500).json({ error: 'Failed to get invites' });
  }
});

// Player: Accept a team invite
app.post('/api/player/team-invites/:id/accept', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'player') return res.status(403).json({ error: 'Forbidden' });
    const inviteId = parseInt(req.params.id, 10);
    const player = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
    const invite = await db.prepare(`
      SELECT ti.* FROM team_invites ti
      JOIN hs_teams ht ON ht.id = ti.team_id
      WHERE ti.id = ? AND ti.status = 'pending'
        AND ti.expires_at > CURRENT_TIMESTAMP
        AND (ti.player_user_id = ? OR LOWER(ti.player_email) = LOWER(?))
    `).get(inviteId, req.session.userId, player.email);
    if (!invite) return res.status(404).json({ error: 'Invite not found or expired' });

    // Add to team_players (ignore duplicate)
    await db.prepare(
      'INSERT INTO team_players (team_id, player_id) VALUES (?, ?) ON CONFLICT (team_id, player_id) DO NOTHING'
    ).run(invite.team_id, req.session.userId);

    // Mark invite accepted and link player_user_id
    await db.prepare(
      "UPDATE team_invites SET status = 'accepted', player_user_id = ? WHERE id = ?"
    ).run(req.session.userId, invite.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Player accept invite error:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// Player: Decline a team invite
app.post('/api/player/team-invites/:id/decline', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'player') return res.status(403).json({ error: 'Forbidden' });
    const inviteId = parseInt(req.params.id, 10);
    const player = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
    const invite = await db.prepare(`
      SELECT ti.id FROM team_invites ti
      WHERE ti.id = ? AND ti.status = 'pending'
        AND (ti.player_user_id = ? OR LOWER(ti.player_email) = LOWER(?))
    `).get(inviteId, req.session.userId, player.email);
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    await db.prepare("UPDATE team_invites SET status = 'declined', player_user_id = ? WHERE id = ?").run(req.session.userId, invite.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Player decline invite error:', error);
    res.status(500).json({ error: 'Failed to decline invite' });
  }
});

// Public: Accept invite via token (for email link click)
app.get('/api/team-invites/accept', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'player') {
      return res.redirect('/player-profile.html?inviteError=notPlayer');
    }
    const { token } = req.query;
    if (!token || typeof token !== 'string' || !/^[0-9a-f]{96}$/.test(token)) {
      return res.redirect('/player-profile.html?inviteError=invalid');
    }
    const player = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
    const invite = await db.prepare(`
      SELECT ti.* FROM team_invites ti
      WHERE ti.token = ? AND ti.status = 'pending' AND ti.expires_at > CURRENT_TIMESTAMP
        AND (ti.player_user_id = ? OR LOWER(ti.player_email) = LOWER(?))
    `).get(token, req.session.userId, player.email);
    if (!invite) {
      return res.redirect('/player-profile.html?inviteError=invalidOrExpired');
    }
    await db.prepare(
      'INSERT INTO team_players (team_id, player_id) VALUES (?, ?) ON CONFLICT (team_id, player_id) DO NOTHING'
    ).run(invite.team_id, req.session.userId);
    await db.prepare("UPDATE team_invites SET status = 'accepted', player_user_id = ? WHERE id = ?").run(req.session.userId, invite.id);
    res.redirect('/player-profile.html?inviteAccepted=1');
  } catch (error) {
    console.error('Accept invite via token error:', error);
    res.redirect('/player-profile.html?inviteError=error');
  }
});

// ============================================================
// Admin: Coach management
// ============================================================

// Admin: List all coaches with team info
app.get('/api/admin/coaches', requireAdmin, async (req, res) => {
  try {
    const coaches = await db.prepare(`
      SELECT u.id, u.email, u.full_name, u.phone, u.created_at, u.last_login_at, u.login_count,
        ht.id AS team_id, ht.team_name, ht.school_name, ht.city, ht.state,
        (SELECT COUNT(*) FROM team_players tp WHERE tp.team_id = ht.id) AS roster_count,
        (SELECT COUNT(*) FROM team_invites ti WHERE ti.team_id = ht.id AND ti.status = 'pending') AS pending_invites
      FROM users u
      LEFT JOIN hs_teams ht ON ht.coach_id = u.id
      WHERE u.role = 'coach'
      ORDER BY u.created_at DESC
    `).all();
    res.json(coaches);
  } catch (error) {
    console.error('Admin list coaches error:', error);
    res.status(500).json({ error: 'Failed to get coaches' });
  }
});

// Admin: Update own profile
// Admin: Get own profile
app.get('/api/admin/profile', requireAdmin, async (req, res) => {
  try {
    const admin = await db.prepare('SELECT email, full_name, phone, organization, title, experience, bio, profile_picture, last_login_at FROM users WHERE id = ?').get(req.session.userId);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json(admin);
  } catch (error) {
    console.error('Admin get own profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});
app.post('/api/admin/profile', requireAdmin, upload.fields([
  { name: 'profilePicture', maxCount: 1 }
]), async (req, res) => {
  const { fullName, email, phone, organization, title, experience, bio } = req.body;
  const files = req.files;
  try {
    await processUploadedFiles(req.session.userId, files);
    const existingAdmin = await db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.session.userId);
    let profilePicFilename = existingAdmin?.profile_picture || null;
    if (files && files.profilePicture && files.profilePicture[0]) {
      profilePicFilename = req.session.userId + '/' + files.profilePicture[0].filename;
    }

    await db.prepare(`UPDATE users SET full_name = ?, email = ?, phone = ?, organization = ?, title = ?, experience = ?, bio = ? WHERE id = ?`)
      .run(fullName, email, phone, organization, title, experience, bio, req.session.userId);

    if (files && files.profilePicture && files.profilePicture[0]) {
      await replaceUserFile(req.session.userId, 'profile_picture', profilePicFilename);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Admin update own profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to update profile' });
  }
});
// Admin: Get all users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.prepare(`
      SELECT u.id, u.email, u.role, u.full_name, u.phone, u.organization, u.created_at, u.last_login_at, u.login_count,
        pp.full_name as player_name, pp.high_school, pp.position, pp.graduation_year, pp.gpa
      FROM users u
      LEFT JOIN player_profiles pp ON u.id = pp.user_id
      ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Admin: Create user
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { email, password, role, full_name, phone, organization } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedFullName = String(full_name || '').trim();

  const allowedRoles = ['player', 'agent', 'admin', 'coach'];
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!allowedRoles.includes(normalizedRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const existing = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(normalizedEmail);
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const created = await db.prepare(
      'INSERT INTO users (email, password, role, full_name, phone, organization, email_verified) VALUES (?, ?, ?, ?, ?, ?, true)'
    ).run(
      normalizedEmail,
      hashedPassword,
      normalizedRole,
      normalizedFullName || null,
      String(phone || '').trim() || null,
      String(organization || '').trim() || null
    );

    const userId = created.lastInsertRowid;

    if (normalizedRole === 'player') {
      await db.prepare('INSERT INTO player_profiles (user_id, full_name) VALUES (?, ?)')
        .run(userId, normalizedFullName || normalizedEmail);
    }

    const user = await db.prepare('SELECT id, email, role, full_name, phone, organization, created_at FROM users WHERE id = ?').get(userId);
    res.status(201).json({ success: true, user });
  } catch (error) {
    console.error('Admin create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Admin: Get single user details
app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, email, role, full_name, phone, organization, title, experience, bio, created_at, last_login_at, login_count FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let profile = null;
    if (user.role === 'player') {
      profile = await db.prepare('SELECT * FROM player_profiles WHERE user_id = ?').get(user.id);
      await enrichPlayerProfile(profile);
    }
    res.json({ user, profile });
  } catch (error) {
    console.error('Admin get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Admin: Update user
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { email, full_name, role, phone, organization } = req.body;
  try {
    const existing = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    await db.prepare('UPDATE users SET email = ?, full_name = ?, role = ?, phone = ?, organization = ? WHERE id = ?')
      .run(email, full_name, role, phone || null, organization || null, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Admin: Update player profile
app.put('/api/admin/players/:id', requireAdmin, async (req, res) => {
  const { full_name, high_school, graduation_year, position, height, weight, gpa } = req.body;
  try {
    const profile = await db.prepare('SELECT user_id FROM player_profiles WHERE user_id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Player profile not found' });

    const normalizedGraduationYear = normalizeOptionalInteger(graduation_year);
    const normalizedWeight = normalizeOptionalInteger(weight);
    const normalizedGpa = normalizeOptionalFloat(gpa);

    await db.prepare(`UPDATE player_profiles SET full_name = ?, high_school = ?, graduation_year = ?, position = ?, height = ?, weight = ?, gpa = ? WHERE user_id = ?`)
      .run(
        full_name?.trim() || null,
        high_school?.trim() || null,
        normalizedGraduationYear,
        position?.trim() || null,
        height?.trim() || null,
        normalizedWeight,
        normalizedGpa,
        req.params.id
      );
    res.json({ success: true });
  } catch (error) {
    console.error('Admin update player error:', error);
    res.status(500).json({ error: 'Failed to update player profile' });
  }
});

// Admin: Delete user
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent deleting yourself
    if (user.id === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Delete related data
    await db.prepare('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?').run(user.id, user.id);
    await db.prepare('DELETE FROM agent_favorites WHERE agent_id = ? OR user_id = ?').run(user.id, user.id);
    if (user.role === 'player') {
      await db.prepare('DELETE FROM player_videos WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_images WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_video_links WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_school_interests WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_contacts WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM school_notes WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM school_contacts WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_profiles WHERE user_id = ?').run(user.id);
      // Remove user's uploads from Backblaze B2
      if (b2Enabled) {
        await deleteFromB2Prefix('uploads/' + user.id + '/');
      }
      // Remove local upload folder (legacy / non-B2 fallback)
      const userUploadDir = path.join('uploads', String(user.id));
      if (fs.existsSync(userUploadDir)) {
        fs.rmSync(userUploadDir, { recursive: true, force: true });
      }
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Admin: Reset user password
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Admin: Get site stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const totalUsers = (await db.prepare('SELECT COUNT(*) as count FROM users').get()).count;
    const totalPlayers = (await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'player'").get()).count;
    const totalAgents = (await db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'agent'").get()).count;
    const totalMessages = (await db.prepare('SELECT COUNT(*) as count FROM messages').get()).count;

    const usersActive24h = (await db.prepare("SELECT COUNT(*) as count FROM users WHERE last_login_at >= NOW() - INTERVAL '24 hours'").get()).count;
    const newUsers7d = (await db.prepare("SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '7 days'").get()).count;
    const messages7d = (await db.prepare("SELECT COUNT(*) as count FROM messages WHERE created_at >= NOW() - INTERVAL '7 days'").get()).count;
    const totalProfileViews = (await db.prepare('SELECT COALESCE(SUM(profile_view_count), 0) as count FROM player_profiles').get()).count;
    const aiSummariesGenerated = (await db.prepare('SELECT COUNT(*) as count FROM ai_player_summaries').get()).count;
    const totalTrafficEvents = (await db.prepare('SELECT COUNT(*) as count FROM site_traffic_events').get()).count;
    const pageViews24h = (await db.prepare("SELECT COUNT(*) as count FROM site_traffic_events WHERE event_type = 'page_view' AND created_at >= NOW() - INTERVAL '24 hours'").get()).count;
    const uniqueVisitors24h = (await db.prepare("SELECT COUNT(DISTINCT ip_address) as count FROM site_traffic_events WHERE created_at >= NOW() - INTERVAL '24 hours' AND ip_address IS NOT NULL AND ip_address <> ''").get()).count;

    const recentLogins = await db.prepare(`
      SELECT u.id, u.email, u.role, COALESCE(pp.full_name, u.full_name, '') AS display_name, u.last_login_at
      FROM users u
      LEFT JOIN player_profiles pp ON pp.user_id = u.id
      WHERE u.last_login_at IS NOT NULL
      ORDER BY u.last_login_at DESC
      LIMIT 8
    `).all();

    const topViewedPlayers = await db.prepare(`
      SELECT pp.user_id, pp.full_name, COALESCE(pp.profile_view_count, 0) AS profile_view_count, pp.last_viewed_at
      FROM player_profiles pp
      ORDER BY COALESCE(pp.profile_view_count, 0) DESC, pp.last_viewed_at DESC NULLS LAST
      LIMIT 8
    `).all();

    const topPages = await db.prepare(`
      SELECT COALESCE(NULLIF(path, ''), metadata_json->>'pageKey', 'unknown') AS page_path,
        COUNT(*)::int AS views
      FROM site_traffic_events
      WHERE event_type = 'page_view'
      GROUP BY COALESCE(NULLIF(path, ''), metadata_json->>'pageKey', 'unknown')
      ORDER BY views DESC, page_path ASC
      LIMIT 8
    `).all();

    const recentProfileViews = await db.prepare(`
      SELECT ste.created_at,
        ste.ip_address,
        ste.role,
        COALESCE(viewer_profile.full_name, viewer.full_name, viewer.email, 'Unknown viewer') AS viewer_name,
        COALESCE(target_profile.full_name, target_user.full_name, target_user.email, 'Unknown player') AS player_name
      FROM site_traffic_events ste
      LEFT JOIN users viewer ON viewer.id = ste.user_id
      LEFT JOIN player_profiles viewer_profile ON viewer_profile.user_id = viewer.id
      LEFT JOIN users target_user ON target_user.id = NULLIF(ste.metadata_json->>'playerUserId', '')::int
      LEFT JOIN player_profiles target_profile ON target_profile.user_id = target_user.id
      WHERE ste.event_type = 'player_profile_view'
      ORDER BY ste.created_at DESC
      LIMIT 8
    `).all();

    res.json({
      totalUsers,
      totalPlayers,
      totalAgents,
      totalMessages,
      usersActive24h,
      newUsers7d,
      messages7d,
      totalProfileViews,
      aiSummariesGenerated,
      totalTrafficEvents,
      pageViews24h,
      uniqueVisitors24h,
      recentLogins,
      topViewedPlayers,
      topPages,
      recentProfileViews
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Admin: Inspect pending Backblaze delete queue
app.get('/api/admin/b2-delete-queue', requireAdmin, async (req, res) => {
  try {
    const snapshot = getPendingB2DeleteQueueSnapshot();
    res.json(snapshot);
  } catch (error) {
    console.error('Admin B2 queue inspect error:', error);
    res.status(500).json({ error: 'Failed to inspect B2 delete queue' });
  }
});

// Admin: Force-run Backblaze delete queue immediately
app.post('/api/admin/b2-delete-queue/flush', requireAdmin, async (req, res) => {
  try {
    const maxItems = Number(req.body?.maxItems);
    const result = await processPendingB2DeleteQueue({
      force: true,
      maxItems: Number.isFinite(maxItems) && maxItems > 0 ? maxItems : Infinity
    });

    res.json({
      success: true,
      ...(result || {
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
        droppedCount: 0,
        remaining: getPendingB2DeleteQueueSnapshot().size
      })
    });
  } catch (error) {
    console.error('Admin B2 queue flush error:', error);
    res.status(500).json({ error: 'Failed to flush B2 delete queue' });
  }
});

// Admin: Get all metric pro tips
app.get('/api/admin/metric-pro-tips', requireAdmin, async (req, res) => {
  try {
    const tips = await getMetricTipsMap();
    res.json({ tips, metrics: METRIC_TIP_CONFIG });
  } catch (error) {
    console.error('Admin get metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to get metric tips' });
  }
});

// Admin: Save metric pro tips
app.put('/api/admin/metric-pro-tips', requireAdmin, async (req, res) => {
  try {
    const incomingTips = req.body?.tips;
    if (!incomingTips || typeof incomingTips !== 'object') {
      return res.status(400).json({ error: 'Invalid tips payload' });
    }

    for (const [metricKey, tipValue] of Object.entries(incomingTips)) {
      if (!METRIC_TIP_KEYS.has(metricKey)) continue;
      const tipText = (tipValue || '').toString().trim();
      await db.prepare(`
        INSERT INTO metric_pro_tips (metric_key, tip_text, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (metric_key)
        DO UPDATE SET
          tip_text = EXCLUDED.tip_text,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(metricKey, tipText, req.session.userId);
    }

    const tips = await getMetricTipsMap();
    res.json({ success: true, tips });
  } catch (error) {
    console.error('Admin save metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to save metric tips' });
  }
});

app.get('/api/admin/ad-slots', requireAdmin, async (req, res) => {
  try {
    const slots = await getAdSlotsMap();
    res.json({ slots, config: AD_SLOT_CONFIG });
  } catch (error) {
    console.error('Admin get ad slots error:', error);
    res.status(500).json({ error: 'Failed to load ad slots' });
  }
});

app.put('/api/admin/ad-slots', requireAdmin, async (req, res) => {
  try {
    const incomingSlots = req.body?.slots;
    if (!incomingSlots || typeof incomingSlots !== 'object') {
      return res.status(400).json({ error: 'Invalid ad slots payload' });
    }

    for (const [slotKey, slotValue] of Object.entries(incomingSlots)) {
      if (!AD_SLOT_KEYS.has(slotKey)) continue;
      const enabled = !!slotValue?.enabled;
      const contentHtml = (slotValue?.contentHtml || '').toString();

      await db.prepare(`
        INSERT INTO site_ad_slots (slot_key, enabled, content_html, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (slot_key)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          content_html = EXCLUDED.content_html,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(slotKey, enabled, contentHtml, req.session.userId);
    }

    const slots = await getAdSlotsMap();
    res.json({ success: true, slots, config: AD_SLOT_CONFIG });
  } catch (error) {
    console.error('Admin save ad slots error:', error);
    res.status(500).json({ error: 'Failed to save ad slots' });
  }
});

// Admin: List players for per-player metric tip overrides
app.get('/api/admin/player-metric-pro-tips/players', requireAdmin, async (req, res) => {
  try {
    const players = await db.prepare(`
      SELECT u.id AS user_id,
        COALESCE(pp.full_name, u.full_name, u.email) AS full_name,
        pp.high_school,
        pp.graduation_year,
        pp.position
      FROM users u
      LEFT JOIN player_profiles pp ON pp.user_id = u.id
      WHERE u.role = 'player'
      ORDER BY COALESCE(pp.full_name, u.full_name, u.email) ASC
    `).all();
    res.json({ players });
  } catch (error) {
    console.error('Admin list player metric tip players error:', error);
    res.status(500).json({ error: 'Failed to load players' });
  }
});

// Admin: Get default + override + merged metric tips for a player
app.get('/api/admin/player-metric-pro-tips/:playerUserId', requireAdmin, async (req, res) => {
  try {
    const playerUserId = parseInt(req.params.playerUserId, 10);
    if (!Number.isInteger(playerUserId) || playerUserId <= 0) {
      return res.status(400).json({ error: 'Invalid player ID' });
    }

    const player = await db.prepare(`
      SELECT u.id AS user_id,
        COALESCE(pp.full_name, u.full_name, u.email) AS full_name,
        pp.high_school,
        pp.graduation_year,
        pp.position,
        pp.forty_yard_dash,
        pp.vertical_jump,
        pp.bench_press,
        pp.squat,
        pp.shuttle_5_10_5,
        pp.l_drill,
        pp.broad_jump,
        pp.power_clean,
        pp.single_leg_squat
      FROM users u
      LEFT JOIN player_profiles pp ON pp.user_id = u.id
      WHERE u.id = ? AND u.role = 'player'
      LIMIT 1
    `).get(playerUserId);

    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const tips = await getMergedMetricTipsForPlayer(playerUserId);
    res.json({
      player,
      metrics: METRIC_TIP_CONFIG,
      defaults: tips.defaults,
      overrides: tips.overrides,
      tips: tips.merged
    });
  } catch (error) {
    console.error('Admin get player metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to load player metric tips' });
  }
});

// Admin: Save metric tip overrides for a player
app.put('/api/admin/player-metric-pro-tips/:playerUserId', requireAdmin, async (req, res) => {
  try {
    const playerUserId = parseInt(req.params.playerUserId, 10);
    if (!Number.isInteger(playerUserId) || playerUserId <= 0) {
      return res.status(400).json({ error: 'Invalid player ID' });
    }

    const playerExists = await db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(playerUserId, 'player');
    if (!playerExists) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const incomingTips = req.body?.tips;
    if (!incomingTips || typeof incomingTips !== 'object') {
      return res.status(400).json({ error: 'Invalid tips payload' });
    }

    for (const [metricKey, tipValue] of Object.entries(incomingTips)) {
      if (!METRIC_TIP_KEYS.has(metricKey)) continue;
      const tipText = (tipValue || '').toString().trim();
      if (!tipText) {
        await db.prepare(
          'DELETE FROM player_metric_pro_tips WHERE player_user_id = ? AND metric_key = ?'
        ).run(playerUserId, metricKey);
        continue;
      }

      await db.prepare(`
        INSERT INTO player_metric_pro_tips (player_user_id, metric_key, tip_text, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (player_user_id, metric_key)
        DO UPDATE SET
          tip_text = EXCLUDED.tip_text,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(playerUserId, metricKey, tipText, req.session.userId);
    }

    const tips = await getMergedMetricTipsForPlayer(playerUserId);
    res.json({ success: true, metrics: METRIC_TIP_CONFIG, overrides: tips.overrides, tips: tips.merged });
  } catch (error) {
    console.error('Admin save player metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to save player metric tips' });
  }
});

// Admin: College Management - List all colleges
app.get('/api/admin/colleges', requireAdmin, async (req, res) => {
  try {
    const colleges = await db.prepare('SELECT * FROM colleges ORDER BY name ASC').all();
    res.json(colleges);
  } catch (error) {
    console.error('Admin get colleges error:', error);
    res.status(500).json({ error: 'Failed to get colleges' });
  }
});

// Admin: Add a college
app.post('/api/admin/colleges', requireAdmin, collegeLogoUpload.fields([
  { name: 'logo', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, website_url, conference, team } = req.body;
    if (!name) return res.status(400).json({ error: 'College name is required' });

    const logo = req.files?.logo ? 'images/collegelogos/' + req.files.logo[0].filename : null;
    const result = await db.prepare('INSERT INTO colleges (name, website_url, logo, conference, team) VALUES (?, ?, ?, ?, ?)')
      .run(name, website_url || null, logo, conference || null, team || null);
    
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Admin add college error:', error);
    res.status(500).json({ error: 'Failed to add college' });
  }
});

// Admin: Update a college
app.put('/api/admin/colleges/:id', requireAdmin, collegeLogoUpload.fields([
  { name: 'logo', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, website_url, conference, team } = req.body;
    if (!name) return res.status(400).json({ error: 'College name is required' });

    if (req.files?.logo) {
      // Delete old logo file
      const old = await db.prepare('SELECT logo FROM colleges WHERE id = ?').get(req.params.id);
      if (old && old.logo) {
        const oldPath = path.resolve(old.logo);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      await db.prepare('UPDATE colleges SET name = ?, website_url = ?, logo = ?, conference = ?, team = ? WHERE id = ?')
        .run(name, website_url || null, 'images/collegelogos/' + req.files.logo[0].filename, conference || null, team || null, req.params.id);
    } else {
      await db.prepare('UPDATE colleges SET name = ?, website_url = ?, conference = ?, team = ? WHERE id = ?')
        .run(name, website_url || null, conference || null, team || null, req.params.id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Admin update college error:', error);
    res.status(500).json({ error: 'Failed to update college' });
  }
});

// Admin: Delete a college
app.delete('/api/admin/colleges/:id', requireAdmin, async (req, res) => {
  try {
    const college = await db.prepare('SELECT logo FROM colleges WHERE id = ?').get(req.params.id);
    if (college && college.logo) {
      const logoPath = path.resolve(college.logo);
      if (fs.existsSync(logoPath)) fs.unlinkSync(logoPath);
    }
    await db.prepare('DELETE FROM colleges WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete college error:', error);
    res.status(500).json({ error: 'Failed to delete college' });
  }
});

// Send player card image via email
app.post('/api/send-player-card', requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { recipientEmail, subject, message, imageData, playerName } = req.body;

    if (!recipientEmail || !imageData) {
      return res.status(400).json({ error: 'Recipient email and image are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Get sender info
    const sender = await db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(req.session.userId);

    // Extract base64 data from data URL
    const base64Data = imageData.replace(/^data:image\/png;base64,/, '');

    // Configure transporter - uses local SMTP or can be configured for external service
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    });

    const safeName = (playerName || 'Player').replace(/[^a-zA-Z0-9_ ]/g, '');

    await transporter.sendMail({
      from: process.env.SMTP_FROM || sender.email,
      to: recipientEmail,
      subject: subject || `${safeName} - Player Card`,
      text: message || `Please see the attached player card for ${safeName}.`,
      html: `<p>${message || `Please see the attached player card for ${safeName}.`}</p><p>Sent via Gridiron Elite</p>`,
      attachments: [{
        filename: `${safeName.replace(/\s+/g, '_')}_Player_Card.png`,
        content: base64Data,
        encoding: 'base64',
        cid: 'playercard'
      }]
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send email. Please check SMTP configuration.' });
  }
});

// Player: Get all colleges (read-only, for players)
app.get('/api/player/colleges', requireAuth, async (req, res) => {
  try {
    const colleges = await db.prepare('SELECT * FROM colleges ORDER BY name ASC').all();
    // Get this player's interests
    const interests = await db.prepare('SELECT college_id, is_favorite, has_offer FROM player_school_interests WHERE user_id = ?').all(req.session.userId);
    const interestMap = {};
    interests.forEach(i => { interestMap[i.college_id] = { is_favorite: i.is_favorite, has_offer: i.has_offer }; });
    const result = colleges.map(c => ({
      ...c,
      is_favorite: interestMap[c.id]?.is_favorite || 0,
      has_offer: interestMap[c.id]?.has_offer || 0
    }));
    res.json(result);
  } catch (error) {
    console.error('Player get colleges error:', error);
    res.status(500).json({ error: 'Failed to get colleges' });
  }
});

// Player: Toggle favorite on a college
app.post('/api/player/colleges/:collegeId/favorite', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const existing = await db.prepare('SELECT id, is_favorite FROM player_school_interests WHERE user_id = ? AND college_id = ?').get(req.session.userId, collegeId);
    if (existing) {
      const newVal = existing.is_favorite ? 0 : 1;
      await db.prepare('UPDATE player_school_interests SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, existing.id);
      res.json({ is_favorite: newVal });
    } else {
      await db.prepare('INSERT INTO player_school_interests (user_id, college_id, is_favorite) VALUES (?, ?, 1)').run(req.session.userId, collegeId);
      res.json({ is_favorite: 1 });
    }
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Player: Toggle offer on a college
app.post('/api/player/colleges/:collegeId/offer', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const existing = await db.prepare('SELECT id, has_offer FROM player_school_interests WHERE user_id = ? AND college_id = ?').get(req.session.userId, collegeId);
    if (existing) {
      const newVal = existing.has_offer ? 0 : 1;
      await db.prepare('UPDATE player_school_interests SET has_offer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, existing.id);
      res.json({ has_offer: newVal });
    } else {
      await db.prepare('INSERT INTO player_school_interests (user_id, college_id, has_offer) VALUES (?, ?, 1)').run(req.session.userId, collegeId);
      res.json({ has_offer: 1 });
    }
  } catch (error) {
    console.error('Toggle offer error:', error);
    res.status(500).json({ error: 'Failed to toggle offer' });
  }
});

// Player: Save college logo order
app.post('/api/player/college-logo-order', requireAuth, express.json(), async (req, res) => {
  try {
    const { orderData } = req.body;
    if (!orderData || typeof orderData !== 'object') {
      return res.status(400).json({ error: 'orderData must be an object' });
    }
    
    // Use $1::jsonb cast for proper JSONB handling with parameterized query
    const query = `UPDATE player_profiles SET college_logo_order = $1::jsonb WHERE user_id = $2`;
    await db.prepare(query).run(orderData, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Save college logo order error:', error);
    res.status(500).json({ error: 'Failed to save college logo order' });
  }
});

// ======== School Notes & Contacts ========

// Player: Get notes for a specific college
app.get('/api/player/colleges/:collegeId/notes', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const notes = await db.prepare(
      `SELECT *
       FROM school_notes
       WHERE user_id = ? AND college_id = ?
       ORDER BY
         COALESCE(
           CASE
             WHEN visit_date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN visit_date::date
             ELSE NULL
           END,
           created_at::date
         ) DESC,
         created_at DESC`
    ).all(req.session.userId, collegeId);
    res.json(notes);
  } catch (error) {
    console.error('Get school notes error:', error);
    res.status(500).json({ error: 'Failed to get notes' });
  }
});

// Player: Add a note for a college
app.post('/api/player/colleges/:collegeId/notes', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });

    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const result = await db.prepare(
      'INSERT INTO school_notes (user_id, college_id, note, visit_date) VALUES (?, ?, ?, ?)'
    ).run(req.session.userId, collegeId, note.trim(), visitDate || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add school note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Player: Update a note
app.put('/api/player/colleges/:collegeId/notes/:noteId', requireAuth, async (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });

    const existing = await db.prepare('SELECT id FROM school_notes WHERE id = ? AND user_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    await db.prepare('UPDATE school_notes SET note = ?, visit_date = ? WHERE id = ?').run(note.trim(), visitDate || null, noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Update school note error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Player: Delete a note
app.delete('/api/player/colleges/:collegeId/notes/:noteId', requireAuth, async (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });

    const existing = await db.prepare('SELECT id FROM school_notes WHERE id = ? AND user_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    await db.prepare('DELETE FROM school_notes WHERE id = ?').run(noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete school note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Player: Get contacts for a specific college
app.get('/api/player/colleges/:collegeId/contacts', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const contacts = await db.prepare(
      'SELECT * FROM school_contacts WHERE user_id = ? AND college_id = ? ORDER BY name ASC'
    ).all(req.session.userId, collegeId);
    res.json(contacts);
  } catch (error) {
    console.error('Get school contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Player: Add a contact for a college
app.post('/api/player/colleges/:collegeId/contacts', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { name, title, email, phone, twitterHandle, followsPlayerOnTwitter, instagramHandle, followsPlayerOnInstagram } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const result = await db.prepare(
      'INSERT INTO school_contacts (user_id, college_id, name, title, email, phone, twitter_handle, follows_player_on_twitter, instagram_handle, follows_player_on_instagram) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      req.session.userId,
      collegeId,
      name.trim(),
      title?.trim() || null,
      email?.trim() || null,
      phone?.trim() || null,
      twitterHandle?.trim() || null,
      !!followsPlayerOnTwitter,
      instagramHandle?.trim() || null,
      !!followsPlayerOnInstagram
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add school contact error:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// Player: Update a contact
app.put('/api/player/colleges/:collegeId/contacts/:contactId', requireAuth, async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
    const { name, title, email, phone, twitterHandle, followsPlayerOnTwitter, instagramHandle, followsPlayerOnInstagram } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const existing = await db.prepare('SELECT id FROM school_contacts WHERE id = ? AND user_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    await db.prepare('UPDATE school_contacts SET name = ?, title = ?, email = ?, phone = ?, twitter_handle = ?, follows_player_on_twitter = ?, instagram_handle = ?, follows_player_on_instagram = ? WHERE id = ?')
      .run(
        name.trim(),
        title?.trim() || null,
        email?.trim() || null,
        phone?.trim() || null,
        twitterHandle?.trim() || null,
        !!followsPlayerOnTwitter,
        instagramHandle?.trim() || null,
        !!followsPlayerOnInstagram,
        contactId
      );
    res.json({ success: true });
  } catch (error) {
    console.error('Update school contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Player: Delete a contact
app.delete('/api/player/colleges/:collegeId/contacts/:contactId', requireAuth, async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });

    const existing = await db.prepare('SELECT id FROM school_contacts WHERE id = ? AND user_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    await db.prepare('DELETE FROM school_contacts WHERE id = ?').run(contactId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete school contact error:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// AI: Get cached player scouting summary
app.get('/api/ai/player/:playerUserId/summary', requireAuth, async (req, res) => {
  try {
    const playerUserId = parseAiPlayerId(req.params.playerUserId);
    if (!playerUserId) return res.status(400).json({ error: 'Invalid player user ID' });

    if (!(await canAccessPlayerSummary(req, playerUserId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const audience = normalizeAudience(req.query.audience);
    const sourceBundle = await loadPlayerSummarySourceBundle(playerUserId);
    if (!sourceBundle) return res.status(404).json({ error: 'Player not found' });

    const sourceHash = buildSourceHash(sourceBundle);
    const cached = await getCachedAiSummary(playerUserId, audience, sourceHash);
    if (!cached) {
      await logAiEvent({
        eventType: 'summary_cache_miss',
        actorUserId: req.session.userId,
        playerUserId,
        metadata: { audience, sourceHash }
      });
      return res.status(404).json({
        error: 'No cached summary for current profile data',
        canGenerate: isAiGenerationEnabled(),
        sourceHash
      });
    }

    await logAiEvent({
      eventType: 'summary_cache_hit',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId: cached.id,
      metadata: { audience, sourceHash, promptVersion: cached.prompt_version, modelName: cached.model_name }
    });

    await logAiEvent({
      eventType: 'summary_viewed',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId: cached.id,
      metadata: { audience }
    });

    res.json({ ...mapSummaryRow(cached), cached: true });
  } catch (error) {
    console.error('AI summary get error:', error);
    res.status(500).json({ error: 'Failed to fetch AI summary' });
  }
});

// AI: Generate or refresh player scouting summary
app.post('/api/ai/player/:playerUserId/summary/generate', requireAuth, async (req, res) => {
  try {
    if (!isAiGenerationEnabled()) {
      return res.status(503).json({ error: 'AI summary generation is disabled' });
    }

    const playerUserId = parseAiPlayerId(req.params.playerUserId);
    if (!playerUserId) return res.status(400).json({ error: 'Invalid player user ID' });

    if (!(await canAccessPlayerSummary(req, playerUserId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const audience = normalizeAudience(req.body?.audience);
    const forceRegenerate = !!req.body?.forceRegenerate;

    if (req.session.role !== 'admin' && isAiGenerationRateLimited(req.session.userId, playerUserId)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again shortly.' });
    }

    const sourceBundle = await loadPlayerSummarySourceBundle(playerUserId);
    if (!sourceBundle) return res.status(404).json({ error: 'Player not found' });
    const sourceHash = buildSourceHash(sourceBundle);

    const cached = await getCachedAiSummary(playerUserId, audience, sourceHash);
    if (cached && !forceRegenerate) {
      await logAiEvent({
        eventType: 'summary_cache_hit',
        actorUserId: req.session.userId,
        playerUserId,
        summaryId: cached.id,
        metadata: { audience, sourceHash, path: 'generate' }
      });
      return res.json({ ...mapSummaryRow(cached), cached: true });
    }

    const startMs = Date.now();
    const generated = await generateScoutingSummary({ player: sourceBundle, audience });
    const saved = await saveAiSummary({
      playerUserId,
      generatedForUserId: req.session.userId,
      audience,
      sourceHash,
      modelName: generated.modelName,
      summaryText: generated.summaryText,
      strengths: generated.strengths,
      improvementAreas: generated.improvementAreas,
      confidenceScore: generated.confidenceScore,
      safetyFlags: generated.safetyFlags
    });

    await logAiEvent({
      eventType: 'summary_generated',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId: saved.id,
      metadata: {
        audience,
        sourceHash,
        modelName: generated.modelName,
        promptVersion: generated.promptVersion,
        latencyMs: Date.now() - startMs,
        forceRegenerate
      }
    });

    res.json({ ...mapSummaryRow(saved), cached: false });
  } catch (error) {
    console.error('AI summary generate error:', error);
    await logAiEvent({
      eventType: 'summary_generation_failed',
      actorUserId: req.session?.userId || null,
      playerUserId: parseAiPlayerId(req.params.playerUserId),
      metadata: { message: error.message || 'unknown-error' }
    });
    res.status(500).json({ error: 'Failed to generate AI summary' });
  }
});

// AI: Summary feedback
app.post('/api/ai/player/:playerUserId/summary/:summaryId/feedback', requireAuth, async (req, res) => {
  try {
    const playerUserId = parseAiPlayerId(req.params.playerUserId);
    const summaryId = parseInt(req.params.summaryId, 10);
    if (!playerUserId || !Number.isInteger(summaryId) || summaryId <= 0) {
      return res.status(400).json({ error: 'Invalid player or summary ID' });
    }

    if (!(await canAccessPlayerSummary(req, playerUserId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const rating = String(req.body?.rating || '').toLowerCase();
    const reason = String(req.body?.reason || '').trim().slice(0, 240);
    if (rating !== 'up' && rating !== 'down') {
      return res.status(400).json({ error: 'rating must be up or down' });
    }

    const summary = await db.prepare('SELECT id, player_user_id FROM ai_player_summaries WHERE id = ?').get(summaryId);
    if (!summary || summary.player_user_id !== playerUserId) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    await logAiEvent({
      eventType: rating === 'up' ? 'summary_feedback_up' : 'summary_feedback_down',
      actorUserId: req.session.userId,
      playerUserId,
      summaryId,
      metadata: { reason }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('AI summary feedback error:', error);
    res.status(500).json({ error: 'Failed to submit summary feedback' });
  }
});

// Centralized upload error handling so clients see actionable errors.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'highlightVideos') {
      return res.status(400).json({ error: 'Please upload only one highlight video at a time.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `Unexpected upload field: ${err.field || 'unknown'}` });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'A file is too large. Max size is 50MB per file.' });
    }
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }

  if (err?.message === 'Invalid file type. Only images and videos are allowed.') {
    return res.status(400).json({ error: err.message });
  }

  return next(err);
});

async function initializeAndStart() {
  try {
    await db.initialize();
    await migrateUploads();
    console.log(`[ai] feature=${isAiGenerationEnabled() ? 'enabled' : 'disabled'} provider=${getActiveAiProviderName()} model=${getActiveAiModelName()}`);
    app.listen(process.env.PORT || PORT, () => {
      console.log(`Server running on ${process.env.PORT ? 'iisnode' : 'http://localhost:' + PORT}`);
    });
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

initializeAndStart();
