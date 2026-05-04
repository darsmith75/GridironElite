const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { upload, processUploadedFiles, normalizeOptionalInteger } = require('../utils/upload');
const { requireAuth } = require('../middleware/auth');
const { enrichPlayerProfile } = require('../utils/enrich-player');
const { replaceUserFile } = require('../utils/file-mgmt');
const {
  parseQueryNumber, normalizeHexColor, logSiteTrafficEvent,
  getAgentPlayersRateKey, isAgentPlayersRateLimited,
  buildAgentPlayersCacheKey, getCachedAgentPlayers, setCachedAgentPlayers
} = require('../utils/helpers');
const { parseHeightToInches, formatHeightFromInches } = require('../utils/height');

const router = express.Router();

function wrapAsync(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

for (const method of ['get', 'post', 'put', 'delete']) {
  const original = router[method].bind(router);
  router[method] = (routePath, ...handlers) => {
    const wrappedHandlers = handlers.map((handler) => {
      if (typeof handler !== 'function') return handler;
      if (handler.length >= 3) return handler;
      if (handler.constructor && handler.constructor.name === 'AsyncFunction') {
        return wrapAsync(handler);
      }
      return handler;
    });
    return original(routePath, ...wrappedHandlers);
  };
}

// Agent: Get all players with filters
router.get('/agent/players', async (req, res) => {
  if (await isAgentPlayersRateLimited(req)) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }

  // Disable caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
  const quickSearch = String(req.query.quickSearch || '').trim().toLowerCase();
  const sortBy = String(req.query.sortBy || 'name_asc').trim().toLowerCase();
  const minHeightInches = parseHeightToInches(req.query.minHeight);

  const normalizedFilters = {
    limit,
    offset,
    favoritesOnly: req.query.favoritesOnly === 'true' && !!req.session.userId,
    position: String(req.query.position || '').trim(),
    graduationYear: String(req.query.graduationYear || '').trim(),
    minGpa: parseQueryNumber(req.query.minGpa),
    maxForty: parseQueryNumber(req.query.maxForty),
    minHeight: String(req.query.minHeight || '').trim(),
    minHeightInches,
    minWeight: parseQueryNumber(req.query.minWeight),
    minVertical: parseQueryNumber(req.query.minVertical),
    minBench: parseQueryNumber(req.query.minBench),
    minSquat: parseQueryNumber(req.query.minSquat),
    maxShuttle: parseQueryNumber(req.query.maxShuttle),
    maxLDrill: parseQueryNumber(req.query.maxLDrill),
    minBroadJump: parseQueryNumber(req.query.minBroadJump),
    quickSearch,
    sortBy
  };

  const shouldUseCache = !normalizedFilters.favoritesOnly;
  const cacheKey = buildAgentPlayersCacheKey(req, normalizedFilters);
  if (shouldUseCache) {
    const cachedPayload = await getCachedAgentPlayers(cacheKey);
    if (cachedPayload) {
      return res.json(cachedPayload);
    }
  }

  let fromAndWhere = `
    FROM player_profiles pp
    LEFT JOIN (
      SELECT user_id, true AS has_verified_metric
      FROM player_metric_videos
      WHERE is_verified = true
      GROUP BY user_id
    ) pmv ON pmv.user_id = pp.user_id
    WHERE 1=1
  `;
  const params = [];

  // Filter by favorites only (only works if authenticated)
  if (normalizedFilters.favoritesOnly) {
    fromAndWhere = `
      FROM player_profiles pp
      INNER JOIN agent_favorites af ON pp.user_id = af.user_id
      LEFT JOIN (
        SELECT user_id, true AS has_verified_metric
        FROM player_metric_videos
        WHERE is_verified = true
        GROUP BY user_id
      ) pmv ON pmv.user_id = pp.user_id
      WHERE af.agent_id = ?
    `;
    params.push(req.session.userId);
  }

  if (normalizedFilters.position) {
    fromAndWhere += ' AND pp.position = ?';
    params.push(normalizedFilters.position);
  }
  if (normalizedFilters.graduationYear) {
    fromAndWhere += ' AND pp.graduation_year = ?';
    params.push(normalizedFilters.graduationYear);
  }
  if (normalizedFilters.minGpa !== null) {
    fromAndWhere += ' AND pp.gpa >= ?';
    params.push(normalizedFilters.minGpa);
  }
  if (normalizedFilters.maxForty !== null) {
    fromAndWhere += ' AND pp.forty_yard_dash <= ?';
    params.push(normalizedFilters.maxForty);
  }
  if (normalizedFilters.minHeightInches !== null) {
    fromAndWhere += ' AND pp.height_inches >= ?';
    params.push(normalizedFilters.minHeightInches);
  }
  if (normalizedFilters.minWeight !== null) {
    fromAndWhere += ' AND pp.weight >= ?';
    params.push(normalizedFilters.minWeight);
  }
  if (normalizedFilters.minVertical !== null) {
    fromAndWhere += ' AND pp.vertical_jump >= ?';
    params.push(normalizedFilters.minVertical);
  }
  if (normalizedFilters.minBench !== null) {
    fromAndWhere += ' AND pp.bench_press >= ?';
    params.push(normalizedFilters.minBench);
  }
  if (normalizedFilters.minSquat !== null) {
    fromAndWhere += ' AND pp.squat >= ?';
    params.push(normalizedFilters.minSquat);
  }
  if (normalizedFilters.maxShuttle !== null) {
    fromAndWhere += ' AND pp.shuttle_5_10_5 <= ?';
    params.push(normalizedFilters.maxShuttle);
  }
  if (normalizedFilters.maxLDrill !== null) {
    fromAndWhere += ' AND pp.l_drill <= ?';
    params.push(normalizedFilters.maxLDrill);
  }
  if (normalizedFilters.minBroadJump !== null) {
    fromAndWhere += ' AND pp.broad_jump >= ?';
    params.push(normalizedFilters.minBroadJump);
  }
  if (normalizedFilters.quickSearch) {
    fromAndWhere += `
      AND (
        LOWER(COALESCE(pp.full_name, '')) LIKE ?
        OR LOWER(COALESCE(pp.high_school, '')) LIKE ?
        OR LOWER(COALESCE(pp.position, '')) LIKE ?
        OR LOWER(COALESCE(pp.bio, '')) LIKE ?
      )
    `;
    const token = `%${normalizedFilters.quickSearch}%`;
    params.push(token, token, token, token);
  }

  let orderBy = 'pp.full_name ASC NULLS LAST, pp.user_id ASC';
  if (sortBy === 'name_desc') orderBy = 'pp.full_name DESC NULLS LAST, pp.user_id DESC';
  else if (sortBy === 'grad_year_asc') orderBy = 'pp.graduation_year ASC NULLS LAST, pp.user_id ASC';
  else if (sortBy === 'grad_year_desc') orderBy = 'pp.graduation_year DESC NULLS LAST, pp.user_id DESC';
  else if (sortBy === 'gpa_desc') orderBy = 'pp.gpa DESC NULLS LAST, pp.user_id ASC';
  else if (sortBy === 'gpa_asc') orderBy = 'pp.gpa ASC NULLS LAST, pp.user_id ASC';
  else if (sortBy === 'forty_asc') orderBy = 'pp.forty_yard_dash ASC NULLS LAST, pp.user_id ASC';
  else if (sortBy === 'forty_desc') orderBy = 'pp.forty_yard_dash DESC NULLS LAST, pp.user_id ASC';
  else if (sortBy === 'height_desc') orderBy = 'pp.height_inches DESC NULLS LAST, pp.user_id ASC';
  else if (sortBy === 'weight_desc') orderBy = 'pp.weight DESC NULLS LAST, pp.user_id ASC';
  else if (sortBy === 'vertical_desc') orderBy = 'pp.vertical_jump DESC NULLS LAST, pp.user_id ASC';

  const [totalRow, players] = await Promise.all([
    db.prepare(`SELECT COUNT(*)::int AS count ${fromAndWhere}`).get(...params),
    db.prepare(`
      SELECT
        pp.user_id AS id,
        pp.user_id,
        pp.full_name,
        pp.high_school,
        pp.graduation_year,
        pp.position,
        pp.height,
        pp.height_inches,
        pp.weight,
        pp.forty_yard_dash,
        pp.vertical_jump,
        pp.bench_press,
        pp.squat,
        pp.shuttle_5_10_5,
        pp.l_drill,
        pp.broad_jump,
        pp.gpa,
        pp.achievement,
        pp.profile_picture,
        pp.bio,
        COALESCE(pmv.has_verified_metric, false) AS has_verified_metric
      ${fromAndWhere}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)
  ]);

  const payload = {
    players: players.map((player) => {
      const legacyHeight = typeof player.height === 'string' ? player.height.trim() : '';
      return {
        ...player,
        height: legacyHeight || formatHeightFromInches(player.height_inches) || null
      };
    }),
    pagination: {
      limit,
      offset,
      total: totalRow?.count || 0,
      hasMore: offset + players.length < (totalRow?.count || 0)
    }
  };

  if (shouldUseCache) {
    await setCachedAgentPlayers(cacheKey, payload);
  }
  res.json(payload);
});

// Agent: Get single player detail (public access)
router.get('/agent/player/:id', async (req, res) => {
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

  const coachComments = await db.prepare(`
    SELECT cpc.comment, cpc.updated_at,
           u.full_name AS coach_name,
           t.team_name, t.school_name
    FROM coach_player_comments cpc
    JOIN users u ON u.id = cpc.coach_id
    JOIN hs_teams t ON t.coach_id = cpc.coach_id
    WHERE cpc.player_id = ?
    ORDER BY cpc.updated_at DESC
  `).all(req.params.id);
  player.coach_comments = coachComments;

  await enrichPlayerProfile(player);

  // Attach team info (banner image, colors) if player is on a team
  const teamRow = await db.prepare(`
    SELECT ht.team_name, ht.school_name, ht.banner_image, ht.banner_color_start, ht.banner_color_end, ht.school_logo
    FROM team_players tp
    JOIN hs_teams ht ON ht.id = tp.team_id
    WHERE tp.player_id = ?
    LIMIT 1
  `).get(req.params.id);
  if (teamRow) player.hs_team = teamRow;

  res.json(player);
});

// Agent: Get agent profile
router.get('/agent/profile', requireAuth, async (req, res) => {
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
router.post('/agent/profile', requireAuth, upload.fields([
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
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Agent: Change password
router.post('/agent/change-password', requireAuth, async (req, res) => {
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
router.post('/agent/favorites/:playerId', requireAuth, async (req, res) => {
  try {
    await db.prepare('INSERT OR IGNORE INTO agent_favorites (agent_id, user_id) VALUES (?, ?)').run(req.session.userId, req.params.playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// Agent: Remove player from favorites
router.delete('/agent/favorites/:playerId', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM agent_favorites WHERE agent_id = ? AND user_id = ?').run(req.session.userId, req.params.playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

// Agent: Get all favorite player IDs
router.get('/agent/favorites', async (req, res) => {
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
router.get('/agent/favorites/:playerId', requireAuth, async (req, res) => {
  try {
    const favorite = await db.prepare('SELECT id FROM agent_favorites WHERE agent_id = ? AND user_id = ?').get(req.session.userId, req.params.playerId);
    res.json({ isFavorite: !!favorite });
  } catch (error) {
    console.error('Error checking favorite:', error);
    res.status(500).json({ error: 'Failed to check favorite' });
  }
});

// Public: Get coach rating + GE rating for a player (used by player-detail tabs)
router.get('/agent/player/:playerId/ratings', async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });

    const coachRating = await db.prepare(`
      SELECT cpr.overall_score, cpr.scores_json, cpr.rater_name, cpr.updated_at
      FROM coach_player_ratings cpr
      WHERE cpr.player_id = ?
      ORDER BY cpr.updated_at DESC
      LIMIT 1
    `).get(playerId);

    const geRating = await db.prepare(
      'SELECT overall_score, scores_json, rater_name, updated_at FROM ge_player_ratings WHERE player_user_id = ?'
    ).get(playerId);

    res.json({ coachRating: coachRating || null, geRating: geRating || null });
  } catch (error) {
    console.error('Get player ratings error:', error);
    res.status(500).json({ error: 'Failed to get ratings' });
  }
});

// Agent/Admin: Upsert GE rating for a player
router.post('/agent/player/:playerId/ge-rating', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'agent' && req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });

    const { overallScore, scoresJson } = req.body;
    if (typeof overallScore !== 'number' || overallScore < 0 || overallScore > 100) {
      return res.status(400).json({ error: 'overallScore must be a number between 0 and 100' });
    }
    if (!Array.isArray(scoresJson) || scoresJson.length === 0) {
      return res.status(400).json({ error: 'scoresJson must be a non-empty array' });
    }
    for (const cat of scoresJson) {
      if (!cat.name || typeof cat.score !== 'number' || cat.score < 0 || cat.score > 100) {
        return res.status(400).json({ error: 'Each category must have a name and score (0–100)' });
      }
    }

    const agentUser = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
    const raterName = agentUser ? agentUser.full_name : null;

    await db.prepare(`
      INSERT INTO ge_player_ratings (agent_id, player_user_id, overall_score, scores_json, rater_name, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (player_user_id) DO UPDATE
        SET agent_id = EXCLUDED.agent_id,
            overall_score = EXCLUDED.overall_score,
            scores_json = EXCLUDED.scores_json,
            rater_name = EXCLUDED.rater_name,
            updated_at = CURRENT_TIMESTAMP
    `).run(req.session.userId, playerId, overallScore, JSON.stringify(scoresJson), raterName);

    const saved = await db.prepare(
      'SELECT overall_score, scores_json, rater_name, updated_at FROM ge_player_ratings WHERE player_user_id = ?'
    ).get(playerId);
    res.json(saved);
  } catch (error) {
    console.error('GE upsert rating error:', error);
    res.status(500).json({ error: 'Failed to save GE rating' });
  }
});

// Agent/Admin: Delete GE rating for a player
router.delete('/agent/player/:playerId/ge-rating', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'agent' && req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });

    await db.prepare('DELETE FROM ge_player_ratings WHERE player_user_id = ?').run(playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('GE delete rating error:', error);
    res.status(500).json({ error: 'Failed to delete GE rating' });
  }
});

module.exports = router;
