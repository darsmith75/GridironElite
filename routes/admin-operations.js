const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { getPendingB2DeleteQueueSnapshot, processPendingB2DeleteQueue } = require('../utils/b2-queue');
const { collegeLogoUpload } = require('../utils/upload');
const { normalizeDivisionTag, normalizeConferenceTag, normalizeCollegeLogoPath, normalizeCollegeLogoRows } = require('../utils/college-logo-path');

const router = express.Router();
const ADMIN_STATS_CACHE_TTL_MS = 5 * 60 * 1000;

let adminStatsCache = {
  data: null,
  expiresAt: 0,
  inFlight: null
};

async function buildAdminStatsPayload() {
  const [
    totalUsersRow,
    totalPlayersRow,
    totalAgentsRow,
    usersActive24hRow,
    newUsers7dRow,
    totalProfileViewsRow,
    aiSummariesRow,
    totalTrafficRow,
    pageViews24hRow,
    uniqueVisitors24hRow,
    recentLogins,
    topViewedPlayers,
    topPages,
    recentProfileViews
  ] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM users').get(),
    db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'player'").get(),
    db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'agent'").get(),
    db.prepare("SELECT COUNT(*) as count FROM users WHERE last_login_at >= NOW() - INTERVAL '24 hours'").get(),
    db.prepare("SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '7 days'").get(),
    db.prepare('SELECT COALESCE(SUM(profile_view_count), 0) as count FROM player_profiles').get(),
    db.prepare('SELECT COUNT(*) as count FROM ai_player_summaries').get(),
    db.prepare('SELECT COUNT(*) as count FROM site_traffic_events').get(),
    db.prepare("SELECT COUNT(*) as count FROM site_traffic_events WHERE event_type = 'page_view' AND created_at >= NOW() - INTERVAL '24 hours'").get(),
    db.prepare("SELECT COUNT(DISTINCT ip_address) as count FROM site_traffic_events WHERE created_at >= NOW() - INTERVAL '24 hours' AND ip_address IS NOT NULL AND ip_address <> ''").get(),
    db.prepare(`
      SELECT u.id, u.email, u.role,
        COALESCE(pp.full_name, u.full_name, '') AS display_name,
        u.last_login_at
      FROM users u
      LEFT JOIN player_profiles pp ON pp.user_id = u.id
      WHERE u.last_login_at IS NOT NULL
      ORDER BY u.last_login_at DESC
      LIMIT 8
    `).all(),
    db.prepare(`
      SELECT pp.user_id, pp.full_name,
        COALESCE(pp.profile_view_count, 0) AS profile_view_count,
        pp.last_viewed_at
      FROM player_profiles pp
      ORDER BY COALESCE(pp.profile_view_count, 0) DESC, pp.last_viewed_at DESC NULLS LAST
      LIMIT 8
    `).all(),
    db.prepare(`
      SELECT COALESCE(NULLIF(path, ''), 'unknown') AS page_path,
        COUNT(*)::int AS views
      FROM site_traffic_events
      WHERE event_type = 'page_view'
      GROUP BY COALESCE(NULLIF(path, ''), 'unknown')
      ORDER BY views DESC, page_path ASC
      LIMIT 8
    `).all(),
    db.prepare(`
      SELECT ste.created_at,
        ste.ip_address,
        ste.role,
        COALESCE(viewer_profile.full_name, viewer.full_name, viewer.email, 'Unknown viewer') AS viewer_name,
        COALESCE(target_profile.full_name, target_user.full_name, target_user.email, 'Unknown player') AS player_name
      FROM site_traffic_events ste
      LEFT JOIN users viewer ON viewer.id = ste.user_id
      LEFT JOIN player_profiles viewer_profile ON viewer_profile.user_id = viewer.id
      LEFT JOIN users target_user ON target_user.id = (ste.metadata_json->>'playerUserId')::int
      LEFT JOIN player_profiles target_profile ON target_profile.user_id = target_user.id
      WHERE ste.event_type = 'player_profile_view'
      ORDER BY ste.created_at DESC
      LIMIT 8
    `).all()
  ]);

  return {
    totalUsers: totalUsersRow.count,
    totalPlayers: totalPlayersRow.count,
    totalAgents: totalAgentsRow.count,
    usersActive24h: usersActive24hRow.count,
    newUsers7d: newUsers7dRow.count,
    totalProfileViews: totalProfileViewsRow.count,
    aiSummariesGenerated: aiSummariesRow.count,
    totalTrafficEvents: totalTrafficRow.count,
    pageViews24h: pageViews24hRow.count,
    uniqueVisitors24h: uniqueVisitors24hRow.count,
    recentLogins,
    topViewedPlayers,
    topPages,
    recentProfileViews
  };
}

async function getAdminStats(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && adminStatsCache.data && now < adminStatsCache.expiresAt) {
    return adminStatsCache.data;
  }

  if (adminStatsCache.inFlight) {
    return adminStatsCache.inFlight;
  }

  adminStatsCache.inFlight = (async () => {
    const payload = await buildAdminStatsPayload();
    adminStatsCache.data = payload;
    adminStatsCache.expiresAt = Date.now() + ADMIN_STATS_CACHE_TTL_MS;
    return payload;
  })();

  try {
    return await adminStatsCache.inFlight;
  } finally {
    adminStatsCache.inFlight = null;
  }
}

async function storeUploadedCollegeLogo(file, division, conference) {
  if (!file) return null;

  const divisionTag = normalizeDivisionTag(division);
  if (!divisionTag) {
    return path.join('images', 'collegelogos', file.filename).replace(/\\/g, '/');
  }

  let targetDir = path.join('images', 'collegelogos', divisionTag);
  const conferenceTag = normalizeConferenceTag(conference);
  if (divisionTag === 'D2' && conferenceTag) {
    targetDir = path.join(targetDir, conferenceTag);
  }
  const targetPath = path.join(targetDir, file.filename);

  await fsPromises.mkdir(targetDir, { recursive: true });
  await fsPromises.rename(file.path, targetPath);

  return targetPath.replace(/\\/g, '/');
}

function inferDivisionFromConference(conference) {
  const normalized = String(conference || '').trim();
  if (!normalized) return null;

  const divisionByConference = new Map([
    ['FBS Independents', 'FBS'],
    ['Pac-12', 'FBS'],
    ['American', 'FBS'],
    ['Mid-American', 'FBS'],
    ['Mountain West', 'FBS'],
    ['SEC', 'FBS'],
    ['Sun Belt', 'FBS'],
    ['ACC', 'FBS'],
    ['Big Ten', 'FBS'],
    ['Conference USA', 'FBS'],
    ['Big 12', 'FBS'],
    ['UAC', 'FCS'],
    ['NEC', 'FCS'],
    ['Independent', 'FCS'],
    ['MEAC', 'FCS'],
    ['Southland', 'FCS'],
    ['Patriot League', 'FCS'],
    ['SWAC', 'FCS'],
    ['Ivy League', 'FCS'],
    ['CAA', 'FCS'],
    ['Big South-OVC', 'FCS'],
    ['Pioneer', 'FCS'],
    ['SoCon', 'FCS'],
    ['Missouri Valley', 'FCS'],
    ['Big Sky', 'FCS'],
    ['CIAA', 'D2'],
    ['CC', 'D2'],
    ['GLIAC', 'D2'],
    ['GLVC', 'D2'],
    ['GMAC', 'D2'],
    ['Great Northwest', 'D2'],
    ['LSC', 'D2'],
    ['MEC', 'D2'],
    ['NE10', 'D2'],
    ['NSIC', 'D2'],
    ['PSAC', 'D2'],
    ['RMAC', 'D2'],
    ['SAC', 'D2'],
    ['SIAC', 'D2']
  ]);

  return divisionByConference.get(normalized) || null;
}

// Admin: Get comprehensive statistics dashboard
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const stats = await getAdminStats(forceRefresh);
    res.json(stats);
  } catch (error) {
    console.error('Admin get stats error:', error);
    res.status(500).json({ error: 'Failed to load statistics' });
  }
});

// Admin: Get B2 delete queue status
router.get('/admin/b2-delete-queue', requireAdmin, async (req, res) => {
  try {
    const snapshot = await getPendingB2DeleteQueueSnapshot();
    res.json(snapshot);
  } catch (error) {
    console.error('Admin get B2 delete queue error:', error);
    res.status(500).json({ error: 'Failed to load B2 delete queue' });
  }
});

// Admin: Flush B2 delete queue (attempt to process all pending deletions)
router.post('/admin/b2-delete-queue/flush', requireAdmin, async (req, res) => {
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
        remaining: (await getPendingB2DeleteQueueSnapshot()).size
      })
    });
  } catch (error) {
    console.error('Admin flush B2 delete queue error:', error);
    res.status(500).json({ error: 'Failed to flush B2 delete queue' });
  }
});

// ─── College CRUD ─────────────────────────────────────────────────────────────

// GET /api/admin/colleges
router.get('/admin/colleges', requireAdmin, async (req, res) => {
  try {
    const colleges = await db.prepare(
      'SELECT id, name, website_url, division, conference, team, logo FROM colleges ORDER BY name ASC'
    ).all();
    res.json(normalizeCollegeLogoRows(colleges));
  } catch (error) {
    console.error('Admin get colleges error:', error);
    res.status(500).json({ error: 'Failed to get colleges' });
  }
});

// POST /api/admin/colleges
router.post('/admin/colleges', requireAdmin, collegeLogoUpload.single('logo'), async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'College name is required' });

    const websiteUrl = (req.body.website_url || '').trim() || null;
    const divisionInput = (req.body.division || '').trim();
    const conference = (req.body.conference || '').trim() || null;
    const division = divisionInput || inferDivisionFromConference(conference);
    const team = (req.body.team || '').trim() || null;
    const uploadedLogo = await storeUploadedCollegeLogo(req.file, division, conference);
    const logo = normalizeCollegeLogoPath(uploadedLogo, division, conference);

    const result = await db.prepare(
      'INSERT INTO colleges (name, website_url, division, conference, team, logo) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, websiteUrl, division, conference, team, logo);

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Admin add college error:', error);
    res.status(500).json({ error: 'Failed to add college' });
  }
});

// PUT /api/admin/colleges/:id
router.put('/admin/colleges/:id', requireAdmin, collegeLogoUpload.single('logo'), async (req, res) => {
  try {
    const collegeId = parseInt(req.params.id, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });

    const existing = await db.prepare('SELECT id, logo FROM colleges WHERE id = ?').get(collegeId);
    if (!existing) return res.status(404).json({ error: 'College not found' });

    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'College name is required' });

    const websiteUrl = (req.body.website_url || '').trim() || null;
    const conference = (req.body.conference || '').trim() || null;
    const divisionInput = (req.body.division || '').trim();
    const division = divisionInput || inferDivisionFromConference(conference);
    const team = (req.body.team || '').trim() || null;

    let logo = existing.logo;
    if (req.file) {
      // Delete old logo from disk if present
      if (existing.logo) {
        const oldPath = path.resolve(existing.logo);
        try {
          await fsPromises.unlink(oldPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      const uploadedLogo = await storeUploadedCollegeLogo(req.file, division, conference);
      logo = normalizeCollegeLogoPath(uploadedLogo, division, conference);
    } else {
      logo = normalizeCollegeLogoPath(logo, division, conference);
    }

    await db.prepare(
      'UPDATE colleges SET name = ?, website_url = ?, division = ?, conference = ?, team = ?, logo = ? WHERE id = ?'
    ).run(name, websiteUrl, division, conference, team, logo, collegeId);

    res.json({ success: true });
  } catch (error) {
    console.error('Admin update college error:', error);
    res.status(500).json({ error: 'Failed to update college' });
  }
});

// DELETE /api/admin/colleges/:id
router.delete('/admin/colleges/:id', requireAdmin, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.id, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });

    const existing = await db.prepare('SELECT id, logo FROM colleges WHERE id = ?').get(collegeId);
    if (!existing) return res.status(404).json({ error: 'College not found' });

    if (existing.logo) {
      const logoPath = path.resolve(existing.logo);
      try {
        await fsPromises.unlink(logoPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    await db.prepare('DELETE FROM colleges WHERE id = ?').run(collegeId);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete college error:', error);
    res.status(500).json({ error: 'Failed to delete college' });
  }
});

module.exports = router;
