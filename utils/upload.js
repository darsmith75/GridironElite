const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const os = require('os');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const { METRIC_VIDEO_CONFIG } = require('./constants');
const { b2Enabled, uploadToB2 } = require('../backblaze');

const PROFILE_UPLOAD_FIELD_MAX_COUNTS = {
  profilePicture: 1,
  cardPhoto: 1,
  reportCardImage: 1,
  highlightVideos: 5,
  additionalImages: 10,
  ...Object.fromEntries(METRIC_VIDEO_CONFIG.map(config => [config.fieldName, 1]))
};

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const COACH_IMAGE_MAX_BYTES = parseInt(process.env.MAX_COACH_IMAGE_MB || '8', 10) * 1024 * 1024;
const MAX_HIGHLIGHT_VIDEO_MB = parseInt(process.env.MAX_HIGHLIGHT_VIDEO_MB || '35', 10);
const MAX_HIGHLIGHT_VIDEO_BYTES = MAX_HIGHLIGHT_VIDEO_MB * 1024 * 1024;
const VIDEO_OPTIMIZATION_MODE = String(process.env.VIDEO_OPTIMIZATION_MODE || 'off').toLowerCase();

const IMAGE_ONLY_FIELDS = new Set([
  'profilePicture',
  'cardPhoto',
  'reportCardImage',
  'additionalImages',
  'schoolLogo',
  'bannerImage'
]);

const VIDEO_ONLY_FIELDS = new Set([
  'highlightVideos',
  ...METRIC_VIDEO_CONFIG.map((config) => config.fieldName)
]);

let fileTypeModulePromise = null;
function loadFileTypeModule() {
  if (!fileTypeModulePromise) {
    fileTypeModulePromise = import('file-type');
  }
  return fileTypeModulePromise;
}

function allowedMimeTypesForField(fieldName) {
  if (IMAGE_ONLY_FIELDS.has(fieldName)) return ALLOWED_IMAGE_TYPES;
  if (VIDEO_ONLY_FIELDS.has(fieldName)) return ALLOWED_VIDEO_TYPES;
  return ALLOWED_TYPES;
}

async function detectFileMimeType(file) {
  try {
    const { fileTypeFromFile, fileTypeFromBuffer } = await loadFileTypeModule();
    if (file?.path) {
      const detectedFromFile = await fileTypeFromFile(file.path);
      if (detectedFromFile?.mime) return detectedFromFile.mime;
    }
    if (file?.buffer) {
      const detectedFromBuffer = await fileTypeFromBuffer(file.buffer);
      if (detectedFromBuffer?.mime) return detectedFromBuffer.mime;
    }
  } catch (_) {
    // Fallback to declared MIME type only if detector is unavailable.
  }
  return null;
}

async function validateFileSignature(file) {
  const allowedMimeTypes = allowedMimeTypesForField(file?.fieldname);
  const detectedMimeType = await detectFileMimeType(file);

  if (detectedMimeType && allowedMimeTypes.includes(detectedMimeType)) {
    return detectedMimeType;
  }

  if (!detectedMimeType && allowedMimeTypes.includes(file?.mimetype)) {
    return file.mimetype;
  }

  throw new Error('Invalid file content. Uploaded file signature does not match allowed type.');
}

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
  await fsPromises.mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`);
  await fsPromises.writeFile(tempPath, optimizedBuffer);

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
  await fsPromises.mkdir(tempDir, { recursive: true });

  const sourceExt = path.extname(file.originalname).toLowerCase() || '.mp4';
  const tempBase = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const inputPath = file.path || path.join(tempDir, `${tempBase}${sourceExt}`);
  const outputPath = path.join(tempDir, `${tempBase}-optimized.mp4`);
  const createdInputTemp = !file.path;

  try {
    if (createdInputTemp) {
      await fsPromises.writeFile(inputPath, file.buffer);
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
    if (createdInputTemp) {
      try { await fsPromises.unlink(inputPath); } catch (_) {}
    }
  }
}

// Use temp disk storage to avoid high RAM usage for larger media uploads.
const incomingUploadDir = path.join(os.tmpdir(), 'gridiron-elite-incoming');
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fsPromises.mkdir(incomingUploadDir, { recursive: true });
      cb(null, incomingUploadDir);
    } catch (error) {
      cb(error);
    }
  },
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
const coachImageUpload = multer({
  storage,
  limits: { fileSize: COACH_IMAGE_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image type. Only JPEG, PNG, GIF, and WEBP are allowed.'), false);
    }
  }
});

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
      const verifiedMimeType = await validateFileSignature(file);
      file.mimetype = verifiedMimeType;
      try {
        if (ALLOWED_IMAGE_TYPES.includes(verifiedMimeType)) {
          processed = await optimizeImageFile(file);
        } else if (ALLOWED_VIDEO_TYPES.includes(verifiedMimeType)) {
          processed = await optimizeVideoFile(file);
        }
      } catch (error) {
        console.warn('Media optimization failed, using original upload:', error.message);
      }

      const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + processed.extension;
      file.filename = safeName;
      file.mimetype = processed.mimeType;
      if (b2Enabled) {
        const uploadBody = processed.filePath
          ? fs.createReadStream(processed.filePath)
          : processed.buffer;
        await uploadToB2('uploads/' + userId + '/' + safeName, uploadBody, processed.mimeType);
      } else {
        const userDir = path.join('uploads', String(userId));
        await fsPromises.mkdir(userDir, { recursive: true });
        const destination = path.join(userDir, safeName);
        if (processed.filePath) {
          await fsPromises.copyFile(processed.filePath, destination);
        } else {
          await fsPromises.writeFile(destination, processed.buffer);
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
      if (processed.filePath && processed.filePath !== originalTempPath) {
        try { await fsPromises.unlink(processed.filePath); } catch (_) {}
      }
      if (originalTempPath) {
        try { await fsPromises.unlink(originalTempPath); } catch (_) {}
      }
    }
  }
}

const collegeLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join('images', 'collegelogos')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, safeName);
  }
});
const collegeLogoUpload = multer({ storage: collegeLogoStorage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter });

function safeUploadPath(filename) {
  const normalized = path.normalize(filename).replace(/^\.[/\\]+/, '');
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

module.exports = {
  upload,
  coachImageUpload,
  PROFILE_UPLOAD_FIELD_MAX_COUNTS,
  MAX_HIGHLIGHT_VIDEO_BYTES,
  MAX_HIGHLIGHT_VIDEO_MB,
  playerProfileUploadMiddleware,
  processUploadedFiles,
  collegeLogoUpload,
  safeUploadPath,
  normalizeUploadFilename,
  normalizeOptionalInteger,
  normalizeOptionalFloat
};
