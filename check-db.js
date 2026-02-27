const db = require('./database');

async function checkDatabase() {
  console.log('\n=== USERS ===');
  const users = db.prepare('SELECT id, email, role FROM users').all();
  console.table(users);

  console.log('\n=== PLAYER PROFILES ===');
  const profiles = db.prepare('SELECT id, user_id, full_name, position, graduation_year FROM player_profiles').all();
  console.table(profiles);
}

checkDatabase().catch(console.error);
