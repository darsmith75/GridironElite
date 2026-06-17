try { require('dotenv').config(); } catch (_) {}

const { Pool } = require('pg');
const { parseHeightToInches } = require('./utils/height');

const dbHost = process.env.DB_HOST || 'localhost';
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(String(dbHost).toLowerCase());
const shouldUseSsl =
  process.env.DB_SSL === 'true' ||
  process.env.DB_SSLMODE === 'require' ||
  (!isLocalHost && process.env.DB_SSL !== 'false');

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'GridironElite',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '30', 10),
  min: parseInt(process.env.DB_MIN_CONNECTIONS || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '30000', 10)
};

if (shouldUseSsl) {
  poolConfig.ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
  };
}

const pool = new Pool(poolConfig);

// Prevent process crashes from transient errors on idle pooled clients.
pool.on('error', (error) => {
  console.error('PostgreSQL pool idle client error:', error?.message || error);
});

const insertPrimaryKeys = {
  users: 'id',
  player_profiles: 'user_id',
  agent_favorites: 'id',
  colleges: 'id',
  player_videos: 'id',
  player_images: 'id',
  player_contacts: 'id',
  player_video_links: 'id',
  player_metric_videos: 'id',
  metric_pro_tips: 'id',
  player_metric_pro_tips: 'id',
  site_ad_slots: 'id',
  site_traffic_events: 'id',
  player_school_interests: 'id',
  school_notes: 'id',
  school_contacts: 'id',
  school_rating_categories: 'id',
  player_school_ratings: 'id',
  ai_player_summaries: 'id',
  ai_events: 'id',
  hs_teams: 'id',
  team_invites: 'id',
  team_players: 'id',
  recruiter_player_shares: 'id',
  recruiter_player_share_items: 'id'
};

const createTablesSQL = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role VARCHAR(50) NOT NULL CHECK(role IN ('player', 'agent', 'admin', 'coach')),
    full_name VARCHAR(255),
    phone VARCHAR(20),
    organization VARCHAR(255),
    title VARCHAR(255),
    experience INTEGER,
    bio TEXT,
    profile_picture TEXT,
    last_login_at TIMESTAMP,
    login_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS player_profiles (
    user_id INTEGER PRIMARY KEY NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    high_school VARCHAR(255),
    graduation_year INTEGER,
    position VARCHAR(50),
    height VARCHAR(10),
    height_inches SMALLINT,
    weight INTEGER,
    forty_yard_dash DECIMAL(5,2),
    bench_press INTEGER,
    squat INTEGER,
    vertical_jump DECIMAL(5,2),
    shuttle_5_10_5 DECIMAL(5,2),
    l_drill DECIMAL(5,2),
    broad_jump DECIMAL(5,2),
    power_clean INTEGER,
    single_leg_squat INTEGER,
    catapult DECIMAL(8,2),
    metric_1080 DECIMAL(8,2),
    gpa DECIMAL(4,2),
    achievement TEXT,
    profile_picture TEXT,
    card_photo TEXT,
    report_card_image TEXT,
    phone VARCHAR(20),
    bio TEXT,
    hudl_link TEXT,
    instagram_link TEXT,
    twitter_link TEXT,
    hudl_username TEXT,
      instagram_username TEXT,
      twitter_username TEXT,
      profile_view_count INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_favorites (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, user_id),
    FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS colleges (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    website_url TEXT,
    division VARCHAR(100),
    logo TEXT,
    conference VARCHAR(100),
    team VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS player_videos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS player_images (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS player_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    role VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(20),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS player_video_links (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS player_metric_videos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    metric_key VARCHAR(64) NOT NULL,
    video_filename TEXT NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR(255),
    recorded_at DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, metric_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS metric_pro_tips (
    id SERIAL PRIMARY KEY,
    metric_key VARCHAR(64) UNIQUE NOT NULL,
    tip_text TEXT,
    updated_by_user_id INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS player_metric_pro_tips (
    id SERIAL PRIMARY KEY,
    player_user_id INTEGER NOT NULL,
    metric_key VARCHAR(64) NOT NULL,
    tip_text TEXT NOT NULL,
    updated_by_user_id INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(player_user_id, metric_key),
    FOREIGN KEY (player_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS site_ad_slots (
    id SERIAL PRIMARY KEY,
    slot_key VARCHAR(120) UNIQUE NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    content_html TEXT,
    updated_by_user_id INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS site_traffic_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    path TEXT,
    method VARCHAR(10),
    user_id INTEGER,
    role VARCHAR(50),
    ip_address TEXT,
    user_agent TEXT,
    referer TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS player_school_interests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    is_favorite INTEGER DEFAULT 0,
    has_offer INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, college_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS school_notes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    visit_date VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS school_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    title VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(20),
    twitter_handle VARCHAR(255),
    follows_player_on_twitter BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS school_rating_categories (
    id SERIAL PRIMARY KEY,
    category_name VARCHAR(120) UNIQUE NOT NULL,
    what_to_rate TEXT NOT NULL,
    why_it_matters TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by_user_id INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS player_school_ratings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    rating_value INTEGER NOT NULL CHECK(rating_value BETWEEN 1 AND 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, college_id, category_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES school_rating_categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_player_summaries (
    id SERIAL PRIMARY KEY,
    player_user_id INTEGER NOT NULL,
    generated_for_user_id INTEGER,
    generated_for_role VARCHAR(50) NOT NULL,
    source_hash VARCHAR(64) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    prompt_version VARCHAR(50) NOT NULL,
    summary_text TEXT NOT NULL,
    strengths_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    improvement_areas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_score NUMERIC(4,3),
    safety_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (generated_for_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS ai_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    actor_user_id INTEGER,
    player_user_id INTEGER,
    summary_id INTEGER,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (player_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (summary_id) REFERENCES ai_player_summaries(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS distributed_rate_limits (
    bucket_key VARCHAR(255) NOT NULL,
    window_start TIMESTAMP NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bucket_key, window_start)
  );

  CREATE TABLE IF NOT EXISTS distributed_response_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json JSONB NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS b2_delete_queue (
    object_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_attempt_at TIMESTAMP,
    next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_until TIMESTAMP,
    locked_by VARCHAR(120),
    reason TEXT,
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE IF NOT EXISTS hs_teams (
    id SERIAL PRIMARY KEY,
    coach_id INTEGER UNIQUE NOT NULL,
    team_name VARCHAR(255) NOT NULL,
    school_name VARCHAR(255),
    school_logo VARCHAR(255),
    school_overview TEXT,
    team_website TEXT,
    twitter_url TEXT,
    instagram_url TEXT,
    facebook_url TEXT,
    youtube_url TEXT,
    tiktok_url TEXT,
    banner_color_start VARCHAR(7),
    banner_color_end VARCHAR(7),
    use_banner_gradient_cards BOOLEAN NOT NULL DEFAULT FALSE,
    city VARCHAR(100),
    state VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_schedules (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL,
    opponent_name VARCHAR(255) NOT NULL,
    event_date DATE,
    event_time VARCHAR(50),
    location VARCHAR(255),
    is_home BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES hs_teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_staff_members (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role_title VARCHAR(255) NOT NULL,
    bio TEXT,
    email VARCHAR(255),
    phone VARCHAR(50),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES hs_teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_invites (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL,
    player_email VARCHAR(255) NOT NULL,
    player_user_id INTEGER,
    token VARCHAR(128) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES hs_teams(id) ON DELETE CASCADE,
    FOREIGN KEY (player_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS team_players (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, player_id),
    FOREIGN KEY (team_id) REFERENCES hs_teams(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recruiter_player_shares (
    id SERIAL PRIMARY KEY,
    coach_user_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    subject TEXT,
    message TEXT,
    expires_at TIMESTAMP NOT NULL,
    first_opened_at TIMESTAMP,
    open_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (coach_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES hs_teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recruiter_player_share_items (
    id SERIAL PRIMARY KEY,
    share_id INTEGER NOT NULL,
    player_user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(share_id, player_user_id),
    FOREIGN KEY (share_id) REFERENCES recruiter_player_shares(id) ON DELETE CASCADE,
    FOREIGN KEY (player_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS coach_player_comments (
    id SERIAL PRIMARY KEY,
    coach_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    comment TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(coach_id, player_id),
    FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_player_ratings (
    id SERIAL PRIMARY KEY,
    player_user_id INTEGER NOT NULL UNIQUE,
    source_hash VARCHAR(64) NOT NULL,
    overall_score INTEGER NOT NULL,
    scores_json JSONB NOT NULL,
    model_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
    CREATE INDEX IF NOT EXISTS idx_coach_player_comments_coach ON coach_player_comments(coach_id);
    CREATE INDEX IF NOT EXISTS idx_coach_player_comments_player ON coach_player_comments(player_id);
  CREATE INDEX IF NOT EXISTS idx_ai_player_ratings_player ON ai_player_ratings(player_user_id);

`;

const alterTablesSQL = `
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS hudl_link TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS instagram_link TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS twitter_link TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS hudl_username TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS instagram_username TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS twitter_username TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS achievement TEXT;
    ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS profile_view_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS college_logo_order JSONB DEFAULT '{}'::jsonb;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS height_inches SMALLINT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS birth_date DATE;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS catapult DECIMAL(8,2);
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS metric_1080 DECIMAL(8,2);
  ALTER TABLE school_contacts ADD COLUMN IF NOT EXISTS twitter_handle VARCHAR(255);
  ALTER TABLE school_contacts ADD COLUMN IF NOT EXISTS follows_player_on_twitter BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE school_contacts ADD COLUMN IF NOT EXISTS instagram_handle VARCHAR(255);
  ALTER TABLE school_contacts ADD COLUMN IF NOT EXISTS follows_player_on_instagram BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS school_logo VARCHAR(255);
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS school_overview TEXT;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS team_website TEXT;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS twitter_url TEXT;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS instagram_url TEXT;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS facebook_url TEXT;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS youtube_url TEXT;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS tiktok_url TEXT;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS banner_color_start VARCHAR(7);
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS banner_color_end VARCHAR(7);
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS use_banner_gradient_cards BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE hs_teams ADD COLUMN IF NOT EXISTS banner_image VARCHAR(255);
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('player', 'agent', 'admin', 'coach'));
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0;
  DROP TABLE IF EXISTS messages;
  DROP TABLE IF EXISTS coach_player_ratings;
  DROP TABLE IF EXISTS ge_player_ratings;
  ALTER TABLE metric_pro_tips ADD COLUMN IF NOT EXISTS youtube_url TEXT;
  ALTER TABLE colleges ADD COLUMN IF NOT EXISTS division VARCHAR(100);
  DELETE FROM team_invites older
  USING team_invites newer
  WHERE older.id < newer.id
    AND older.team_id = newer.team_id
    AND LOWER(older.player_email) = LOWER(newer.player_email)
    AND older.status = 'pending'
    AND newer.status = 'pending';
  UPDATE colleges
  SET division = 'NCAA Division I (FBS)'
  WHERE (division IS NULL OR TRIM(division) = '')
    AND conference IN (
      'ACC',
      'American',
      'Big 12',
      'Big Ten',
      'Conference USA',
      'FBS Independents',
      'Mid-American',
      'Mountain West',
      'Pac-12',
      'SEC',
      'Sun Belt'
    );
`;

const createIndexesSQL = `
  CREATE INDEX IF NOT EXISTS idx_school_interests_user ON player_school_interests(user_id);
  CREATE INDEX IF NOT EXISTS idx_school_interests_college ON player_school_interests(college_id);
  CREATE INDEX IF NOT EXISTS idx_school_notes_user ON school_notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_school_notes_college ON school_notes(college_id);
  CREATE INDEX IF NOT EXISTS idx_school_contacts_user ON school_contacts(user_id);
  CREATE INDEX IF NOT EXISTS idx_school_contacts_college ON school_contacts(college_id);
  CREATE INDEX IF NOT EXISTS idx_colleges_division ON colleges(division);
  CREATE INDEX IF NOT EXISTS idx_colleges_conference ON colleges(conference);
  CREATE INDEX IF NOT EXISTS idx_school_rating_categories_sort ON school_rating_categories(sort_order);
  CREATE INDEX IF NOT EXISTS idx_player_school_ratings_user_college ON player_school_ratings(user_id, college_id);
  CREATE INDEX IF NOT EXISTS idx_player_school_ratings_category ON player_school_ratings(category_id);
  CREATE INDEX IF NOT EXISTS idx_favorites_agent ON agent_favorites(agent_id);
  CREATE INDEX IF NOT EXISTS idx_favorites_agent_user ON agent_favorites(agent_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_profiles_user ON player_profiles(user_id);
  CREATE INDEX IF NOT EXISTS idx_profiles_height_inches ON player_profiles(height_inches);
  CREATE INDEX IF NOT EXISTS idx_profiles_position ON player_profiles(position);
  CREATE INDEX IF NOT EXISTS idx_profiles_graduation_year ON player_profiles(graduation_year);
  CREATE INDEX IF NOT EXISTS idx_profiles_gpa ON player_profiles(gpa);
  CREATE INDEX IF NOT EXISTS idx_profiles_forty_yard_dash ON player_profiles(forty_yard_dash);
  CREATE INDEX IF NOT EXISTS idx_profiles_weight ON player_profiles(weight);
  CREATE INDEX IF NOT EXISTS idx_profiles_vertical_jump ON player_profiles(vertical_jump);
  CREATE INDEX IF NOT EXISTS idx_profiles_bench_press ON player_profiles(bench_press);
  CREATE INDEX IF NOT EXISTS idx_profiles_squat ON player_profiles(squat);
  CREATE INDEX IF NOT EXISTS idx_profiles_shuttle_5_10_5 ON player_profiles(shuttle_5_10_5);
  CREATE INDEX IF NOT EXISTS idx_profiles_l_drill ON player_profiles(l_drill);
  CREATE INDEX IF NOT EXISTS idx_profiles_broad_jump ON player_profiles(broad_jump);
  CREATE INDEX IF NOT EXISTS idx_profiles_catapult ON player_profiles(catapult);
  CREATE INDEX IF NOT EXISTS idx_profiles_metric_1080 ON player_profiles(metric_1080);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_users_role_created ON users(role, created_at);
  CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email));
  CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token) WHERE email_verification_token IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users(password_reset_token) WHERE password_reset_token IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_player_videos_user ON player_videos(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_images_user ON player_images(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_contacts_user ON player_contacts(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_video_links_user ON player_video_links(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_metric_videos_user ON player_metric_videos(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_metric_videos_user_verified ON player_metric_videos(user_id, is_verified);
  CREATE INDEX IF NOT EXISTS idx_metric_pro_tips_key ON metric_pro_tips(metric_key);
  CREATE INDEX IF NOT EXISTS idx_player_metric_pro_tips_player ON player_metric_pro_tips(player_user_id);
  CREATE INDEX IF NOT EXISTS idx_site_ad_slots_key ON site_ad_slots(slot_key);
  CREATE INDEX IF NOT EXISTS idx_site_traffic_events_type ON site_traffic_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_site_traffic_events_created_at ON site_traffic_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_site_traffic_events_type_created ON site_traffic_events(event_type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_site_traffic_events_user ON site_traffic_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_ai_summary_player_active ON ai_player_summaries(player_user_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_ai_summary_source_hash ON ai_player_summaries(player_user_id, source_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_summary_cache ON ai_player_summaries(player_user_id, generated_for_role, source_hash, prompt_version, model_name) WHERE is_active = TRUE;
  CREATE INDEX IF NOT EXISTS idx_ai_events_event_type ON ai_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_ai_events_created_at ON ai_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_events_player ON ai_events(player_user_id);
  CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON distributed_rate_limits(expires_at);
  CREATE INDEX IF NOT EXISTS idx_response_cache_expires_at ON distributed_response_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_b2_delete_queue_next_attempt ON b2_delete_queue(next_attempt_at, queued_at);
  CREATE INDEX IF NOT EXISTS idx_b2_delete_queue_locked_until ON b2_delete_queue(locked_until);
  CREATE INDEX IF NOT EXISTS idx_hs_teams_coach ON hs_teams(coach_id);
  CREATE INDEX IF NOT EXISTS idx_team_schedules_team ON team_schedules(team_id);
  CREATE INDEX IF NOT EXISTS idx_team_schedules_date ON team_schedules(event_date);
  CREATE INDEX IF NOT EXISTS idx_team_staff_members_team ON team_staff_members(team_id);
  CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id);
  CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(player_email);
  CREATE INDEX IF NOT EXISTS idx_team_invites_player ON team_invites(player_user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_team_pending_invite ON team_invites(team_id, LOWER(player_email)) WHERE status = 'pending';
  CREATE INDEX IF NOT EXISTS idx_team_players_team ON team_players(team_id);
  CREATE INDEX IF NOT EXISTS idx_team_players_player ON team_players(player_id);
  CREATE INDEX IF NOT EXISTS idx_recruiter_shares_coach ON recruiter_player_shares(coach_user_id);
  CREATE INDEX IF NOT EXISTS idx_recruiter_shares_team ON recruiter_player_shares(team_id);
  CREATE INDEX IF NOT EXISTS idx_recruiter_shares_email ON recruiter_player_shares(recipient_email);
  CREATE INDEX IF NOT EXISTS idx_recruiter_shares_expires ON recruiter_player_shares(expires_at);
  CREATE INDEX IF NOT EXISTS idx_recruiter_share_items_share ON recruiter_player_share_items(share_id);
  CREATE INDEX IF NOT EXISTS idx_recruiter_share_items_player ON recruiter_player_share_items(player_user_id);
`;

const DEFAULT_SCHOOL_RATING_CATEGORIES = [
  {
    categoryName: 'Academics',
    whatToRate: 'Major, academic support, graduation help',
    whyItMatters: 'Football ends, degree lasts',
    sortOrder: 1
  },
  {
    categoryName: 'Playing Time Opportunity',
    whatToRate: 'Path to the field, depth chart, role fit',
    whyItMatters: 'Athletes want to compete and develop',
    sortOrder: 2
  },
  {
    categoryName: 'Coaching Staff',
    whatToRate: 'Trust, communication, player development',
    whyItMatters: 'Coaches shape growth and future success',
    sortOrder: 3
  },
  {
    categoryName: 'Scheme Fit',
    whatToRate: "Offense/defense fit for the athlete's style",
    whyItMatters: 'Better fit usually means better performance',
    sortOrder: 4
  },
  {
    categoryName: 'Facilities',
    whatToRate: 'Weight room, training room, recovery, stadium',
    whyItMatters: 'Shows investment in players and development',
    sortOrder: 5
  },
  {
    categoryName: 'Program Success',
    whatToRate: 'Winning culture, exposure, conference level',
    whyItMatters: 'Strong programs can boost recruiting value',
    sortOrder: 6
  },
  {
    categoryName: 'Team Culture',
    whatToRate: 'Brotherhood, leadership, locker room vibe',
    whyItMatters: 'Good culture improves daily experience',
    sortOrder: 7
  },
  {
    categoryName: 'Location',
    whatToRate: 'Distance from home, city, environment',
    whyItMatters: 'Comfort and family access matter',
    sortOrder: 8
  },
  {
    categoryName: 'NIL / Financial Fit',
    whatToRate: 'NIL opportunity, scholarship, overall value',
    whyItMatters: 'Important for money, exposure, and stability',
    sortOrder: 9
  },
  {
    categoryName: 'Career Support',
    whatToRate: 'Networking, alumni, life-after-football support',
    whyItMatters: 'Helps after football and after college',
    sortOrder: 10
  }
];

function splitStatements(sql) {
  return sql
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function convertInsertOrIgnore(sql) {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+/i.test(sql)) {
    return sql;
  }

  return sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+/i, 'INSERT INTO ') + ' ON CONFLICT DO NOTHING';
}

function getInsertTableName(sql) {
  const match = sql.match(/^\s*INSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+([a-z_][a-z0-9_]*)/i);
  return match ? match[1].toLowerCase() : null;
}

function addReturningClause(sql) {
  if (!/^\s*INSERT/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
    return sql;
  }

  const tableName = getInsertTableName(sql);
  const primaryKey = insertPrimaryKeys[tableName];
  if (!primaryKey) {
    return sql;
  }

  return `${sql} RETURNING ${primaryKey} AS inserted_id`;
}

function normalizeSql(sql) {
  const trimmed = sql.trim().replace(/;+$/, '');
  const convertedInsert = convertInsertOrIgnore(trimmed);
  const convertedReturning = addReturningClause(convertedInsert);
  return convertPlaceholders(convertedReturning);
}

async function query(sql, params = []) {
  return pool.query(normalizeSql(sql), params);
}

async function exec(sql) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const statement of splitStatements(sql)) {
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Run a transaction on a single dedicated connection.
// Usage: const result = await db.withTransaction(async (tx) => {
//   await tx.prepare('INSERT ...').run(val1, val2);
//   return something;
// });
async function withTransaction(fn) {
  const client = await pool.connect();
  const tx = {
    query: (sql, params = []) => client.query(normalizeSql(sql), params),
    prepare: (sql) => ({
      async get(...params) {
        const result = await client.query(normalizeSql(sql), params);
        return result.rows[0];
      },
      async all(...params) {
        const result = await client.query(normalizeSql(sql), params);
        return result.rows;
      },
      async run(...params) {
        const result = await client.query(normalizeSql(sql), params);
        return {
          changes: result.rowCount,
          lastInsertRowid: result.rows[0]?.inserted_id
        };
      }
    })
  };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function initialize() {
  await exec(createTablesSQL);
  await exec(alterTablesSQL);
  await exec(createIndexesSQL);
  await backfillHeightInches();

  const existing = await prepare('SELECT COUNT(*)::int AS count FROM school_rating_categories').get();
  if ((existing?.count || 0) === 0) {
    for (const category of DEFAULT_SCHOOL_RATING_CATEGORIES) {
      await prepare(`
        INSERT INTO school_rating_categories (
          category_name,
          what_to_rate,
          why_it_matters,
          sort_order,
          is_active,
          updated_at
        )
        VALUES (?, ?, ?, ?, true, CURRENT_TIMESTAMP)
      `).run(
        category.categoryName,
        category.whatToRate,
        category.whyItMatters,
        category.sortOrder
      );
    }
  }
}

async function backfillHeightInches() {
  const rowsNeedingBackfill = await prepare(`
    SELECT user_id, height
    FROM player_profiles
    WHERE height_inches IS NULL
      AND height IS NOT NULL
      AND TRIM(height) <> ''
  `).all();

  if (!rowsNeedingBackfill.length) return;

  const updateHeightInches = prepare('UPDATE player_profiles SET height_inches = ? WHERE user_id = ?');
  for (const row of rowsNeedingBackfill) {
    const inches = parseHeightToInches(row.height);
    if (inches === null) continue;
    await updateHeightInches.run(inches, row.user_id);
  }
}

function prepare(sql) {
  return {
    async get(...params) {
      const result = await query(sql, params);
      return result.rows[0];
    },
    async all(...params) {
      const result = await query(sql, params);
      return result.rows;
    },
    async run(...params) {
      const result = await query(sql, params);
      return {
        changes: result.rowCount,
        lastInsertRowid: result.rows[0]?.inserted_id
      };
    }
  };
}

async function close() {
  await pool.end();
}

module.exports = {
  prepare,
  query,
  exec,
  withTransaction,
  initialize,
  close,
  pool
};
