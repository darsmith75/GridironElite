const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { upload, processUploadedFiles, normalizeOptionalInteger } = require('../utils/upload');
const { requireAuth, requireAgent } = require('../middleware/auth');
const { enrichPlayerProfile } = require('../utils/enrich-player');
const { replaceUserFile } = require('../utils/file-mgmt');
const { normalizeCollegeLogoRows } = require('../utils/college-logo-path');
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
      )
    `;
    const token = `%${normalizedFilters.quickSearch}%`;
    params.push(token, token, token);
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
        pp.power_clean,
        pp.single_leg_squat,
        pp.catapult,
        pp.metric_1080,
        pp.hand_size,
        pp.wingspan,
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

// Agent: Get all saved school contacts
router.get('/agent/contacts', requireAgent, async (req, res) => {
  try {
    const contacts = await db.prepare(`
      SELECT sc.id, sc.college_id, sc.name, sc.title, sc.email, sc.phone,
        sc.twitter_handle, sc.instagram_handle,
        c.name AS college_name, c.division, c.conference
      FROM school_contacts sc
      JOIN colleges c ON c.id = sc.college_id
      WHERE sc.user_id = ?
      ORDER BY c.name ASC, sc.name ASC
    `).all(req.session.userId);
    res.json(contacts);
  } catch (error) {
    console.error('Agent get contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Agent: Get all colleges with followed status
router.get('/agent/colleges', requireAgent, async (req, res) => {
  try {
    const colleges = await db.prepare('SELECT * FROM colleges ORDER BY name ASC').all();
    const interests = await db.prepare('SELECT college_id, is_favorite FROM player_school_interests WHERE user_id = ?').all(req.session.userId);
    const followMap = {};
    interests.forEach((i) => { followMap[i.college_id] = i.is_favorite; });
    const result = colleges.map((c) => ({
      ...c,
      is_followed: followMap[c.id] ? 1 : 0
    }));
    res.json(normalizeCollegeLogoRows(result));
  } catch (error) {
    console.error('Agent get colleges error:', error);
    res.status(500).json({ error: 'Failed to get colleges' });
  }
});

// Agent: Toggle follow on a college
router.post('/agent/colleges/:collegeId/follow', requireAgent, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (Number.isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });
    const updated = await db.prepare(`
      INSERT INTO player_school_interests (user_id, college_id, is_favorite, has_offer, updated_at)
      VALUES (?, ?, 1, 0, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, college_id)
      DO UPDATE SET
        is_favorite = CASE WHEN player_school_interests.is_favorite = 1 THEN 0 ELSE 1 END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING is_favorite
    `).get(req.session.userId, collegeId);
    res.json({ is_followed: updated?.is_favorite ? 1 : 0 });
  } catch (error) {
    console.error('Agent toggle follow error:', error);
    res.status(500).json({ error: 'Failed to toggle follow' });
  }
});

// Agent: Get notes for a college
router.get('/agent/colleges/:collegeId/notes', requireAgent, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (Number.isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const notes = await db.prepare(`
      SELECT * FROM school_notes
      WHERE user_id = ? AND college_id = ?
      ORDER BY COALESCE(
        CASE WHEN visit_date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN visit_date::date ELSE NULL END,
        created_at::date
      ) DESC, created_at DESC
    `).all(req.session.userId, collegeId);
    res.json(notes);
  } catch (error) {
    console.error('Agent get school notes error:', error);
    res.status(500).json({ error: 'Failed to get notes' });
  }
});

// Agent: Add a note for a college
router.post('/agent/colleges/:collegeId/notes', requireAgent, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (Number.isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });
    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });
    await db.prepare('INSERT INTO school_notes (user_id, college_id, note, visit_date) VALUES (?, ?, ?, ?)')
      .run(req.session.userId, collegeId, note.trim(), visitDate || null);
    res.json({ success: true });
  } catch (error) {
    console.error('Agent add school note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Agent: Update a note
router.put('/agent/colleges/:collegeId/notes/:noteId', requireAgent, async (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (Number.isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });
    const existing = await db.prepare('SELECT id FROM school_notes WHERE id = ? AND user_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });
    await db.prepare('UPDATE school_notes SET note = ?, visit_date = ? WHERE id = ?').run(note.trim(), visitDate || null, noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Agent update school note error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Agent: Delete a note
router.delete('/agent/colleges/:collegeId/notes/:noteId', requireAgent, async (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (Number.isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });
    const existing = await db.prepare('SELECT id FROM school_notes WHERE id = ? AND user_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });
    await db.prepare('DELETE FROM school_notes WHERE id = ?').run(noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Agent delete school note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Agent: Get contacts for a college
router.get('/agent/colleges/:collegeId/contacts', requireAgent, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (Number.isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const contacts = await db.prepare('SELECT * FROM school_contacts WHERE user_id = ? AND college_id = ? ORDER BY name ASC').all(req.session.userId, collegeId);
    res.json(contacts);
  } catch (error) {
    console.error('Agent get school contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Agent: Add a contact for a college
router.post('/agent/colleges/:collegeId/contacts', requireAgent, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (Number.isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { name, title, email, phone, twitterHandle, followsPlayerOnTwitter, instagramHandle, followsPlayerOnInstagram } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });
    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });
    await db.prepare(
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
    res.json({ success: true });
  } catch (error) {
    console.error('Agent add school contact error:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// Agent: Update a contact
router.put('/agent/colleges/:collegeId/contacts/:contactId', requireAgent, async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (Number.isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
    const { name, title, email, phone, twitterHandle, followsPlayerOnTwitter, instagramHandle, followsPlayerOnInstagram } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });
    const existing = await db.prepare('SELECT id FROM school_contacts WHERE id = ? AND user_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    await db.prepare(
      'UPDATE school_contacts SET name = ?, title = ?, email = ?, phone = ?, twitter_handle = ?, follows_player_on_twitter = ?, instagram_handle = ?, follows_player_on_instagram = ? WHERE id = ?'
    ).run(
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
    console.error('Agent update school contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Agent: Delete a contact
router.delete('/agent/colleges/:collegeId/contacts/:contactId', requireAgent, async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (Number.isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
    const existing = await db.prepare('SELECT id FROM school_contacts WHERE id = ? AND user_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    await db.prepare('DELETE FROM school_contacts WHERE id = ?').run(contactId);
    res.json({ success: true });
  } catch (error) {
    console.error('Agent delete school contact error:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

module.exports = router;
