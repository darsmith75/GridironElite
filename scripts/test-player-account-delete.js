try { require('dotenv').config(); } catch (_) {}

const bcrypt = require('bcryptjs');
const db = require('../database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const CONFIRMATION_TEXT = 'DELETE MY ACCOUNT';

function fail(message) {
  throw new Error(message);
}

async function assertCount(sql, expectedCount, params = [], label = 'assertion') {
  const row = await db.prepare(sql).get(...params);
  const count = Number(row?.count || 0);
  if (count !== expectedCount) {
    fail(`${label} failed: expected ${expectedCount}, got ${count}`);
  }
}

async function checkServerOnline() {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) {
      fail(`Server health check failed at ${BASE_URL}/health with status ${res.status}`);
    }
  } catch (error) {
    fail(`Cannot reach server at ${BASE_URL}. Start the app first (npm start), then run npm run test:account-delete. Root cause: ${error?.message || error}`);
  }
}

async function main() {
  await checkServerOnline();
  await db.initialize();

  const now = Date.now();
  const suffix = `${now}`;

  const playerEmail = `autotest-player-${suffix}@example.com`;
  const playerPassword = `DeletePass!${suffix}`;
  const coachEmail = `autotest-coach-${suffix}@example.com`;
  const agentEmail = `autotest-agent-${suffix}@example.com`;
  const collegeName = `AutoTest College ${suffix}`;

  const created = {
    playerId: null,
    coachId: null,
    agentId: null,
    teamId: null,
    collegeId: null
  };

  try {
    const playerHash = await bcrypt.hash(playerPassword, 10);
    const coachHash = await bcrypt.hash(`CoachPass!${suffix}`, 10);
    const agentHash = await bcrypt.hash(`AgentPass!${suffix}`, 10);

    const playerInsert = await db.prepare(
      'INSERT INTO users (email, password, role, full_name, email_verified) VALUES (?, ?, ?, ?, true)'
    ).run(playerEmail, playerHash, 'player', 'Auto Test Player');
    created.playerId = Number(playerInsert.lastInsertRowid);

    const coachInsert = await db.prepare(
      'INSERT INTO users (email, password, role, full_name, email_verified) VALUES (?, ?, ?, ?, true)'
    ).run(coachEmail, coachHash, 'coach', 'Auto Test Coach');
    created.coachId = Number(coachInsert.lastInsertRowid);

    const agentInsert = await db.prepare(
      'INSERT INTO users (email, password, role, full_name, email_verified) VALUES (?, ?, ?, ?, true)'
    ).run(agentEmail, agentHash, 'agent', 'Auto Test Agent');
    created.agentId = Number(agentInsert.lastInsertRowid);

    await db.prepare('INSERT INTO player_profiles (user_id, full_name, high_school, profile_picture, card_photo, report_card_image) VALUES (?, ?, ?, ?, ?, ?)')
      .run(created.playerId, 'Auto Test Player', 'Gridiron Test HS', `${created.playerId}/profile.jpg`, `${created.playerId}/card.jpg`, `${created.playerId}/report.jpg`);

    const teamInsert = await db.prepare('INSERT INTO hs_teams (coach_id, team_name, school_name) VALUES (?, ?, ?)')
      .run(created.coachId, `Auto Team ${suffix}`, `Auto School ${suffix}`);
    created.teamId = Number(teamInsert.lastInsertRowid);

    const collegeInsert = await db.prepare('INSERT INTO colleges (name) VALUES (?)').run(collegeName);
    created.collegeId = Number(collegeInsert.lastInsertRowid);

    const ratingCategory = await db.prepare('SELECT id FROM school_rating_categories ORDER BY id ASC LIMIT 1').get();
    if (!ratingCategory?.id) {
      fail('No school rating category found for test');
    }

    await db.prepare('INSERT INTO player_contacts (user_id, role, name, email, phone) VALUES (?, ?, ?, ?, ?)')
      .run(created.playerId, 'father', 'Test Father', 'father@example.com', '5551231234');
    await db.prepare('INSERT INTO player_videos (user_id, filename) VALUES (?, ?)')
      .run(created.playerId, `${created.playerId}/highlight.mp4`);
    await db.prepare('INSERT INTO player_images (user_id, filename) VALUES (?, ?)')
      .run(created.playerId, `${created.playerId}/extra.png`);
    await db.prepare('INSERT INTO player_video_links (user_id, url, title) VALUES (?, ?, ?)')
      .run(created.playerId, 'https://example.com/video', 'Auto Video');
    await db.prepare('INSERT INTO player_metric_videos (user_id, metric_key, video_filename, is_verified, verified_by) VALUES (?, ?, ?, true, ?)')
      .run(created.playerId, 'forty_yard_dash', `${created.playerId}/metric.mp4`, 'Auto Trainer');

    await db.prepare('INSERT INTO player_school_interests (user_id, college_id, is_favorite, has_offer) VALUES (?, ?, 1, 1)')
      .run(created.playerId, created.collegeId);
    await db.prepare('INSERT INTO school_notes (user_id, college_id, note) VALUES (?, ?, ?)')
      .run(created.playerId, created.collegeId, 'Auto test note');
    await db.prepare('INSERT INTO school_contacts (user_id, college_id, name, title, email, phone) VALUES (?, ?, ?, ?, ?, ?)')
      .run(created.playerId, created.collegeId, 'Recruiter Name', 'Recruiting Coordinator', 'recruiter@example.com', '5550000000');
    await db.prepare('INSERT INTO player_school_ratings (user_id, college_id, category_id, rating_value) VALUES (?, ?, ?, 4)')
      .run(created.playerId, created.collegeId, ratingCategory.id);

    await db.prepare('INSERT INTO team_invites (team_id, player_email, player_user_id, token, status) VALUES (?, ?, ?, ?, ?)')
      .run(created.teamId, playerEmail, created.playerId, `token-${suffix}`, 'pending');
    await db.prepare('INSERT INTO team_players (team_id, player_id) VALUES (?, ?)')
      .run(created.teamId, created.playerId);
    await db.prepare('INSERT INTO coach_player_comments (coach_id, player_id, comment) VALUES (?, ?, ?)')
      .run(created.coachId, created.playerId, 'Auto test comment');
    await db.prepare('INSERT INTO agent_favorites (agent_id, user_id) VALUES (?, ?)')
      .run(created.agentId, created.playerId);

    await db.prepare('INSERT INTO ai_player_summaries (player_user_id, generated_for_user_id, generated_for_role, source_hash, model_name, prompt_version, summary_text) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(created.playerId, created.agentId, 'agent', `source-hash-${suffix}`, 'gpt-test', 'test-v1', 'Auto summary');
    await db.prepare('INSERT INTO ai_player_ratings (player_user_id, source_hash, overall_score, scores_json, model_name) VALUES (?, ?, ?, ?::jsonb, ?)')
      .run(created.playerId, `rating-hash-${suffix}`, 81, JSON.stringify({ speed: 80 }), 'gpt-test');
    await db.prepare('INSERT INTO ai_events (event_type, actor_user_id, player_user_id, metadata_json) VALUES (?, ?, ?, ?::jsonb)')
      .run('summary_generated', created.agentId, created.playerId, JSON.stringify({ source: 'test' }));
    await db.prepare('INSERT INTO site_traffic_events (event_type, path, method, user_id, role, ip_address, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)')
      .run('page_view', '/player-profile', 'GET', created.playerId, 'player', '127.0.0.1', JSON.stringify({ source: 'test' }));

    const loginRes = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: playerEmail, password: playerPassword })
    });
    if (!loginRes.ok) {
      const message = await loginRes.text();
      fail(`Login failed (${loginRes.status}): ${message}`);
    }

    const sessionCookie = loginRes.headers.get('set-cookie');
    if (!sessionCookie) {
      fail('Missing set-cookie header after login');
    }

    const deleteRes = await fetch(`${BASE_URL}/api/player/account/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({ confirmation: CONFIRMATION_TEXT })
    });

    if (!deleteRes.ok) {
      const message = await deleteRes.text();
      fail(`Account delete API failed (${deleteRes.status}): ${message}`);
    }

    await assertCount('SELECT COUNT(*)::int AS count FROM users WHERE id = ?', 0, [created.playerId], 'users row removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM player_profiles WHERE user_id = ?', 0, [created.playerId], 'player_profiles removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM player_contacts WHERE user_id = ?', 0, [created.playerId], 'player_contacts removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM player_videos WHERE user_id = ?', 0, [created.playerId], 'player_videos removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM player_images WHERE user_id = ?', 0, [created.playerId], 'player_images removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM player_video_links WHERE user_id = ?', 0, [created.playerId], 'player_video_links removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM player_metric_videos WHERE user_id = ?', 0, [created.playerId], 'player_metric_videos removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM player_school_interests WHERE user_id = ?', 0, [created.playerId], 'player_school_interests removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM school_notes WHERE user_id = ?', 0, [created.playerId], 'school_notes removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM school_contacts WHERE user_id = ?', 0, [created.playerId], 'school_contacts removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM player_school_ratings WHERE user_id = ?', 0, [created.playerId], 'player_school_ratings removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM agent_favorites WHERE user_id = ?', 0, [created.playerId], 'agent_favorites removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM team_players WHERE player_id = ?', 0, [created.playerId], 'team_players removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM team_invites WHERE player_user_id = ? OR LOWER(player_email) = LOWER(?)', 0, [created.playerId, playerEmail], 'team_invites removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM coach_player_comments WHERE player_id = ?', 0, [created.playerId], 'coach_player_comments removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM ai_player_summaries WHERE player_user_id = ?', 0, [created.playerId], 'ai_player_summaries removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM ai_player_ratings WHERE player_user_id = ?', 0, [created.playerId], 'ai_player_ratings removed');
    await assertCount('SELECT COUNT(*)::int AS count FROM ai_events WHERE actor_user_id = ? OR player_user_id = ?', 0, [created.playerId, created.playerId], 'ai_events removed for player');
    await assertCount('SELECT COUNT(*)::int AS count FROM site_traffic_events WHERE user_id = ?', 0, [created.playerId], 'site_traffic_events removed for player');

    const auditRow = await db.prepare(
      "SELECT COUNT(*)::int AS count FROM site_traffic_events WHERE event_type = 'player_account_deleted' AND metadata_json->>'deletedUserId' = ?"
    ).get(String(created.playerId));
    if (Number(auditRow?.count || 0) < 1) {
      fail('Missing player_account_deleted audit event');
    }

    console.log('PASS: Player account deletion removed all associated data and wrote audit event.');
  } finally {
    try {
      if (created.teamId) {
        await db.prepare('DELETE FROM hs_teams WHERE id = ?').run(created.teamId);
      }
      if (created.collegeId) {
        await db.prepare('DELETE FROM colleges WHERE id = ?').run(created.collegeId);
      }
      if (created.agentId) {
        await db.prepare('DELETE FROM users WHERE id = ?').run(created.agentId);
      }
      if (created.coachId) {
        await db.prepare('DELETE FROM users WHERE id = ?').run(created.coachId);
      }
      if (created.playerId) {
        await db.prepare('DELETE FROM users WHERE id = ?').run(created.playerId);
      }
    } catch (cleanupError) {
      console.error('Cleanup warning:', cleanupError?.message || cleanupError);
    }

    await db.close();
  }
}

main().catch(error => {
  console.error('FAIL:', error?.message || error);
  process.exitCode = 1;
});
