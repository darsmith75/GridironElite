try { require('dotenv').config(); } catch (_) {}

const { Pool } = require('pg');

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
  password: process.env.DB_PASS || ''
};

if (shouldUseSsl) {
  poolConfig.ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
  };
}

const pool = new Pool(poolConfig);

const insertPrimaryKeys = {
  users: 'id',
  player_profiles: 'user_id',
  messages: 'id',
  agent_favorites: 'id',
  colleges: 'id',
  player_videos: 'id',
  player_images: 'id',
  player_contacts: 'id',
  player_video_links: 'id',
  player_metric_videos: 'id',
  metric_pro_tips: 'id',
  player_school_interests: 'id',
  school_notes: 'id',
  school_contacts: 'id'
};

const createTablesSQL = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role VARCHAR(50) NOT NULL CHECK(role IN ('player', 'agent', 'admin')),
    full_name VARCHAR(255),
    phone VARCHAR(20),
    organization VARCHAR(255),
    title VARCHAR(255),
    experience INTEGER,
    bio TEXT,
    profile_picture TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS player_profiles (
    user_id INTEGER PRIMARY KEY NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    high_school VARCHAR(255),
    graduation_year INTEGER,
    position VARCHAR(50),
    height VARCHAR(10),
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE
  );
`;

const alterTablesSQL = `
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS hudl_link TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS instagram_link TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS twitter_link TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS hudl_username TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS instagram_username TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS twitter_username TEXT;
  ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS achievement TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;
`;

const createIndexesSQL = `
  CREATE INDEX IF NOT EXISTS idx_school_interests_user ON player_school_interests(user_id);
  CREATE INDEX IF NOT EXISTS idx_school_interests_college ON player_school_interests(college_id);
  CREATE INDEX IF NOT EXISTS idx_school_notes_user ON school_notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_school_notes_college ON school_notes(college_id);
  CREATE INDEX IF NOT EXISTS idx_school_contacts_user ON school_contacts(user_id);
  CREATE INDEX IF NOT EXISTS idx_school_contacts_college ON school_contacts(college_id);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_favorites_agent ON agent_favorites(agent_id);
  CREATE INDEX IF NOT EXISTS idx_profiles_user ON player_profiles(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_player_videos_user ON player_videos(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_images_user ON player_images(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_contacts_user ON player_contacts(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_video_links_user ON player_video_links(user_id);
  CREATE INDEX IF NOT EXISTS idx_player_metric_videos_user ON player_metric_videos(user_id);
  CREATE INDEX IF NOT EXISTS idx_metric_pro_tips_key ON metric_pro_tips(metric_key);
`;

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

async function initialize() {
  await exec(createTablesSQL);
  await exec(alterTablesSQL);
  await exec(createIndexesSQL);
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
  initialize,
  close,
  pool
};
