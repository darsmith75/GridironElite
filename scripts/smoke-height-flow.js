try { require('dotenv').config(); } catch (_) {}

const bcrypt = require('bcryptjs');
const db = require('../database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

function fail(message) {
  throw new Error(message);
}

async function checkServerOnline() {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) {
      fail(`Server health check failed at ${BASE_URL}/health with status ${res.status}`);
    }
  } catch (error) {
    fail(`Cannot reach server at ${BASE_URL}. Start the app first (npm start). Root cause: ${error?.message || error}`);
  }
}

function getSessionCookie(response) {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  return String(header).split(';')[0];
}

async function main() {
  await checkServerOnline();
  await db.initialize();

  const suffix = String(Date.now());
  const email = `autotest-height-${suffix}@example.com`;
  const password = `HeightPass!${suffix}`;
  const fullName = `Auto Height ${suffix}`;

  let playerId = null;

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const userInsert = await db.prepare(
      'INSERT INTO users (email, password, role, full_name, email_verified) VALUES (?, ?, ?, ?, true)'
    ).run(email, passwordHash, 'player', fullName);
    playerId = Number(userInsert.lastInsertRowid);

    await db.prepare(
      'INSERT INTO player_profiles (user_id, full_name, high_school, position) VALUES (?, ?, ?, ?)'
    ).run(playerId, fullName, 'Auto Test HS', 'WR');

    const loginRes = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!loginRes.ok) {
      const body = await loginRes.text();
      fail(`Login failed (${loginRes.status}): ${body}`);
    }

    const sessionCookie = getSessionCookie(loginRes);
    if (!sessionCookie) {
      fail('Missing set-cookie header after login');
    }

    const form = new FormData();
    form.append('fullName', fullName);
    form.append('highSchool', 'Auto Test HS');
    form.append('position', 'WR');
    form.append('height', '74.5');

    const profileSaveRes = await fetch(`${BASE_URL}/api/player/profile`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie
      },
      body: form
    });

    if (!profileSaveRes.ok) {
      const body = await profileSaveRes.text();
      fail(`Profile save failed (${profileSaveRes.status}): ${body}`);
    }

    const updated = await db.prepare('SELECT height, height_inches FROM player_profiles WHERE user_id = ?').get(playerId);
    if (!updated) fail('Failed to load updated profile row');
    if (Number(updated.height_inches) !== 75) {
      fail(`Expected height_inches=75 after profile save, got ${updated.height_inches}`);
    }

    const searchToken = suffix;
    const filterRes = await fetch(`${BASE_URL}/api/agent/players?quickSearch=${encodeURIComponent(searchToken)}&minHeight=75&limit=20`);
    if (!filterRes.ok) {
      const body = await filterRes.text();
      fail(`Agent filter request failed (${filterRes.status}): ${body}`);
    }

    const filterPayload = await filterRes.json();
    const filteredPlayers = Array.isArray(filterPayload.players) ? filterPayload.players : [];
    const foundAt75 = filteredPlayers.find((p) => Number(p.user_id || p.id) === playerId);
    if (!foundAt75) {
      fail('Expected player to be returned by minHeight=75 filter');
    }
    if (foundAt75.height_inches != null && Number(foundAt75.height_inches) < 75) {
      fail(`Expected returned player height_inches >= 75, got ${foundAt75.height_inches}`);
    }

    const tooTallRes = await fetch(`${BASE_URL}/api/agent/players?quickSearch=${encodeURIComponent(searchToken)}&minHeight=76&limit=20`);
    if (!tooTallRes.ok) {
      const body = await tooTallRes.text();
      fail(`Agent strict filter request failed (${tooTallRes.status}): ${body}`);
    }

    const tooTallPayload = await tooTallRes.json();
    const strictPlayers = Array.isArray(tooTallPayload.players) ? tooTallPayload.players : [];
    const foundAt76 = strictPlayers.find((p) => Number(p.user_id || p.id) === playerId);
    if (foundAt76) {
      fail('Expected player to be excluded by minHeight=76 filter');
    }

    console.log('PASS: Profile save writes height_inches and agent minHeight filter works.');
  } finally {
    try {
      if (playerId) {
        await db.prepare('DELETE FROM users WHERE id = ?').run(playerId);
      }
    } catch (cleanupError) {
      console.error('Cleanup warning:', cleanupError?.message || cleanupError);
    }

    await db.close();
  }
}

main().catch((error) => {
  console.error('FAIL:', error?.message || error);
  process.exitCode = 1;
});
