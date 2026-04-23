const express = require('express');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { getPendingB2DeleteQueueSnapshot, processPendingB2DeleteQueue } = require('../utils/b2-queue');

const router = express.Router();

// Admin: Get comprehensive statistics dashboard
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
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

    res.json({
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
    });
  } catch (error) {
    console.error('Admin get stats error:', error);
    res.status(500).json({ error: 'Failed to load statistics' });
  }
});

// Admin: Get B2 delete queue status
router.get('/admin/b2-delete-queue', requireAdmin, async (req, res) => {
  try {
    const snapshot = getPendingB2DeleteQueueSnapshot();
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
        remaining: getPendingB2DeleteQueueSnapshot().size
      })
    });
  } catch (error) {
    console.error('Admin flush B2 delete queue error:', error);
    res.status(500).json({ error: 'Failed to flush B2 delete queue' });
  }
});

module.exports = router;
