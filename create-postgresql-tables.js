try { require('dotenv').config(); } catch (_) {}

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'GridironElite',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || ''
});

const createTablesSQL = `
  -- Users table
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

  -- Player profiles table
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
    gpa DECIMAL(3,2),
    profile_picture TEXT,
    card_photo TEXT,
    report_card_image TEXT,
    phone VARCHAR(20),
    bio TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Messages table
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

  -- Agent favorites table
  CREATE TABLE IF NOT EXISTS agent_favorites (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, user_id),
    FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Colleges table
  CREATE TABLE IF NOT EXISTS colleges (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    website_url TEXT,
    logo TEXT,
    conference VARCHAR(100),
    team VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Player videos table
  CREATE TABLE IF NOT EXISTS player_videos (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Player images table
  CREATE TABLE IF NOT EXISTS player_images (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Player contacts table
  CREATE TABLE IF NOT EXISTS player_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    role VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(20),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Player video links table
  CREATE TABLE IF NOT EXISTS player_video_links (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Player school interests table
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

  -- School notes table
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

  -- School contacts table
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
`;

async function createTables() {
  const client = await pool.connect();
  try {
    console.log('Connecting to PostgreSQL database...');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`User: ${process.env.DB_USER}`);

    // Create tables
    console.log('\nCreating tables...');
    const statements = createTablesSQL.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await client.query(statement);
      }
    }
    console.log('✓ Tables created successfully');

    // Create indexes
    console.log('\nCreating indexes...');
    const indexStatements = createIndexesSQL.split(';').filter(s => s.trim());
    for (const statement of indexStatements) {
      if (statement.trim()) {
        await client.query(statement);
      }
    }
    console.log('✓ Indexes created successfully');

    // List all tables
    console.log('\nVerifying tables...');
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('Tables in database:');
    result.rows.forEach(row => console.log('  -', row.table_name));

    console.log('\n✓ PostgreSQL schema created successfully!');
  } catch (error) {
    console.error('Error creating tables:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    await pool.end();
  }
}

createTables();
