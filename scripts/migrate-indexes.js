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
    name: 'ext_pg_trgm',
    description: 'Enable trigram indexes for fast contains search',
    sql: 'CREATE EXTENSION IF NOT EXISTS pg_trgm'
  },
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
  },
  {
    name: 'idx_pp_full_name_trgm',
    description: 'Agent quick search on player full name',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pp_full_name_trgm ON player_profiles USING gin (LOWER(COALESCE(full_name, '')) gin_trgm_ops)`
  },
  {
    name: 'idx_pp_high_school_trgm',
    description: 'Agent quick search on high school',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pp_high_school_trgm ON player_profiles USING gin (LOWER(COALESCE(high_school, '')) gin_trgm_ops)`
  },
  {
    name: 'idx_pp_position_trgm',
    description: 'Agent quick search on position text',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pp_position_trgm ON player_profiles USING gin (LOWER(COALESCE(position, '')) gin_trgm_ops)`
  },
  {
    name: 'idx_users_full_name_trgm',
    description: 'Admin search on users full_name',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_full_name_trgm ON users USING gin (LOWER(COALESCE(full_name, '')) gin_trgm_ops)`
  },
  {
    name: 'idx_users_email_trgm',
    description: 'Admin search on users email',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_trgm ON users USING gin (LOWER(email) gin_trgm_ops)`
  },
  {
    name: 'idx_hs_teams_team_name_trgm',
    description: 'Admin team search on team name',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hs_teams_team_name_trgm ON hs_teams USING gin (LOWER(COALESCE(team_name, '')) gin_trgm_ops)`
  },
  {
    name: 'idx_hs_teams_school_name_trgm',
    description: 'Admin team search on school name',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hs_teams_school_name_trgm ON hs_teams USING gin (LOWER(COALESCE(school_name, '')) gin_trgm_ops)`
  },
  {
    name: 'idx_hs_teams_city_trgm',
    description: 'Admin team search on city',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hs_teams_city_trgm ON hs_teams USING gin (LOWER(COALESCE(city, '')) gin_trgm_ops)`
  },
  {
    name: 'idx_hs_teams_state_trgm',
    description: 'Admin team search on state',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hs_teams_state_trgm ON hs_teams USING gin (LOWER(COALESCE(state, '')) gin_trgm_ops)`
  },
  {
    name: 'idx_team_invites_pending_player_expires',
    description: 'Pending invite lookup by player_user_id with expiry filter',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_invites_pending_player_expires ON team_invites (player_user_id, expires_at DESC, sent_at DESC) WHERE status = 'pending'`
  },
  {
    name: 'idx_team_invites_pending_email_expires',
    description: 'Pending invite lookup by player_email (case-insensitive) with expiry filter',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_invites_pending_email_expires ON team_invites (LOWER(player_email), expires_at DESC, sent_at DESC) WHERE status = 'pending'`
  },
  {
    name: 'idx_team_invites_team_sent_desc',
    description: 'Coach invite list by team ordered by sent_at desc',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_invites_team_sent_desc ON team_invites (team_id, sent_at DESC)`
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
