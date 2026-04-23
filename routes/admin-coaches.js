const express = require('express');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin: List all coaches with team info
router.get('/admin/coaches', requireAdmin, async (req, res) => {
  try {
    const coaches = await db.prepare(`
      SELECT u.id, u.email, u.full_name, u.phone, u.created_at, u.last_login_at, u.login_count,
        ht.id AS team_id, ht.team_name, ht.school_name, ht.city, ht.state,
        (SELECT COUNT(*) FROM team_players tp WHERE tp.team_id = ht.id) AS roster_count,
        (SELECT COUNT(*) FROM team_invites ti WHERE ti.team_id = ht.id AND ti.status = 'pending') AS pending_invites
      FROM users u
      LEFT JOIN hs_teams ht ON ht.coach_id = u.id
      WHERE u.role = 'coach'
      ORDER BY u.created_at DESC
    `).all();
    res.json(coaches);
  } catch (error) {
    console.error('Admin get coaches error:', error);
    res.status(500).json({ error: 'Failed to get coaches' });
  }
});

module.exports = router;
