const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const { requireCoach } = require('../middleware/auth');
const { requireAuth } = require('../middleware/auth');
const { enrichPlayerProfile } = require('../utils/enrich-player');
const { upload, processUploadedFiles } = require('../utils/upload');
const { deleteUploadFile } = require('../utils/file-mgmt');
const { normalizeHexColor, getPublicAppUrl } = require('../utils/helpers');
const { getPublicAppUrl: _getPublicAppUrl, sendTeamInviteEmail, sendRecruiterShareEmail } = require('../utils/email');

const router = express.Router();

// Coach: Get own team info
router.get('/coach/team', requireCoach, async (req, res) => {
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
    const playerUserIdsRaw = Array.isArray(req.body?.playerUserIds) ? req.body.playerUserIds : [];
    const emailSubject = String(req.body?.subject || '').trim();
    const emailMessage = String(req.body?.message || '').trim().slice(0, 5000);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recruiterEmail)) {
      return res.status(400).json({ error: 'Valid recruiter email is required' });
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

    const shareToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(shareToken).digest('hex');
    const expiresAt = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000));

    await db.query('BEGIN');
    let shareId;
    try {
      const insertedShare = await db.prepare(`
        INSERT INTO recruiter_player_shares (
          coach_user_id, team_id, recipient_email, token_hash, subject, message, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.session.userId,
        team.id,
        recruiterEmail,
        tokenHash,
        emailSubject || null,
        emailMessage || null,
        expiresAt.toISOString()
      );

      shareId = insertedShare.lastInsertRowid;
      for (const playerId of selectedPlayerIds) {
        await db.prepare(
          'INSERT INTO recruiter_player_share_items (share_id, player_user_id) VALUES (?, ?)'
        ).run(shareId, playerId);
      }
      await db.query('COMMIT');
    } catch (txError) {
      await db.query('ROLLBACK');
      throw txError;
    }

    const coach = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
    const appUrl = _getPublicAppUrl(req);
    const shareUrl = `${appUrl}/recruiter-share.html?token=${encodeURIComponent(shareToken)}`;

    let emailSent = true;
    try {
      await sendRecruiterShareEmail({
        toEmail: recruiterEmail,
        shareToken,
        coachName: coach?.full_name,
        teamName: team.team_name,
        schoolName: team.school_name,
        subject: emailSubject,
        message: emailMessage,
        playerCount: selectedPlayerIds.length,
        expiresAt,
        appUrl
      });
    } catch (emailError) {
      emailSent = false;
      console.error('Failed to send recruiter share email:', emailError.message || emailError);
    }

    res.json({
      success: true,
      shareId,
      shareUrl,
      emailSent,
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
    const team = await db.prepare('SELECT team_name, school_name, city, state, school_logo, banner_color_start, banner_color_end FROM hs_teams WHERE coach_id = ?').get(targetCoachId);
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

// ======== Coach College Routes ========

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
    res.json(result);
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
    const existing = await db.prepare('SELECT id, is_favorite FROM player_school_interests WHERE user_id = ? AND college_id = ?').get(req.session.userId, collegeId);
    if (existing) {
      const newVal = existing.is_favorite ? 0 : 1;
      await db.prepare('UPDATE player_school_interests SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, existing.id);
      res.json({ is_followed: newVal });
    } else {
      await db.prepare('INSERT INTO player_school_interests (user_id, college_id, is_favorite) VALUES (?, ?, 1)').run(req.session.userId, collegeId);
      res.json({ is_followed: 1 });
    }
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
