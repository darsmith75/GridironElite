const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database('football_platform.db');

console.log('Adding social media username columns to player_profiles table...');

try {
  // Add social media username columns
  db.prepare(`
    ALTER TABLE player_profiles 
    ADD COLUMN hudl_username TEXT
  `).run();
  console.log('Added hudl_username column');

  db.prepare(`
    ALTER TABLE player_profiles 
    ADD COLUMN instagram_username TEXT
  `).run();
  console.log('Added instagram_username column');

  db.prepare(`
    ALTER TABLE player_profiles 
    ADD COLUMN twitter_username TEXT
  `).run();
  console.log('Added twitter_username column');

  console.log('\nSuccessfully added all social media username columns!');
} catch (error) {
  if (error.message.includes('duplicate column name')) {
    console.log('Columns already exist, skipping...');
  } else {
    console.error('Error:', error.message);
  }
}

db.close();
