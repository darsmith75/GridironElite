const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database('football_platform.db');

// Check if agent_favorites table exists
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_favorites'").all();
console.log('Agent favorites table exists:', tables.length > 0);

if (tables.length > 0) {
  // Show table structure
  const columns = db.prepare('PRAGMA table_info(agent_favorites)').all();
  console.log('\nTable structure:');
  columns.forEach(col => console.log(`- ${col.name} (${col.type})`));
  
  // Show current favorites count
  const count = db.prepare('SELECT COUNT(*) as count FROM agent_favorites').get();
  console.log(`\nCurrent favorites count: ${count.count}`);
}

db.close();
console.log('\nFavorites system is ready!');
