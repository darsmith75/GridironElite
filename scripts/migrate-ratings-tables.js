require('dotenv').config();
const db = require('../database');

async function main() {
  console.log('Creating coach_player_ratings and ge_player_ratings tables...');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS coach_player_ratings (
      id SERIAL PRIMARY KEY,
      coach_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      overall_score INTEGER NOT NULL CHECK(overall_score >= 0 AND overall_score <= 100),
      scores_json JSONB NOT NULL,
      rater_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(coach_id, player_id),
      FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ge_player_ratings (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      player_user_id INTEGER NOT NULL UNIQUE,
      overall_score INTEGER NOT NULL CHECK(overall_score >= 0 AND overall_score <= 100),
      scores_json JSONB NOT NULL,
      rater_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (player_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_coach_player_ratings_coach ON coach_player_ratings(coach_id);
    CREATE INDEX IF NOT EXISTS idx_coach_player_ratings_player ON coach_player_ratings(player_id);
    CREATE INDEX IF NOT EXISTS idx_ge_player_ratings_player ON ge_player_ratings(player_user_id)
  `);

  console.log('Done. Tables created successfully.');
  await db.close();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
