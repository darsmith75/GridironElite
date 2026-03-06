const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database('football_platform.db');

const columns = db.prepare('PRAGMA table_info(users)').all();
console.log('Users table columns:');
columns.forEach(col => console.log(`- ${col.name} (${col.type})`));

const agent = db.prepare('SELECT * FROM users WHERE email = ?').get('agent2@example.com');
console.log('\nCurrent agent2 data:');
console.log(JSON.stringify(agent, null, 2));

db.close();
