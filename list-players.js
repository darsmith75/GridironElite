const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database('football_platform.db');

const players = db.prepare(`
  SELECT u.email, p.full_name 
  FROM users u 
  JOIN player_profiles p ON u.id = p.user_id 
  WHERE u.role = 'player'
`).all();

console.log('Players in database:');
players.forEach(p => console.log(`- ${p.full_name} (${p.email})`));

db.close();
