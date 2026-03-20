const db = require('./database');

console.log('Adding social media columns to player_profiles table...');

async function main() {
  try {
    await db.exec(`
      ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS hudl_link TEXT;
      ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS instagram_link TEXT;
      ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS twitter_link TEXT;
    `);
    console.log('Social media columns are present.');
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main();
