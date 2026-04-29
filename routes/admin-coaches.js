const express = require('express');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function parsePagination(query) {
  const rawPage = parseInt(query?.page, 10);
  const rawLimit = parseInt(query?.limit, 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// Admin: List all coaches with team info
router.get('/admin/coaches', requireAdmin, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query?.search || '').trim();
    const state = String(req.query?.state || '').trim().toUpperCase();

    const whereParts = ["u.role = 'coach'"];
    const whereParams = [];

    if (state) {
      whereParts.push("UPPER(COALESCE(ht.state, '')) = ?");
      whereParams.push(state);
    }

    if (search) {
      const likeSearch = `%${search}%`;
      whereParts.push(`(
        LOWER(COALESCE(u.full_name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(u.email, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ht.team_name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ht.school_name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ht.city, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ht.state, '')) LIKE LOWER(?)
      )`);
      whereParams.push(likeSearch, likeSearch, likeSearch, likeSearch, likeSearch, likeSearch);
    }

    const whereSql = `WHERE ${whereParts.join(' AND ')}`;

    const totals = await db.prepare(`
      SELECT COUNT(*)::int AS count
      FROM users u
      LEFT JOIN hs_teams ht ON ht.coach_id = u.id
      ${whereSql}
    `).get(...whereParams);
    const total = totals?.count || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const coaches = await db.prepare(`
      SELECT u.id, u.email, u.full_name, u.phone, u.created_at, u.last_login_at, u.login_count,
        ht.id AS team_id, ht.team_name, ht.school_name, ht.city, ht.state,
        (SELECT COUNT(*) FROM team_players tp WHERE tp.team_id = ht.id) AS roster_count,
        (SELECT COUNT(*) FROM team_invites ti WHERE ti.team_id = ht.id AND ti.status = 'pending') AS pending_invites
      FROM users u
      LEFT JOIN hs_teams ht ON ht.coach_id = u.id
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...whereParams, limit, offset);

    res.json({
      items: coaches,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages
      }
    });
  } catch (error) {
    console.error('Admin get coaches error:', error);
    res.status(500).json({ error: 'Failed to get coaches' });
  }
});

// Admin: List all teams
router.get('/admin/teams', requireAdmin, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query?.search || '').trim();
    const state = String(req.query?.state || '').trim().toUpperCase();

    const whereParts = [];
    const whereParams = [];

    if (state) {
      whereParts.push("UPPER(COALESCE(ht.state, '')) = ?");
      whereParams.push(state);
    }

    if (search) {
      const likeSearch = `%${search}%`;
      whereParts.push(`(
        LOWER(COALESCE(ht.team_name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ht.school_name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ht.city, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(ht.state, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(u.full_name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(u.email, '')) LIKE LOWER(?)
      )`);
      whereParams.push(likeSearch, likeSearch, likeSearch, likeSearch, likeSearch, likeSearch);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const totals = await db.prepare(`
      SELECT COUNT(*)::int AS count
      FROM hs_teams ht
      JOIN users u ON u.id = ht.coach_id
      ${whereSql}
    `).get(...whereParams);
    const total = totals?.count || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const teams = await db.prepare(`
      SELECT ht.id, ht.team_name, ht.school_name, ht.city, ht.state, ht.school_logo,
        ht.banner_color_start, ht.banner_color_end, ht.use_banner_gradient_cards, ht.created_at,
        u.id AS coach_id, u.full_name AS coach_name, u.email AS coach_email,
        (SELECT COUNT(*) FROM team_players tp WHERE tp.team_id = ht.id) AS roster_count,
        (SELECT COUNT(*) FROM team_invites ti WHERE ti.team_id = ht.id AND ti.status = 'pending') AS pending_invites
      FROM hs_teams ht
      JOIN users u ON u.id = ht.coach_id
      ${whereSql}
      ORDER BY ht.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...whereParams, limit, offset);

    res.json({
      items: teams,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages
      }
    });
  } catch (error) {
    console.error('Admin get teams error:', error);
    res.status(500).json({ error: 'Failed to get teams' });
  }
});

// Admin: Get coaches without a team (for add-team dropdown)
router.get('/admin/teams/available-coaches', requireAdmin, async (req, res) => {
  try {
    const coaches = await db.prepare(`
      SELECT u.id, u.full_name, u.email
      FROM users u
      LEFT JOIN hs_teams ht ON ht.coach_id = u.id
      WHERE u.role = 'coach' AND ht.id IS NULL
      ORDER BY u.full_name
    `).all();
    res.json(coaches);
  } catch (error) {
    console.error('Admin get available coaches error:', error);
    res.status(500).json({ error: 'Failed to get available coaches' });
  }
});

// Admin: Create team
router.post('/admin/teams', requireAdmin, async (req, res) => {
  const { coach_id, team_name, school_name, city, state, banner_color_start, banner_color_end, use_banner_gradient_cards } = req.body || {};

  const parsedCoachId = parseInt(coach_id, 10);
  if (!parsedCoachId || isNaN(parsedCoachId)) {
    return res.status(400).json({ error: 'A valid coach is required' });
  }
  const trimmedTeamName = String(team_name || '').trim();
  if (!trimmedTeamName) {
    return res.status(400).json({ error: 'Team name is required' });
  }

  try {
    const coach = await db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(parsedCoachId);
    if (!coach || coach.role !== 'coach') {
      return res.status(400).json({ error: 'Selected user is not a coach' });
    }
    const existing = await db.prepare(`SELECT id FROM hs_teams WHERE coach_id = ?`).get(parsedCoachId);
    if (existing) {
      return res.status(400).json({ error: 'This coach already has a team' });
    }

    await db.prepare(`
      INSERT INTO hs_teams (coach_id, team_name, school_name, city, state, banner_color_start, banner_color_end, use_banner_gradient_cards)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsedCoachId,
      trimmedTeamName,
      String(school_name || '').trim() || null,
      String(city || '').trim() || null,
      String(state || '').trim() || null,
      String(banner_color_start || '').trim() || null,
      String(banner_color_end || '').trim() || null,
      use_banner_gradient_cards ? 1 : 0
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Admin create team error:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Admin: Update team
router.put('/admin/teams/:id', requireAdmin, async (req, res) => {
  const teamId = parseInt(req.params.id, 10);
  if (!teamId || isNaN(teamId)) return res.status(400).json({ error: 'Invalid team ID' });

  const { team_name, school_name, city, state, banner_color_start, banner_color_end, use_banner_gradient_cards } = req.body || {};
  const trimmedTeamName = String(team_name || '').trim();
  if (!trimmedTeamName) {
    return res.status(400).json({ error: 'Team name is required' });
  }

  try {
    const team = await db.prepare(`SELECT id FROM hs_teams WHERE id = ?`).get(teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    await db.prepare(`
      UPDATE hs_teams
      SET team_name = ?, school_name = ?, city = ?, state = ?,
          banner_color_start = ?, banner_color_end = ?, use_banner_gradient_cards = ?
      WHERE id = ?
    `).run(
      trimmedTeamName,
      String(school_name || '').trim() || null,
      String(city || '').trim() || null,
      String(state || '').trim() || null,
      String(banner_color_start || '').trim() || null,
      String(banner_color_end || '').trim() || null,
      use_banner_gradient_cards ? 1 : 0,
      teamId
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Admin update team error:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// Admin: Delete team
router.delete('/admin/teams/:id', requireAdmin, async (req, res) => {
  const teamId = parseInt(req.params.id, 10);
  if (!teamId || isNaN(teamId)) return res.status(400).json({ error: 'Invalid team ID' });

  try {
    const team = await db.prepare(`SELECT id, team_name FROM hs_teams WHERE id = ?`).get(teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    await db.prepare(`DELETE FROM hs_teams WHERE id = ?`).run(teamId);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete team error:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

module.exports = router;
