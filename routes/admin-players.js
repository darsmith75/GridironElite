const express = require('express');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { METRIC_TIP_CONFIG, METRIC_TIP_KEYS } = require('../utils/constants');
const { getMergedMetricTipsForPlayer } = require('../utils/ai-helpers');
const { normalizeOptionalInteger, normalizeOptionalFloat } = require('../utils/upload');

const router = express.Router();

// Admin: Update player profile
router.put('/admin/players/:id', requireAdmin, async (req, res) => {
  const { full_name, high_school, graduation_year, position, height, weight, gpa } = req.body;
  try {
    const profile = await db.prepare('SELECT user_id FROM player_profiles WHERE user_id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Player profile not found' });

    const normalizedGraduationYear = normalizeOptionalInteger(graduation_year);
    const normalizedWeight = normalizeOptionalInteger(weight);
    const normalizedGpa = normalizeOptionalFloat(gpa);

    await db.prepare(`UPDATE player_profiles SET full_name = ?, high_school = ?, graduation_year = ?, position = ?, height = ?, weight = ?, gpa = ? WHERE user_id = ?`)
      .run(
        full_name?.trim() || null,
        high_school?.trim() || null,
        normalizedGraduationYear,
        position?.trim() || null,
        height?.trim() || null,
        normalizedWeight,
        normalizedGpa,
        req.params.id
      );
    res.json({ success: true });
  } catch (error) {
    console.error('Admin update player error:', error);
    res.status(500).json({ error: 'Failed to update player profile' });
  }
});

// Admin: List players for per-player metric tip overrides
router.get('/admin/player-metric-pro-tips/players', requireAdmin, async (req, res) => {
  try {
    const players = await db.prepare(`
      SELECT u.id AS user_id,
        COALESCE(pp.full_name, u.full_name, u.email) AS full_name,
        pp.high_school,
        pp.graduation_year,
        pp.position
      FROM users u
      LEFT JOIN player_profiles pp ON pp.user_id = u.id
      WHERE u.role = 'player'
      ORDER BY COALESCE(pp.full_name, u.full_name, u.email) ASC
    `).all();
    res.json({ players });
  } catch (error) {
    console.error('Admin list player metric tip players error:', error);
    res.status(500).json({ error: 'Failed to load players' });
  }
});

// Admin: Get default + override + merged metric tips for a player
router.get('/admin/player-metric-pro-tips/:playerUserId', requireAdmin, async (req, res) => {
  try {
    const playerUserId = parseInt(req.params.playerUserId, 10);
    if (!Number.isInteger(playerUserId) || playerUserId <= 0) {
      return res.status(400).json({ error: 'Invalid player ID' });
    }

    const player = await db.prepare(`
      SELECT u.id AS user_id,
        COALESCE(pp.full_name, u.full_name, u.email) AS full_name,
        pp.high_school,
        pp.graduation_year,
        pp.position,
        pp.forty_yard_dash,
        pp.vertical_jump,
        pp.bench_press,
        pp.squat,
        pp.shuttle_5_10_5,
        pp.l_drill,
        pp.broad_jump,
        pp.power_clean,
        pp.single_leg_squat
      FROM users u
      LEFT JOIN player_profiles pp ON pp.user_id = u.id
      WHERE u.id = ? AND u.role = 'player'
      LIMIT 1
    `).get(playerUserId);

    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const tips = await getMergedMetricTipsForPlayer(playerUserId);
    res.json({
      player,
      metrics: METRIC_TIP_CONFIG,
      defaults: tips.defaults,
      overrides: tips.overrides,
      tips: tips.merged
    });
  } catch (error) {
    console.error('Admin get player metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to load player metric tips' });
  }
});

// Admin: Save metric tip overrides for a player
router.put('/admin/player-metric-pro-tips/:playerUserId', requireAdmin, async (req, res) => {
  try {
    const playerUserId = parseInt(req.params.playerUserId, 10);
    if (!Number.isInteger(playerUserId) || playerUserId <= 0) {
      return res.status(400).json({ error: 'Invalid player ID' });
    }

    const playerExists = await db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(playerUserId, 'player');
    if (!playerExists) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const incomingTips = req.body?.tips;
    if (!incomingTips || typeof incomingTips !== 'object') {
      return res.status(400).json({ error: 'Invalid tips payload' });
    }

    for (const [metricKey, tipValue] of Object.entries(incomingTips)) {
      if (!METRIC_TIP_KEYS.has(metricKey)) continue;
      const tipText = (tipValue || '').toString().trim();
      if (!tipText) {
        await db.prepare(
          'DELETE FROM player_metric_pro_tips WHERE player_user_id = ? AND metric_key = ?'
        ).run(playerUserId, metricKey);
        continue;
      }

      await db.prepare(`
        INSERT INTO player_metric_pro_tips (player_user_id, metric_key, tip_text, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (player_user_id, metric_key)
        DO UPDATE SET
          tip_text = EXCLUDED.tip_text,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = CURRENT_TIMESTAMP
      `).run(playerUserId, metricKey, tipText, req.session.userId);
    }

    const tips = await getMergedMetricTipsForPlayer(playerUserId);
    res.json({ success: true, metrics: METRIC_TIP_CONFIG, overrides: tips.overrides, tips: tips.merged });
  } catch (error) {
    console.error('Admin save player metric pro tips error:', error);
    res.status(500).json({ error: 'Failed to save player metric tips' });
  }
});

module.exports = router;
