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
require('express-async-errors');

const compression = require('compression');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const { Readable } = require('stream');
const db = require('./database');
const { b2Enabled, getB2Url, checkB2Health } = require('./backblaze');
const { isAiGenerationEnabled, getActiveAiProviderName, getActiveAiModelName } = require('./utils/ai-helpers');
const { safeUploadPath, normalizeUploadFilename } = require('./utils/upload');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Fail fast if critical environment variables are missing.
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is not set. Set it to a long random string before starting the server.');
  process.exit(1);
}

// Needed for correct secure-cookie handling behind IIS/reverse proxies.
app.set('trust proxy', 1);

// Security headers (helmet).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false // allow images/videos from external CDNs
}));

// Global rate limiter – broad throttle per IP across all routes.
// Per-endpoint limiters (login, forgot-password, etc.) apply stricter limits on top.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,            // 300 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: (req) => req.path === '/health' || req.path === '/ready'
});
app.use(globalLimiter);

// Compress all text-based responses (JSON, HTML, CSS, JS).
app.use(compression());

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureRuntimeDirectories() {
  await Promise.all([
    fsPromises.mkdir('uploads', { recursive: true }),
    fsPromises.mkdir(path.join('images', 'collegelogos'), { recursive: true })
  ]);
}

// Migrate existing flat uploads into per-user folders.
// Guard: skip entirely if no un-migrated filenames remain (no '/' in path).
async function migrateUploads() {
  try {
    const [pp, pv, pi, pmv] = await Promise.all([
      db.prepare("SELECT 1 FROM player_profiles WHERE (profile_picture IS NOT NULL AND profile_picture NOT LIKE '%/%') OR (card_photo IS NOT NULL AND card_photo NOT LIKE '%/%') OR (report_card_image IS NOT NULL AND report_card_image NOT LIKE '%/%') LIMIT 1").get(),
      db.prepare("SELECT 1 FROM player_videos WHERE filename NOT LIKE '%/%' LIMIT 1").get(),
      db.prepare("SELECT 1 FROM player_images WHERE filename NOT LIKE '%/%' LIMIT 1").get(),
      db.prepare("SELECT 1 FROM player_metric_videos WHERE video_filename IS NOT NULL AND video_filename NOT LIKE '%/%' LIMIT 1").get(),
    ]);

    if (!pp && !pv && !pi && !pmv) {
      console.log('Upload migration: nothing to migrate, skipping.');
      return;
    }

    // Migrate profile_picture, card_photo, and report_card_image
    const profiles = await db.prepare('SELECT user_id, profile_picture, card_photo, report_card_image FROM player_profiles').all();
    for (const p of profiles) {
      for (const col of ['profile_picture', 'card_photo', 'report_card_image']) {
        const filename = p[col];
        if (filename && !filename.includes('/')) {
          const src = path.join('uploads', filename);
          const userDir = path.join('uploads', String(p.user_id));
          const dest = path.join(userDir, filename);
          if (await pathExists(src)) {
            await fsPromises.mkdir(userDir, { recursive: true });
            await fsPromises.rename(src, dest);
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
        if (await pathExists(src)) {
          await fsPromises.mkdir(userDir, { recursive: true });
          await fsPromises.rename(src, dest);
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
        if (await pathExists(src)) {
          await fsPromises.mkdir(userDir, { recursive: true });
          await fsPromises.rename(src, dest);
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
        if (await pathExists(src)) {
          await fsPromises.mkdir(userDir, { recursive: true });
          await fsPromises.rename(src, dest);
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
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.SESSION_COOKIE_SECURE === 'true' ? true : 'auto',
    sameSite: 'lax'
  }
}));

app.get('/api/upload-proxy', async (req, res) => {
  try {
    const requestedPath = normalizeUploadFilename(req.query.path || '');
    if (!requestedPath) {
      return res.status(400).send('Missing upload path');
    }

    if (b2Enabled) {
      const objectKey = 'uploads/' + requestedPath;
      const upstream = await fetch(getB2Url(objectKey));
      if (upstream.ok) {
        const contentType = upstream.headers.get('content-type');
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        const contentLength = upstream.headers.get('content-length');
        if (contentLength) {
          res.setHeader('Content-Length', contentLength);
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');

        const upstreamBody = upstream.body;
        if (!upstreamBody) {
          return res.status(502).send('File stream unavailable');
        }

        if (typeof upstreamBody.pipe === 'function') {
          upstreamBody.pipe(res);
          return;
        }

        Readable.fromWeb(upstreamBody).pipe(res);
        return;
      }

      // B2 may be missing legacy files. Fall back to local disk before returning 404.
      if (upstream.status !== 404) {
        return res.status(upstream.status).send('File unavailable');
      }
    }

    const safePath = safeUploadPath(requestedPath);
    if (!safePath || !(await pathExists(safePath))) {
      return res.status(404).send('File not found');
    }

    return res.sendFile(safePath);
  } catch (error) {
    console.error('Upload proxy error:', error);
    return res.status(500).send('Failed to load file');
  }
});

// Route modules
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/agent'));
app.use('/api', require('./routes/ai'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/coach'));
app.use('/api', require('./routes/player'));


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

app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).json({ error: 'Internal server error' });
});

async function initializeAndStart() {
  try {
    await db.initialize();
    await ensureRuntimeDirectories();
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
