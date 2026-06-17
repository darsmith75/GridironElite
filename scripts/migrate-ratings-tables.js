require('dotenv').config();
const db = require('../database');

async function main() {
  console.log('Dropping coach_player_ratings and ge_player_ratings tables...');

  await db.exec(`
    DROP TABLE IF EXISTS coach_player_ratings;
    DROP TABLE IF EXISTS ge_player_ratings;
  `);

  console.log('Done. Tables dropped successfully.');
  await db.close();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
