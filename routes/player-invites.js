const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Player: Get pending team invites for the logged-in player
router.get('/player/team-invites', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'player') return res.status(403).json({ error: 'Forbidden' });
    const player = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
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
router.post('/player/team-invites/:id/accept', requireAuth, async (req, res) => {
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

    await db.prepare(
      'INSERT INTO team_players (team_id, player_id) VALUES (?, ?) ON CONFLICT (team_id, player_id) DO NOTHING'
    ).run(invite.team_id, req.session.userId);

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
router.post('/player/team-invites/:id/decline', requireAuth, async (req, res) => {
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
router.get('/team-invites/accept', requireAuth, async (req, res) => {
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

module.exports = router;
