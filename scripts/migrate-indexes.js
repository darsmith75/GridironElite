/**
 * migrate-indexes.js
 *
 * Adds missing performance indexes to the database.
 * Safe to run multiple times — all statements use IF NOT EXISTS.
 *
 * Usage against local DB (uses .env):
 *   node scripts/migrate-indexes.js
 *
 * Usage against a different DB without changing .env:
 *   $env:DB_HOST="host"; $env:DB_PORT="5432"; $env:DB_NAME="db"; $env:DB_USER="user"; $env:DB_PASS="pass"; node scripts/migrate-indexes.js
 */

const db = require('../database');

const indexes = [
  {
    name: 'idx_users_email_lower',
    description: 'Case-insensitive login lookup: LOWER(email) = ?',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_lower ON users (LOWER(email))`
  },
  {
    name: 'idx_player_profiles_grad_year_position',
    description: 'Agent/recruiter search filters by graduation year and position',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_player_profiles_grad_year_position ON player_profiles (graduation_year, position)`
  },
  {
    name: 'idx_player_profiles_profile_view_count',
    description: 'Top-viewed players sort on admin dashboard',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_player_profiles_profile_view_count ON player_profiles (profile_view_count DESC NULLS LAST)`
  },
  {
    name: 'idx_team_invites_team_status',
    description: 'Pending invite count per team in admin/coach queries',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_invites_team_status ON team_invites (team_id, status)`
  },
  {
    name: 'idx_site_traffic_ip_created',
    description: 'Unique visitor IP count query on admin dashboard (partial index, excludes NULLs)',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_site_traffic_ip_created ON site_traffic_events (ip_address, created_at DESC) WHERE ip_address IS NOT NULL AND ip_address <> ''`
  }
];

(async () => {
  console.log(`\nTarget: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || '(default)'}`);
  console.log(`Running ${indexes.length} index migration(s)...\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const idx of indexes) {
    process.stdout.write(`  ${idx.name}\n    ${idx.description}\n    → `);
    try {
      await db.query(idx.sql);
      console.log('OK\n');
      ok++;
    } catch (e) {
      const msg = e.message.split('\n')[0];
      if (msg.includes('already exists')) {
        console.log('already exists (skipped)\n');
        skipped++;
      } else {
        console.log(`FAILED: ${msg}\n`);
        failed++;
      }
    }
  }

  console.log(`Done. ${ok} created, ${skipped} already existed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
  process.exit();
})();
