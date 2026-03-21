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

const PROFILE_UPLOAD_FIELD_MAX_COUNTS = {
  profilePicture: 1,
  cardPhoto: 1,
  reportCardImage: 1,
  highlightVideos: 5,
  additionalImages: 10,
  ...Object.fromEntries(METRIC_VIDEO_CONFIG.map(config => [config.fieldName, 1]))
};

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

async function deleteUploadFile(filename) {
  if (!filename) return false;
  const normalizedFilename = normalizeUploadFilename(filename);

  let deletedInB2 = false;
  // Delete from Backblaze B2 using normalized and legacy key shapes.
  if (b2Enabled) {
    deletedInB2 = await deleteFromB2('uploads/' + normalizedFilename);
    if (!deletedInB2 && normalizedFilename.startsWith('uploads/')) {
      deletedInB2 = await deleteFromB2(normalizedFilename);
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
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
  res.json({ ok: true, service: 'gridiron-elite', uptimeSec: Math.round(process.uptime()) });
});

app.get('/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');

    const b2 = await checkB2Health();
    if (b2Enabled && !b2.ok) {
      return res.status(503).json({ ok: false, db: 'ok', b2: 'error', reason: b2.reason || 'b2-not-ready' });
    }

    res.json({ ok: true, db: 'ok', b2: b2Enabled ? 'ok' : 'disabled' });
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

  const offerSchools = await db.prepare(`SELECT c.id, c.name, c.logo, c.conference, c.team FROM player_school_interests psi JOIN colleges c ON psi.college_id = c.id WHERE psi.user_id = ? AND psi.has_offer = 1 ORDER BY c.name`).all(playerId);
  profile.college_offer_schools = offerSchools.length > 0 ? JSON.stringify(offerSchools) : null;

  const favoriteSchools = await db.prepare(`SELECT c.id, c.name, c.logo, c.conference, c.team FROM player_school_interests psi JOIN colleges c ON psi.college_id = c.id WHERE psi.user_id = ? AND psi.is_favorite = 1 AND (psi.has_offer = 0 OR psi.has_offer IS NULL) ORDER BY c.name`).all(playerId);
  profile.college_favorite_schools = favoriteSchools.length > 0 ? JSON.stringify(favoriteSchools) : null;

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
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const result = await db.prepare(
      'INSERT INTO users (email, password, role, email_verified, email_verification_token) VALUES (?, ?, ?, false, ?)'
    ).run(email, hashedPassword, role, verificationToken);

    if (role === 'player') {
      await db.prepare('INSERT INTO player_profiles (user_id, full_name) VALUES (?, ?)').run(result.lastInsertRowid, fullName);
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

  req.session.userId = user.id;
  req.session.role = user.role;
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
        broad_jump = ?, power_clean = ?, single_leg_squat = ?, gpa = ?, bio = ?,
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
app.get('/api/agent/players', requireAuth, async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  // Disable caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  let query = 'SELECT * FROM player_profiles WHERE 1=1';
  const params = [];
  
  // Filter by favorites only
  if (req.query.favoritesOnly === 'true') {
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

// Agent: Get single player detail
app.get('/api/agent/player/:id', requireAuth, async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  // Disable caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  const player = await db.prepare('SELECT pp.*, u.email FROM player_profiles pp JOIN users u ON pp.user_id = u.id WHERE pp.user_id = ?').get(req.params.id);
  
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  
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
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
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
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  try {
    await db.prepare('DELETE FROM agent_favorites WHERE agent_id = ? AND user_id = ?').run(req.session.userId, req.params.playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

// Agent: Get all favorite player IDs
app.get('/api/agent/favorites', requireAuth, async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  try {
    const favorites = await db.prepare('SELECT user_id FROM agent_favorites WHERE agent_id = ?').all(req.session.userId);
    res.json(favorites.map(f => f.user_id));
  } catch (error) {
    console.error('Error getting favorites:', error);
    res.status(500).json({ error: 'Failed to get favorites' });
  }
});

// Agent: Check if player is favorited
app.get('/api/agent/favorites/:playerId', requireAuth, async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
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

// Admin: Update own profile
// Admin: Get own profile
app.get('/api/admin/profile', requireAdmin, async (req, res) => {
  try {
    const admin = await db.prepare('SELECT email, full_name, phone, organization, title, experience, bio FROM users WHERE id = ?').get(req.session.userId);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json(admin);
  } catch (error) {
    console.error('Admin get own profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});
app.post('/api/admin/profile', requireAdmin, async (req, res) => {
  const { fullName, email, phone, organization, title, experience, bio } = req.body;
  try {
    await db.prepare(`UPDATE users SET full_name = ?, email = ?, phone = ?, organization = ?, title = ?, experience = ?, bio = ? WHERE id = ?`)
      .run(fullName, email, phone, organization, title, experience, bio, req.session.userId);
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
      SELECT u.id, u.email, u.role, u.full_name, u.phone, u.organization, u.created_at,
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

// Admin: Get single user details
app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, email, role, full_name, phone, organization, title, experience, bio, created_at FROM users WHERE id = ?').get(req.params.id);
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
    res.json({ totalUsers, totalPlayers, totalAgents, totalMessages });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
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

// ======== School Notes & Contacts ========

// Player: Get notes for a specific college
app.get('/api/player/colleges/:collegeId/notes', requireAuth, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const notes = await db.prepare(
      'SELECT * FROM school_notes WHERE user_id = ? AND college_id = ? ORDER BY COALESCE(visit_date, created_at) DESC'
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
    const { name, title, email, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const result = await db.prepare(
      'INSERT INTO school_contacts (user_id, college_id, name, title, email, phone) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.session.userId, collegeId, name.trim(), title?.trim() || null, email?.trim() || null, phone?.trim() || null);
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
    const { name, title, email, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const existing = await db.prepare('SELECT id FROM school_contacts WHERE id = ? AND user_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    await db.prepare('UPDATE school_contacts SET name = ?, title = ?, email = ?, phone = ? WHERE id = ?')
      .run(name.trim(), title?.trim() || null, email?.trim() || null, phone?.trim() || null, contactId);
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
    app.listen(process.env.PORT || PORT, () => {
      console.log(`Server running on ${process.env.PORT ? 'iisnode' : 'http://localhost:' + PORT}`);
    });
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

initializeAndStart();
