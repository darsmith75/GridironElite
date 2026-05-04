const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const { requireCoach } = require('../middleware/auth');
const { enrichPlayerProfiles } = require('../utils/enrich-player');
const { upload, processUploadedFiles } = require('../utils/upload');
const { deleteUploadFile } = require('../utils/file-mgmt');
const { normalizeHexColor, getPublicAppUrl } = require('../utils/helpers');
const { normalizeCollegeLogoRows } = require('../utils/college-logo-path');
const { sendTeamInviteEmail } = require('../utils/email');

const router = express.Router();

function trimOrNull(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : null;
}

function parseSortOrder(value) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseBooleanFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizePublicUrl(value) {
  const trimmed = trimOrNull(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

// Coach: Get own team info
router.get('/coach/team', requireCoach, async (req, res) => {
  try {
    let coachId = req.session.userId;
    // admin impersonation: pass ?coachId=X
    if (req.session.role === 'admin' && req.query.coachId) {
      coachId = parseInt(req.query.coachId, 10);
    }
    const team = await db.prepare(`
      SELECT id, coach_id, team_name, school_name, school_logo, school_overview,
             team_website, twitter_url, instagram_url, facebook_url, youtube_url, tiktok_url,
             banner_color_start, banner_color_end, use_banner_gradient_cards,
             banner_image, city, state, created_at
      FROM hs_teams
      WHERE coach_id = ?
    `).get(coachId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const coach = await db.prepare('SELECT full_name, email, phone FROM users WHERE id = ?').get(coachId);
    res.json({ ...team, coach });
  } catch (error) {
    console.error('Coach get team error:', error);
    res.status(500).json({ error: 'Failed to get team' });
  }
});

// Coach: Update team info
router.put('/coach/team', requireCoach, async (req, res) => {
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
router.post('/coach/team/logo', requireCoach, upload.single('schoolLogo'), async (req, res) => {
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
    res.status(500).json({ error: 'Failed to upload school logo' });
  }
});

// Coach: Upload/update team page background banner image
router.post('/coach/team/banner-image', requireCoach, upload.single('bannerImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Banner image file is required' });
    }
    const team = await db.prepare('SELECT id, banner_image FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    await processUploadedFiles(req.session.userId, { bannerImage: [req.file] });
    const bannerImage = req.session.userId + '/' + req.file.filename;

    if (team.banner_image && team.banner_image !== bannerImage) {
      await deleteUploadFile(team.banner_image);
    }

    await db.prepare('UPDATE hs_teams SET banner_image = ? WHERE id = ?').run(bannerImage, team.id);
    res.json({ success: true, bannerImage });
  } catch (error) {
    console.error('Coach upload banner image error:', error);
    res.status(500).json({ error: 'Failed to upload banner image' });
  }
});

// Coach: Save team banner gradient colors
router.put('/coach/team/banner-colors', requireCoach, async (req, res) => {
  try {
    const startColor = normalizeHexColor(req.body?.startColor);
    const endColor = normalizeHexColor(req.body?.endColor);
    const applyToPlayerCards = req.body?.applyToPlayerCards === true || req.body?.applyToPlayerCards === 'true' || req.body?.applyToPlayerCards === 1;

    if (!startColor || !endColor) {
      return res.status(400).json({ error: 'Valid startColor and endColor hex values are required.' });
    }

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    await db.prepare(
      'UPDATE hs_teams SET banner_color_start = ?, banner_color_end = ?, use_banner_gradient_cards = ? WHERE id = ?'
    ).run(startColor, endColor, applyToPlayerCards, team.id);

    res.json({
      success: true,
      bannerColorStart: startColor,
      bannerColorEnd: endColor,
      useBannerGradientCards: applyToPlayerCards
    });
  } catch (error) {
    console.error('Coach save banner colors error:', error);
    res.status(500).json({ error: 'Failed to save banner colors' });
  }
});

// Coach: Update public team page details (overview + social links)
router.put('/coach/team/public-profile', requireCoach, async (req, res) => {
  try {
    const rawLinks = {
      teamWebsite: req.body?.teamWebsite,
      twitterUrl: req.body?.twitterUrl,
      instagramUrl: req.body?.instagramUrl,
      facebookUrl: req.body?.facebookUrl,
      youtubeUrl: req.body?.youtubeUrl,
      tiktokUrl: req.body?.tiktokUrl
    };

    const normalizedLinks = Object.fromEntries(
      Object.entries(rawLinks).map(([key, value]) => [key, normalizePublicUrl(value)])
    );

    const invalidField = Object.entries(rawLinks).find(([key, value]) => trimOrNull(value) && !normalizedLinks[key]);
    if (invalidField) {
      return res.status(400).json({ error: 'Public links must be valid http or https URLs' });
    }

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    await db.prepare(`
      UPDATE hs_teams
      SET school_overview = ?,
          team_website = ?,
          twitter_url = ?,
          instagram_url = ?,
          facebook_url = ?,
          youtube_url = ?,
          tiktok_url = ?
      WHERE id = ?
    `).run(
      trimOrNull(req.body?.schoolOverview),
      normalizedLinks.teamWebsite,
      normalizedLinks.twitterUrl,
      normalizedLinks.instagramUrl,
      normalizedLinks.facebookUrl,
      normalizedLinks.youtubeUrl,
      normalizedLinks.tiktokUrl,
      team.id
    );

    const updated = await db.prepare(`
      SELECT school_overview, team_website, twitter_url, instagram_url, facebook_url, youtube_url, tiktok_url
      FROM hs_teams
      WHERE id = ?
    `).get(team.id);

    res.json({ success: true, profile: updated || {} });
  } catch (error) {
    console.error('Coach update team public profile error:', error);
    res.status(500).json({ error: 'Failed to update public team profile' });
  }
});

// Coach: List schedule items for own team
router.get('/coach/team/schedule', requireCoach, async (req, res) => {
  try {
    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const items = await db.prepare(`
      SELECT id, opponent_name, event_date, event_time, location, is_home, notes, sort_order, created_at, updated_at
      FROM team_schedules
      WHERE team_id = ?
      ORDER BY COALESCE(event_date, DATE '2999-12-31') ASC, sort_order ASC, id ASC
    `).all(team.id);

    res.json(items);
  } catch (error) {
    console.error('Coach get team schedule error:', error);
    res.status(500).json({ error: 'Failed to load team schedule' });
  }
});

// Coach: Create schedule item
router.post('/coach/team/schedule', requireCoach, async (req, res) => {
  try {
    const opponentName = trimOrNull(req.body?.opponentName);
    if (!opponentName) {
      return res.status(400).json({ error: 'Opponent name is required' });
    }

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const result = await db.prepare(`
      INSERT INTO team_schedules (team_id, opponent_name, event_date, event_time, location, is_home, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      team.id,
      opponentName,
      trimOrNull(req.body?.eventDate),
      trimOrNull(req.body?.eventTime),
      trimOrNull(req.body?.location),
      parseBooleanFlag(req.body?.isHome),
      trimOrNull(req.body?.notes),
      parseSortOrder(req.body?.sortOrder)
    );

    const created = await db.prepare(`
      SELECT id, opponent_name, event_date, event_time, location, is_home, notes, sort_order, created_at, updated_at
      FROM team_schedules
      WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(created);
  } catch (error) {
    console.error('Coach create team schedule error:', error);
    res.status(500).json({ error: 'Failed to create schedule item' });
  }
});

// Coach: Update schedule item
router.put('/coach/team/schedule/:id', requireCoach, async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    if (Number.isNaN(scheduleId)) return res.status(400).json({ error: 'Invalid schedule ID' });

    const opponentName = trimOrNull(req.body?.opponentName);
    if (!opponentName) {
      return res.status(400).json({ error: 'Opponent name is required' });
    }

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const existing = await db.prepare('SELECT id FROM team_schedules WHERE id = ? AND team_id = ?').get(scheduleId, team.id);
    if (!existing) return res.status(404).json({ error: 'Schedule item not found' });

    await db.prepare(`
      UPDATE team_schedules
      SET opponent_name = ?,
          event_date = ?,
          event_time = ?,
          location = ?,
          is_home = ?,
          notes = ?,
          sort_order = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      opponentName,
      trimOrNull(req.body?.eventDate),
      trimOrNull(req.body?.eventTime),
      trimOrNull(req.body?.location),
      parseBooleanFlag(req.body?.isHome),
      trimOrNull(req.body?.notes),
      parseSortOrder(req.body?.sortOrder),
      scheduleId
    );

    const updated = await db.prepare(`
      SELECT id, opponent_name, event_date, event_time, location, is_home, notes, sort_order, created_at, updated_at
      FROM team_schedules
      WHERE id = ?
    `).get(scheduleId);

    res.json(updated);
  } catch (error) {
    console.error('Coach update team schedule error:', error);
    res.status(500).json({ error: 'Failed to update schedule item' });
  }
});

// Coach: Delete schedule item
router.delete('/coach/team/schedule/:id', requireCoach, async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    if (Number.isNaN(scheduleId)) return res.status(400).json({ error: 'Invalid schedule ID' });

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const existing = await db.prepare('SELECT id FROM team_schedules WHERE id = ? AND team_id = ?').get(scheduleId, team.id);
    if (!existing) return res.status(404).json({ error: 'Schedule item not found' });

    await db.prepare('DELETE FROM team_schedules WHERE id = ?').run(scheduleId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach delete team schedule error:', error);
    res.status(500).json({ error: 'Failed to delete schedule item' });
  }
});

// Coach: List staff members for own team
router.get('/coach/team/staff', requireCoach, async (req, res) => {
  try {
    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const items = await db.prepare(`
      SELECT id, full_name, role_title, bio, email, phone, sort_order, created_at, updated_at
      FROM team_staff_members
      WHERE team_id = ?
      ORDER BY sort_order ASC, full_name ASC, id ASC
    `).all(team.id);

    res.json(items);
  } catch (error) {
    console.error('Coach get team staff error:', error);
    res.status(500).json({ error: 'Failed to load team staff' });
  }
});

// Coach: Create staff member
router.post('/coach/team/staff', requireCoach, async (req, res) => {
  try {
    const fullName = trimOrNull(req.body?.fullName);
    const roleTitle = trimOrNull(req.body?.roleTitle);
    if (!fullName || !roleTitle) {
      return res.status(400).json({ error: 'Staff name and role are required' });
    }

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const result = await db.prepare(`
      INSERT INTO team_staff_members (team_id, full_name, role_title, bio, email, phone, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      team.id,
      fullName,
      roleTitle,
      trimOrNull(req.body?.bio),
      trimOrNull(req.body?.email),
      trimOrNull(req.body?.phone),
      parseSortOrder(req.body?.sortOrder)
    );

    const created = await db.prepare(`
      SELECT id, full_name, role_title, bio, email, phone, sort_order, created_at, updated_at
      FROM team_staff_members
      WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(created);
  } catch (error) {
    console.error('Coach create team staff error:', error);
    res.status(500).json({ error: 'Failed to create staff member' });
  }
});

// Coach: Update staff member
router.put('/coach/team/staff/:id', requireCoach, async (req, res) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    if (Number.isNaN(staffId)) return res.status(400).json({ error: 'Invalid staff ID' });

    const fullName = trimOrNull(req.body?.fullName);
    const roleTitle = trimOrNull(req.body?.roleTitle);
    if (!fullName || !roleTitle) {
      return res.status(400).json({ error: 'Staff name and role are required' });
    }

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const existing = await db.prepare('SELECT id FROM team_staff_members WHERE id = ? AND team_id = ?').get(staffId, team.id);
    if (!existing) return res.status(404).json({ error: 'Staff member not found' });

    await db.prepare(`
      UPDATE team_staff_members
      SET full_name = ?,
          role_title = ?,
          bio = ?,
          email = ?,
          phone = ?,
          sort_order = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      fullName,
      roleTitle,
      trimOrNull(req.body?.bio),
      trimOrNull(req.body?.email),
      trimOrNull(req.body?.phone),
      parseSortOrder(req.body?.sortOrder),
      staffId
    );

    const updated = await db.prepare(`
      SELECT id, full_name, role_title, bio, email, phone, sort_order, created_at, updated_at
      FROM team_staff_members
      WHERE id = ?
    `).get(staffId);

    res.json(updated);
  } catch (error) {
    console.error('Coach update team staff error:', error);
    res.status(500).json({ error: 'Failed to update staff member' });
  }
});

// Coach: Delete staff member
router.delete('/coach/team/staff/:id', requireCoach, async (req, res) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    if (Number.isNaN(staffId)) return res.status(400).json({ error: 'Invalid staff ID' });

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const existing = await db.prepare('SELECT id FROM team_staff_members WHERE id = ? AND team_id = ?').get(staffId, team.id);
    if (!existing) return res.status(404).json({ error: 'Staff member not found' });

    await db.prepare('DELETE FROM team_staff_members WHERE id = ?').run(staffId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach delete team staff error:', error);
    res.status(500).json({ error: 'Failed to delete staff member' });
  }
});

// Coach: Get team roster (enriched player profiles)
router.get('/coach/team/roster', requireCoach, async (req, res) => {
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
    await enrichPlayerProfiles(players);
    res.json(players);
  } catch (error) {
    console.error('Coach get roster error:', error);
    res.status(500).json({ error: 'Failed to get roster' });
  }
});

// Coach: Remove player from team
router.delete('/coach/team/roster/:playerId', requireCoach, async (req, res) => {
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

// Coach: Get own comment for a player
router.get('/coach/players/:playerId/comment', requireCoach, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });
    const row = await db.prepare('SELECT comment, updated_at FROM coach_player_comments WHERE coach_id = ? AND player_id = ?').get(req.session.userId, playerId);
    res.json(row || null);
  } catch (error) {
    console.error('Coach get comment error:', error);
    res.status(500).json({ error: 'Failed to get comment' });
  }
});

// Coach: Upsert a comment on a player's profile (player must be on coach's team)
router.post('/coach/players/:playerId/comment', requireCoach, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });
    const { comment } = req.body;
    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({ error: 'Comment text is required' });
    }
    const trimmed = comment.trim();
    if (trimmed.length > 2000) return res.status(400).json({ error: 'Comment must be 2000 characters or fewer' });

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(403).json({ error: 'No team found for this coach' });

    const onTeam = await db.prepare('SELECT id FROM team_players WHERE team_id = ? AND player_id = ?').get(team.id, playerId);
    if (!onTeam) return res.status(403).json({ error: 'Player is not on your team' });

    await db.prepare(`
      INSERT INTO coach_player_comments (coach_id, player_id, comment, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (coach_id, player_id) DO UPDATE
        SET comment = EXCLUDED.comment, updated_at = CURRENT_TIMESTAMP
    `).run(req.session.userId, playerId, trimmed);

    const saved = await db.prepare('SELECT * FROM coach_player_comments WHERE coach_id = ? AND player_id = ?').get(req.session.userId, playerId);
    res.json(saved);
  } catch (error) {
    console.error('Coach upsert comment error:', error);
    res.status(500).json({ error: 'Failed to save comment' });
  }
});

// Coach: Delete own comment on a player's profile
router.delete('/coach/players/:playerId/comment', requireCoach, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(403).json({ error: 'No team found for this coach' });

    const onTeam = await db.prepare('SELECT id FROM team_players WHERE team_id = ? AND player_id = ?').get(team.id, playerId);
    if (!onTeam) return res.status(403).json({ error: 'Player is not on your team' });

    await db.prepare('DELETE FROM coach_player_comments WHERE coach_id = ? AND player_id = ?').run(req.session.userId, playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Coach: Get own rating for a player
router.get('/coach/players/:playerId/rating', requireCoach, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });
    const row = await db.prepare('SELECT overall_score, scores_json, rater_name, updated_at FROM coach_player_ratings WHERE coach_id = ? AND player_id = ?').get(req.session.userId, playerId);
    res.json(row || null);
  } catch (error) {
    console.error('Coach get rating error:', error);
    res.status(500).json({ error: 'Failed to get rating' });
  }
});

// Coach: Upsert a rating for a player (player must be on team)
router.post('/coach/players/:playerId/rating', requireCoach, async (req, res) => {
  try {
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

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(403).json({ error: 'No team found for this coach' });

    const onTeam = await db.prepare('SELECT id FROM team_players WHERE team_id = ? AND player_id = ?').get(team.id, playerId);
    if (!onTeam) return res.status(403).json({ error: 'Player is not on your team' });

    const coachUser = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
    const raterName = coachUser ? coachUser.full_name : null;

    await db.prepare(`
      INSERT INTO coach_player_ratings (coach_id, player_id, overall_score, scores_json, rater_name, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (coach_id, player_id) DO UPDATE
        SET overall_score = EXCLUDED.overall_score,
            scores_json = EXCLUDED.scores_json,
            rater_name = EXCLUDED.rater_name,
            updated_at = CURRENT_TIMESTAMP
    `).run(req.session.userId, playerId, overallScore, JSON.stringify(scoresJson), raterName);

    const saved = await db.prepare('SELECT overall_score, scores_json, rater_name, updated_at FROM coach_player_ratings WHERE coach_id = ? AND player_id = ?').get(req.session.userId, playerId);
    res.json(saved);
  } catch (error) {
    console.error('Coach upsert rating error:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// Coach: Delete own rating for a player
router.delete('/coach/players/:playerId/rating', requireCoach, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId, 10);
    if (isNaN(playerId)) return res.status(400).json({ error: 'Invalid player ID' });

    const team = await db.prepare('SELECT id FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(403).json({ error: 'No team found for this coach' });

    const onTeam = await db.prepare('SELECT id FROM team_players WHERE team_id = ? AND player_id = ?').get(team.id, playerId);
    if (!onTeam) return res.status(403).json({ error: 'Player is not on your team' });

    await db.prepare('DELETE FROM coach_player_ratings WHERE coach_id = ? AND player_id = ?').run(req.session.userId, playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach delete rating error:', error);
    res.status(500).json({ error: 'Failed to delete rating' });
  }
});

// Coach: Send invite to a player by email
router.post('/coach/invite', requireCoach, async (req, res) => {
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

    const team = await db.prepare('SELECT id, team_name, school_name FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
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

    let result;
    try {
      result = await db.prepare(
        'INSERT INTO team_invites (team_id, player_email, player_user_id, token, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(team.id, normalizedEmail, playerUser?.id || null, token, 'pending', expiresAt.toISOString());
    } catch (insertError) {
      if (insertError?.code === '23505') {
        return res.status(409).json({ error: 'A pending invite already exists for this email' });
      }
      throw insertError;
    }

    const coach = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
    try {
      await sendTeamInviteEmail(normalizedEmail, token, coach?.full_name, team.team_name, team.school_name, req);
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
router.get('/coach/invites', requireCoach, async (req, res) => {
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
router.delete('/coach/invites/:id', requireCoach, async (req, res) => {
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

// Coach: Share selected roster players with a recruiter by secure link
router.post('/coach/recruiter-shares', requireCoach, async (req, res) => {
  try {
    const recruiterEmail = String(req.body?.recruiterEmail || '').trim().toLowerCase();
    const recipientEmailsRaw = Array.isArray(req.body?.recipientEmails) ? req.body.recipientEmails : [];
    const playerUserIdsRaw = Array.isArray(req.body?.playerUserIds) ? req.body.playerUserIds : [];
    const emailSubject = String(req.body?.subject || '').trim();
    const emailMessage = String(req.body?.message || '').trim().slice(0, 5000);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedRecipients = [...new Set(
      [
        ...recipientEmailsRaw,
        recruiterEmail
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )];

    if (normalizedRecipients.length === 0) {
      return res.status(400).json({ error: 'At least one recipient email is required' });
    }

    if (!normalizedRecipients.every((email) => emailRegex.test(email))) {
      return res.status(400).json({ error: 'One or more recipient emails are invalid' });
    }

    if (normalizedRecipients.length > 50) {
      return res.status(400).json({ error: 'You can send to up to 50 recipients at once' });
    }

    const selectedPlayerIds = [...new Set(
      playerUserIdsRaw
        .map(value => parseInt(value, 10))
        .filter(value => Number.isInteger(value) && value > 0)
    )];

    if (selectedPlayerIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one player' });
    }

    if (selectedPlayerIds.length > 50) {
      return res.status(400).json({ error: 'You can share up to 50 players at once' });
    }

    const team = await db.prepare('SELECT id, team_name, school_name FROM hs_teams WHERE coach_id = ?').get(req.session.userId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const placeholders = selectedPlayerIds.map(() => '?').join(', ');
    const rosterMatches = await db.prepare(
      `SELECT player_id FROM team_players WHERE team_id = ? AND player_id IN (${placeholders})`
    ).all(team.id, ...selectedPlayerIds);

    if (rosterMatches.length !== selectedPlayerIds.length) {
      return res.status(400).json({ error: 'One or more selected players are not on your roster' });
    }

    const expiresAt = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000));

    // Single token shared with all recipients.
    const shareToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(shareToken).digest('hex');
    const recipientEmailsStored = normalizedRecipients.join(', ').substring(0, 254);

    const shareId = await db.withTransaction(async (tx) => {
      const insertedShare = await tx.prepare(`
        INSERT INTO recruiter_player_shares (
          coach_user_id, team_id, recipient_email, token_hash, subject, message, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.session.userId,
        team.id,
        recipientEmailsStored,
        tokenHash,
        emailSubject || null,
        emailMessage || null,
        expiresAt.toISOString()
      );
      const newShareId = insertedShare.lastInsertRowid;
      const valuesClause = selectedPlayerIds.map(() => '(?, ?)').join(', ');
      const valuesParams = selectedPlayerIds.flatMap((playerId) => [newShareId, playerId]);
      await tx.prepare(
        `INSERT INTO recruiter_player_share_items (share_id, player_user_id) VALUES ${valuesClause}`
      ).run(...valuesParams);
      return newShareId;
    });

    const appUrl = getPublicAppUrl(req);
    const shareUrl = `${appUrl}/recruiter-share.html?token=${encodeURIComponent(shareToken)}`;

    res.json({
      success: true,
      shareCount: 1,
      shareIds: [shareId],
      shareUrl,
      firstShareUrl: shareUrl,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Coach create recruiter share error:', error);
    res.status(500).json({ error: 'Failed to share players' });
  }
});

// Coach: Get own profile
router.get('/coach/profile', requireCoach, async (req, res) => {
  try {
    let targetCoachId = req.session.userId;
    if (req.session.role === 'admin' && req.query.coachId) {
      const parsedCoachId = parseInt(req.query.coachId, 10);
      if (!Number.isNaN(parsedCoachId)) {
        targetCoachId = parsedCoachId;
      }
    }

    const coach = await db.prepare('SELECT email, full_name, phone, organization, profile_picture FROM users WHERE id = ? AND role = ?').get(targetCoachId, 'coach');
    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    const team = await db.prepare('SELECT team_name, school_name, city, state, school_logo, banner_color_start, banner_color_end, banner_image FROM hs_teams WHERE coach_id = ?').get(targetCoachId);
    res.json({ ...coach, team: team || {} });
  } catch (error) {
    console.error('Coach get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Coach: Update own profile
router.post('/coach/profile', requireCoach, async (req, res) => {
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

// Coach: Upload/update profile photo
router.post('/coach/profile/photo', requireCoach, upload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Profile picture file is required' });
    }

    const coach = await db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.session.userId);

    await processUploadedFiles(req.session.userId, { profilePicture: [req.file] });
    const profilePicture = req.session.userId + '/' + req.file.filename;

    if (coach?.profile_picture && coach.profile_picture !== profilePicture) {
      await deleteUploadFile(coach.profile_picture);
    }

    await db.prepare('UPDATE users SET profile_picture = ? WHERE id = ?').run(profilePicture, req.session.userId);
    res.json({ success: true, profilePicture });
  } catch (error) {
    console.error('Coach upload profile photo error:', error);
    res.status(500).json({ error: 'Failed to upload profile photo' });
  }
});

// Coach: Change password
router.post('/coach/change-password', requireCoach, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const coach = await db.prepare('SELECT password FROM users WHERE id = ?').get(req.session.userId);
    if (!coach || !(await bcrypt.compare(currentPassword, coach.password))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ======== Coach College Routes ========

// Coach: Get all saved school contacts
router.get('/coach/contacts', requireCoach, async (req, res) => {
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
    console.error('Coach get contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Coach: Get all colleges with followed status
router.get('/coach/colleges', requireCoach, async (req, res) => {
  try {
    const colleges = await db.prepare('SELECT * FROM colleges ORDER BY name ASC').all();
    const interests = await db.prepare('SELECT college_id, is_favorite FROM player_school_interests WHERE user_id = ?').all(req.session.userId);
    const followMap = {};
    interests.forEach(i => { followMap[i.college_id] = i.is_favorite; });
    const result = colleges.map(c => ({
      ...c,
      is_followed: followMap[c.id] ? 1 : 0
    }));
    res.json(normalizeCollegeLogoRows(result));
  } catch (error) {
    console.error('Coach get colleges error:', error);
    res.status(500).json({ error: 'Failed to get colleges' });
  }
});

// Coach: Toggle follow on a college
router.post('/coach/colleges/:collegeId/follow', requireCoach, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
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
    console.error('Coach toggle follow error:', error);
    res.status(500).json({ error: 'Failed to toggle follow' });
  }
});

// Coach: Get notes for a college
router.get('/coach/colleges/:collegeId/notes', requireCoach, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
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
    console.error('Coach get school notes error:', error);
    res.status(500).json({ error: 'Failed to get notes' });
  }
});

// Coach: Add a note for a college
router.post('/coach/colleges/:collegeId/notes', requireCoach, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });
    const college = await db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });
    const result = await db.prepare('INSERT INTO school_notes (user_id, college_id, note, visit_date) VALUES (?, ?, ?, ?)').run(req.session.userId, collegeId, note.trim(), visitDate || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Coach add school note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Coach: Update a note
router.put('/coach/colleges/:collegeId/notes/:noteId', requireCoach, async (req, res) => {
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
    console.error('Coach update school note error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Coach: Delete a note
router.delete('/coach/colleges/:collegeId/notes/:noteId', requireCoach, async (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });
    const existing = await db.prepare('SELECT id FROM school_notes WHERE id = ? AND user_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });
    await db.prepare('DELETE FROM school_notes WHERE id = ?').run(noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach delete school note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Coach: Get contacts for a college
router.get('/coach/colleges/:collegeId/contacts', requireCoach, async (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const contacts = await db.prepare('SELECT * FROM school_contacts WHERE user_id = ? AND college_id = ? ORDER BY name ASC').all(req.session.userId, collegeId);
    res.json(contacts);
  } catch (error) {
    console.error('Coach get school contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Coach: Add a contact for a college
router.post('/coach/colleges/:collegeId/contacts', requireCoach, async (req, res) => {
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
    console.error('Coach add school contact error:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// Coach: Update a contact
router.put('/coach/colleges/:collegeId/contacts/:contactId', requireCoach, async (req, res) => {
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
    console.error('Coach update school contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Coach: Delete a contact
router.delete('/coach/colleges/:collegeId/contacts/:contactId', requireCoach, async (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
    const existing = await db.prepare('SELECT id FROM school_contacts WHERE id = ? AND user_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    await db.prepare('DELETE FROM school_contacts WHERE id = ?').run(contactId);
    res.json({ success: true });
  } catch (error) {
    console.error('Coach delete school contact error:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

module.exports = router;
