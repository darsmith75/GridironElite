const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { METRIC_VIDEO_CONFIG, METRIC_TIP_CONFIG } = require('../utils/constants');
const { logSiteTrafficEvent } = require('../utils/helpers');
const { getMergedMetricTipsForPlayer, getMetricTipsMap, getMetricYoutubeUrlsMap } = require('../utils/ai-helpers');
const {
  PROFILE_UPLOAD_FIELD_MAX_COUNTS,
  MAX_HIGHLIGHT_VIDEO_BYTES,
  playerProfileUploadMiddleware,
  processUploadedFiles
} = require('../utils/upload');
const {
  deleteUploadFile,
  replacePlayerProfileFile,
  clearPlayerProfileFile,
  deleteOwnedPlayerMedia,
  deleteOwnedPlayerMetricVideo,
  deletePlayerAccountAndAssociatedData
} = require('../utils/file-mgmt');
const { enrichPlayerProfile } = require('../utils/enrich-player');
const { parseHeightToInches } = require('../utils/height');
const {
  DEFAULT_POSITION_HIGHLIGHTS,
  canonicalizePositionKey,
  normalizePositionToken,
  parseAliasesCsv,
  guideMatchesPosition,
  toAliasesCsv
} = require('../utils/position-highlights');

async function ensurePositionHighlightGuidesReady() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS position_highlight_guides (
      id SERIAL PRIMARY KEY,
      position_key VARCHAR(64) UNIQUE NOT NULL,
      display_name VARCHAR(120) NOT NULL,
      image_path TEXT NOT NULL,
      aliases_csv TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 1,
      updated_by_user_id INTEGER,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_position_highlight_guides_sort_active
      ON position_highlight_guides(is_active, sort_order);
  `);

  const existing = await db.prepare('SELECT COUNT(*)::int AS count FROM position_highlight_guides').get();
  if ((existing?.count || 0) > 0) return;

  let sortOrder = 1;
  for (const guide of DEFAULT_POSITION_HIGHLIGHTS) {
    await db.prepare(`
      INSERT INTO position_highlight_guides (
        position_key,
        display_name,
        image_path,
        aliases_csv,
        is_active,
        sort_order,
        updated_at
      )
      VALUES (?, ?, ?, ?, true, ?, CURRENT_TIMESTAMP)
    `).run(
      guide.positionKey,
      guide.displayName,
      guide.imagePath,
      toAliasesCsv(guide.aliases || []),
      sortOrder
    );
    sortOrder += 1;
  }
}

const router = express.Router();

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

function parseBooleanField(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
  }
  return false;
}

async function handleDeletePlayerAccount(req, res) {
  if (req.session.role !== 'player') {
    return res.status(403).json({ error: 'Only athletes can delete this account' });
  }

  const confirmationText = String(req.body?.confirmation || '').trim();
  if (confirmationText !== 'DELETE MY ACCOUNT') {
    return res.status(400).json({ error: 'Confirmation text did not match' });
  }

  const deletingUser = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.session.userId);
  if (!deletingUser) {
    return res.status(404).json({ error: 'Athlete account not found' });
  }

  try {
    const result = await deletePlayerAccountAndAssociatedData(req.session.userId);
    if (!result.deleted) {
      if (result.reason === 'not-found') {
        return res.status(404).json({ error: 'Athlete account not found' });
      }
      if (result.reason === 'forbidden-role') {
        return res.status(403).json({ error: 'Only athletes can delete this account' });
      }
      return res.status(500).json({ error: 'Failed to delete athlete account' });
    }

    await logSiteTrafficEvent({
      req,
      eventType: 'player_account_deleted',
      path: '/player-profile',
      method: 'POST',
      userId: null,
      role: 'player',
      metadata: {
        deletedUserId: deletingUser.id,
        deletedEmail: deletingUser.email,
        initiatedBy: 'self-service',
        confirmation: 'DELETE MY ACCOUNT'
      }
    });

    await new Promise(resolve => req.session.destroy(() => resolve()));
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete athlete account error:', error);
    return res.status(500).json({ error: 'Failed to delete athlete account' });
  }
}

router.post('/player/account/delete', requireAuth, handleDeletePlayerAccount);
router.delete('/player/account', requireAuth, handleDeletePlayerAccount);

// Get player profile
router.get('/player/profile', requireAuth, async (req, res) => {
  const profile = await db.prepare('SELECT * FROM player_profiles WHERE user_id = ?').get(req.session.userId);
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  await enrichPlayerProfile(profile);

  if (profile) {
    let teamRow = await db.prepare(`
      SELECT ht.team_name, ht.school_name, ht.banner_image, ht.banner_color_start, ht.banner_color_end, ht.school_logo
      FROM team_players tp
      JOIN hs_teams ht ON ht.id = tp.team_id
      WHERE tp.player_id = ?
      LIMIT 1
    `).get(req.session.userId);

    // Fallback: if roster link is missing, try matching by player's high school name.
    if (!teamRow && profile.high_school && String(profile.high_school).trim()) {
      teamRow = await db.prepare(`
        SELECT ht.team_name, ht.school_name, ht.banner_image, ht.banner_color_start, ht.banner_color_end, ht.school_logo
        FROM hs_teams ht
        WHERE LOWER(TRIM(ht.school_name)) = LOWER(TRIM(?))
           OR LOWER(TRIM(ht.team_name)) = LOWER(TRIM(?))
        ORDER BY ht.id DESC
        LIMIT 1
      `).get(profile.high_school, profile.high_school);
    }

    if (teamRow) {
      profile.hs_team = teamRow;
    }
  }

  res.json({ ...(profile || {}), email: user?.email || '' });
});

// Player: Get pro tips for athletic metrics
router.get('/player/metric-pro-tips', requireAuth, async (req, res) => {
  try {
    const youtube_urls = await getMetricYoutubeUrlsMap();
    if (req.session.role === 'player') {
      const tips = await getMergedMetricTipsForPlayer(req.session.userId);
      return res.json({ tips: tips.merged, youtube_urls, metrics: METRIC_TIP_CONFIG });
    }

    const tips = await getMetricTipsMap();
    res.json({ tips, youtube_urls, metrics: METRIC_TIP_CONFIG });
  } catch (error) {
    console.error('Player get metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to load metric tips' });
  }
});

router.get('/player/position-highlight-guide', requireAuth, async (req, res) => {
  try {
    await ensurePositionHighlightGuidesReady();
    const requestedPosition = String(req.query?.position || '').trim();
    let effectivePosition = requestedPosition;

    if (!effectivePosition && req.session.role === 'player') {
      const playerProfile = await db.prepare('SELECT position FROM player_profiles WHERE user_id = ?').get(req.session.userId);
      effectivePosition = String(playerProfile?.position || '').trim();
    }

    const rows = await db.prepare(`
      SELECT id, position_key, display_name, image_path, aliases_csv, is_active, sort_order, updated_at
      FROM position_highlight_guides
      WHERE is_active = true
      ORDER BY sort_order ASC, id ASC
    `).all();

    const guides = rows.map((row) => ({
      id: row.id,
      positionKey: canonicalizePositionKey(row.position_key) || row.position_key,
      displayName: row.display_name,
      imagePath: row.image_path,
      aliases: parseAliasesCsv(row.aliases_csv || ''),
      aliasesCsv: row.aliases_csv || '',
      sortOrder: Number(row.sort_order || 0),
      updatedAt: row.updated_at || null
    }));

    const target = canonicalizePositionKey(effectivePosition) || normalizePositionToken(effectivePosition);
    const exactMatch = guides.find((item) => {
      const key = canonicalizePositionKey(item.positionKey) || normalizePositionToken(item.positionKey);
      return key === target;
    });
    const aliasMatch = guides.find((item) => guideMatchesPosition(item, target));
    const guide = exactMatch || aliasMatch || null;

    res.json({
      requestedPosition: requestedPosition || null,
      resolvedPosition: effectivePosition || null,
      guide
    });
  } catch (error) {
    console.error('Player get position highlight guide error:', error);
    res.status(500).json({ error: 'Failed to load position highlight guide' });
  }
});

// Update player profile
router.post('/player/profile', requireAuth, playerProfileUploadMiddleware, async (req, res) => {
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

  try {
    if (files?.highlightVideos && files.highlightVideos.length > 1) {
      return res.status(400).json({
        error: 'Please upload only one highlight video at a time.'
      });
    }

    if (files?.highlightVideos?.[0] && files.highlightVideos[0].size > MAX_HIGHLIGHT_VIDEO_BYTES) {
      return res.status(400).json({
        error: `Highlight video is too large. Maximum allowed is ${Math.round(MAX_HIGHLIGHT_VIDEO_BYTES / (1024 * 1024))}MB.`
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

    await processUploadedFiles(req.session.userId, files);
    const userPrefix = req.session.userId + '/';
    const filesToDeleteAfterCommit = [];

    const result = await db.withTransaction(async (tx) => {
      const updateResult = await tx.prepare(`
        UPDATE player_profiles SET
          full_name = ?, high_school = ?, graduation_year = ?, position = ?,
          height = ?, height_inches = ?, weight = ?, forty_yard_dash = ?, bench_press = ?,
          squat = ?, vertical_jump = ?, shuttle_5_10_5 = ?, l_drill = ?,
          broad_jump = ?, power_clean = ?, single_leg_squat = ?, catapult = ?, metric_1080 = ?, hand_size = ?, wingspan = ?, gpa = ?, achievement = ?, bio = ?,
          phone = ?,
          hudl_link = ?, instagram_link = ?, twitter_link = ?,
          hudl_username = ?, instagram_username = ?, twitter_username = ?,
          birth_date = ?
        WHERE user_id = ?
      `).run(
        data.fullName || null,
        data.highSchool || null,
        data.graduationYear || null,
        data.position || null,
        data.height || null,
        parseHeightToInches(data.height),
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
        data.catapult || null,
        data.metric1080 || null,
        data.handSize || null,
        data.wingspan || null,
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
        data.birthDate || null,
        req.session.userId
      );

      await tx.prepare('DELETE FROM player_contacts WHERE user_id = ?').run(req.session.userId);
      const insertContact = tx.prepare('INSERT INTO player_contacts (user_id, role, name, email, phone) VALUES (?, ?, ?, ?, ?)');
      if (data.fatherName || data.fatherEmail || data.fatherPhone) {
        await insertContact.run(req.session.userId, 'father', data.fatherName || null, data.fatherEmail || null, data.fatherPhone || null);
      }
      if (data.motherName || data.motherEmail || data.motherPhone) {
        await insertContact.run(req.session.userId, 'mother', data.motherName || null, data.motherEmail || null, data.motherPhone || null);
      }
      if (data.coachName || data.coachEmail || data.coachPhone) {
        await insertContact.run(req.session.userId, 'coach', data.coachName || null, data.coachEmail || null, data.coachPhone || null);
      }

      if (files?.highlightVideos) {
        const insertVideo = tx.prepare('INSERT INTO player_videos (user_id, filename) VALUES (?, ?)');
        for (const f of files.highlightVideos) {
          await insertVideo.run(req.session.userId, userPrefix + f.filename);
        }
      }

      if (files?.additionalImages) {
        const insertImage = tx.prepare('INSERT INTO player_images (user_id, filename) VALUES (?, ?)');
        for (const f of files.additionalImages) {
          await insertImage.run(req.session.userId, userPrefix + f.filename);
        }
      }

      for (const config of METRIC_VIDEO_CONFIG) {
        const uploadedMetricVideo = files?.[config.fieldName]?.[0];
        const existingMetricVideo = await tx.prepare(
          'SELECT video_filename FROM player_metric_videos WHERE user_id = ? AND metric_key = ?'
        ).get(req.session.userId, config.key);

        let resolvedFilename = existingMetricVideo?.video_filename || null;
        if (uploadedMetricVideo) {
          resolvedFilename = userPrefix + uploadedMetricVideo.filename;
          if (existingMetricVideo?.video_filename && existingMetricVideo.video_filename !== resolvedFilename) {
            filesToDeleteAfterCommit.push(existingMetricVideo.video_filename);
          }
        }

        if (!resolvedFilename) {
          continue;
        }

        const isVerified = parseBooleanField(data[config.verifiedField]);
        const verifiedBy = (data[config.verifiedByField] || '').trim() || null;
        const recordedAtRaw = (data[config.recordedAtField] || '').trim();
        const recordedAt = recordedAtRaw || null;

        await tx.prepare(`
          INSERT INTO player_metric_videos (user_id, metric_key, video_filename, is_verified, verified_by, recorded_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id, metric_key)
          DO UPDATE SET
            video_filename = EXCLUDED.video_filename,
            is_verified = EXCLUDED.is_verified,
            verified_by = EXCLUDED.verified_by,
            recorded_at = EXCLUDED.recorded_at,
            updated_at = CURRENT_TIMESTAMP
        `).run(req.session.userId, config.key, resolvedFilename, isVerified, verifiedBy, recordedAt);
      }

      return updateResult;
    });

    for (const filename of filesToDeleteAfterCommit) {
      try {
        await deleteUploadFile(filename);
      } catch (cleanupError) {
        console.warn('Post-commit cleanup failed for metric video:', filename, cleanupError);
      }
    }

    console.log(`Profile update result: ${result.changes} rows changed`);

    if (files?.profilePicture) {
      await replacePlayerProfileFile(req.session.userId, 'profile_picture', userPrefix + files.profilePicture[0].filename);
    }

    if (files?.cardPhoto) {
      await replacePlayerProfileFile(req.session.userId, 'card_photo', userPrefix + files.cardPhoto[0].filename);
    }

    if (files?.reportCardImage) {
      await replacePlayerProfileFile(req.session.userId, 'report_card_image', userPrefix + files.reportCardImage[0].filename);
    }

    const updated = await db.prepare('SELECT gpa, vertical_jump FROM player_profiles WHERE user_id = ?').get(req.session.userId);
    console.log('Verified data in DB:', updated);

    res.json({ success: true });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Upload one metric proof video at a time (auto-save flow from profile form).
router.post('/player/metric-video', requireAuth, playerProfileUploadMiddleware, async (req, res) => {
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

    const isVerified = parseBooleanField(data[config.verifiedField]);
    const verifiedBy = (data[config.verifiedByField] || '').trim() || null;
    const recordedAtRaw = (data[config.recordedAtField] || '').trim();
    const recordedAt = recordedAtRaw || null;

    await db.prepare(`
      INSERT INTO player_metric_videos (user_id, metric_key, video_filename, is_verified, verified_by, recorded_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, metric_key)
      DO UPDATE SET
        video_filename = EXCLUDED.video_filename,
        is_verified = EXCLUDED.is_verified,
        verified_by = EXCLUDED.verified_by,
        recorded_at = EXCLUDED.recorded_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(req.session.userId, config.key, resolvedFilename, isVerified, verifiedBy, recordedAt);

    res.json({
      success: true,
      metricKey: config.key,
      videoFilename: resolvedFilename,
      isVerified,
      verifiedBy,
      recordedAt
    });
  } catch (error) {
    console.error('Metric proof upload error:', error);
    res.status(500).json({ error: 'Failed to upload metric proof video' });
  }
});

router.delete('/player/card-photo', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'card_photo');
    res.json({ success: true });
  } catch (error) {
    console.error('Delete card photo error:', error);
    res.status(500).json({ error: 'Failed to delete card photo' });
  }
});

router.delete('/player/profile-picture', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'profile_picture');
    res.json({ success: true });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ error: 'Failed to delete profile picture' });
  }
});

router.post('/player/report-card/delete', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'report_card_image');
    res.json({ success: true });
  } catch (error) {
    console.error('Delete report card image error:', error);
    res.status(500).json({ error: 'Failed to delete report card image' });
  }
});

router.post('/player/video/delete', requireAuth, async (req, res) => {
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

router.post('/player/metric-video/delete', requireAuth, async (req, res) => {
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

router.delete('/player/metric-video', requireAuth, async (req, res) => {
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

router.post('/player/video-link', requireAuth, async (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    const result = await db.prepare('INSERT INTO player_video_links (user_id, url, title) VALUES (?, ?, ?)')
      .run(req.session.userId, url, title || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add video link error:', error);
    res.status(500).json({ error: 'Failed to add video link' });
  }
});

router.delete('/player/video-link/:id', requireAuth, async (req, res) => {
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

router.post('/player/image/delete', requireAuth, async (req, res) => {
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

module.exports = router;
