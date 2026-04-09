require('dotenv').config();
const { Pool } = require('pg');

const dbHost = process.env.DB_HOST || 'localhost';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(String(dbHost).toLowerCase());

const pool = new Pool({
  host: dbHost,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'GridironElite',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
  ssl: !isLocal ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    const dave = await pool.query(
      "SELECT id, full_name, email, role FROM users WHERE full_name ILIKE '%Guerriera%'"
    );
    console.log('Dave Guerriera:', JSON.stringify(dave.rows, null, 2));

    const george = await pool.query(
      "SELECT id, full_name, email, role FROM users WHERE full_name ILIKE '%Parkinson%'"
    );
    console.log('George Parkinson:', JSON.stringify(george.rows, null, 2));

    if (dave.rows.length > 0) {
      const team = await pool.query(
        'SELECT * FROM hs_teams WHERE coach_id = $1',
        [dave.rows[0].id]
      );
      console.log('Dave team:', JSON.stringify(team.rows, null, 2));
    }
  } finally {
    await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
