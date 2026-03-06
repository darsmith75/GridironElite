const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database('football_platform.db');

console.log('Adding social media columns to player_profiles table...');

try {
  // Add social media columns
  db.prepare(`
    ALTER TABLE player_profiles 
    ADD COLUMN hudl_link TEXT
  `).run();
  console.log('Added hudl_link column');

  db.prepare(`
    ALTER TABLE player_profiles 
    ADD COLUMN instagram_link TEXT
  `).run();
  console.log('Added instagram_link column');

  db.prepare(`
    ALTER TABLE player_profiles 
    ADD COLUMN twitter_link TEXT
  `).run();
  console.log('Added twitter_link column');

  console.log('\nSuccessfully added all social media columns!');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('Columns already exist, skipping...');
  } else {
    console.error('Error:', error.message);
  }
}

db.close();
