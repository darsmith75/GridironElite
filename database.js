const Database = require('better-sqlite3-multiple-ciphers');
const bcrypt = require('bcrypt');

const db = new Database('football_platform.db');

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('player', 'agent', 'admin')),
    full_name TEXT,
    phone TEXT,
    organization TEXT,
    title TEXT,
    experience INTEGER,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS player_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    high_school TEXT,
    graduation_year INTEGER,
    position TEXT,
    height TEXT,
    weight INTEGER,
    forty_yard_dash REAL,
    bench_press INTEGER,
    squat INTEGER,
    vertical_jump REAL,
    shuttle_5_10_5 REAL,
    l_drill REAL,
    broad_jump REAL,
    power_clean INTEGER,
    single_leg_squat INTEGER,
    gpa REAL,
    profile_picture TEXT,
    card_photo TEXT,
    report_card_image TEXT,
    phone TEXT,
    highlight_videos TEXT,
    additional_images TEXT,
    college_offers TEXT,
    bio TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (recipient_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS agent_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_id, player_id),
    FOREIGN KEY (agent_id) REFERENCES users(id),
    FOREIGN KEY (player_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS colleges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    website_url TEXT,
    logo TEXT,
    conference TEXT,
    team TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add report card image column to player_profiles if it doesn't exist
try {
  const playerProfileColumns = db.prepare("PRAGMA table_info(player_profiles)").all();
  const playerProfileColumnNames = playerProfileColumns.map(col => col.name);

  if (!playerProfileColumnNames.includes('report_card_image')) {
    db.exec('ALTER TABLE player_profiles ADD COLUMN report_card_image TEXT');
    console.log('Added report_card_image column to player_profiles table');
  }
} catch (error) {
  console.error('Error adding report_card_image column:', error);
}

// Add new columns to users table if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const columnNames = columns.map(col => col.name);
  
  if (!columnNames.includes('full_name')) {
    db.exec('ALTER TABLE users ADD COLUMN full_name TEXT');
    console.log('Added full_name column to users table');
  }
  if (!columnNames.includes('phone')) {
    db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    console.log('Added phone column to users table');
  }
  if (!columnNames.includes('organization')) {
    db.exec('ALTER TABLE users ADD COLUMN organization TEXT');
    console.log('Added organization column to users table');
  }
  if (!columnNames.includes('title')) {
    db.exec('ALTER TABLE users ADD COLUMN title TEXT');
    console.log('Added title column to users table');
  }
  if (!columnNames.includes('experience')) {
    db.exec('ALTER TABLE users ADD COLUMN experience INTEGER');
    console.log('Added experience column to users table');
  }
  if (!columnNames.includes('bio')) {
    db.exec('ALTER TABLE users ADD COLUMN bio TEXT');
    console.log('Added bio column to users table');
  }
  if (!columnNames.includes('profile_picture')) {
    db.exec('ALTER TABLE users ADD COLUMN profile_picture TEXT');
    console.log('Added profile_picture column to users table');
  }
} catch (error) {
  console.error('Error adding columns to users table:', error);
}

// Migrate old highlight_video column to highlight_videos if needed
try {
  const columns = db.prepare("PRAGMA table_info(player_profiles)").all();
  const hasOldColumn = columns.some(col => col.name === 'highlight_video');
  
  if (hasOldColumn) {
    console.log('Migrating highlight_video to highlight_videos...');
    // Get all profiles with old video
    const profiles = db.prepare('SELECT id, highlight_video FROM player_profiles WHERE highlight_video IS NOT NULL').all();
    
    // Add new column if it doesn't exist
    const hasNewColumn = columns.some(col => col.name === 'highlight_videos');
    if (!hasNewColumn) {
      db.exec('ALTER TABLE player_profiles ADD COLUMN highlight_videos TEXT');
    }
    
    // Migrate data
    profiles.forEach(profile => {
      const videos = JSON.stringify([profile.highlight_video]);
      db.prepare('UPDATE player_profiles SET highlight_videos = ? WHERE id = ?').run(videos, profile.id);
    });
    
    console.log('Migration complete');
  }
} catch (error) {
  console.log('Migration check:', error.message);
}

// Add college_offers column if it doesn't exist
try {
  const columns = db.prepare("PRAGMA table_info(player_profiles)").all();
  const hasOffersColumn = columns.some(col => col.name === 'college_offers');
  
  if (!hasOffersColumn) {
    console.log('Adding college_offers column...');
    db.exec('ALTER TABLE player_profiles ADD COLUMN college_offers TEXT');
    console.log('College offers column added');
  }
} catch (error) {
  console.log('College offers column check:', error.message);
}

// Add contact information columns if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(player_profiles)").all();
  const columnNames = columns.map(col => col.name);
  
  const contactColumns = [
    'father_name', 'father_email', 'father_phone',
    'mother_name', 'mother_email', 'mother_phone',
    'coach_name', 'coach_email', 'coach_phone'
  ];
  
  contactColumns.forEach(colName => {
    if (!columnNames.includes(colName)) {
      db.exec(`ALTER TABLE player_profiles ADD COLUMN ${colName} TEXT`);
      console.log(`Added ${colName} column to player_profiles table`);
    }
  });
} catch (error) {
  console.error('Error adding contact columns:', error);
}

// Add new physical metrics columns if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(player_profiles)").all();
  
  const newColumns = [
    { name: 'shuttle_5_10_5', type: 'REAL' },
    { name: 'l_drill', type: 'REAL' },
    { name: 'broad_jump', type: 'REAL' },
    { name: 'power_clean', type: 'INTEGER' },
    { name: 'single_leg_squat', type: 'INTEGER' }
  ];
  
  newColumns.forEach(col => {
    const hasColumn = columns.some(c => c.name === col.name);
    if (!hasColumn) {
      console.log(`Adding ${col.name} column...`);
      db.exec(`ALTER TABLE player_profiles ADD COLUMN ${col.name} ${col.type}`);
      console.log(`${col.name} column added`);
    }
  });
} catch (error) {
  console.log('Column migration check:', error.message);
}

// Add team column to colleges table if missing
try {
  const collegeCols = db.prepare("PRAGMA table_info(colleges)").all();
  const collegeColNames = collegeCols.map(col => col.name);
  if (!collegeColNames.includes('team')) {
    db.exec('ALTER TABLE colleges ADD COLUMN team TEXT');
    console.log('Added team column to colleges table');
  }
} catch (error) {
  console.log('Colleges migration check:', error.message);
}

// Create normalized tables for media and contacts
db.exec(`
  CREATE TABLE IF NOT EXISTS player_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS player_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS player_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    name TEXT,
    email TEXT,
    phone TEXT,
    FOREIGN KEY (player_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS player_video_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES users(id)
  );
`);

// Add indexes for performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_favorites_agent ON agent_favorites(agent_id);
  CREATE INDEX IF NOT EXISTS idx_profiles_user ON player_profiles(user_id);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_player_videos_player ON player_videos(player_id);
  CREATE INDEX IF NOT EXISTS idx_player_images_player ON player_images(player_id);
  CREATE INDEX IF NOT EXISTS idx_player_contacts_player ON player_contacts(player_id);
  CREATE INDEX IF NOT EXISTS idx_player_video_links_player ON player_video_links(player_id);
`);

// Create player_school_interests table for tracking favorites and offers
db.exec(`
  CREATE TABLE IF NOT EXISTS player_school_interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    is_favorite INTEGER DEFAULT 0,
    has_offer INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(player_id, college_id),
    FOREIGN KEY (player_id) REFERENCES users(id),
    FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_school_interests_player ON player_school_interests(player_id);
  CREATE INDEX IF NOT EXISTS idx_school_interests_college ON player_school_interests(college_id);
`);

// Create school notes and contacts tables
db.exec(`
  CREATE TABLE IF NOT EXISTS school_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    visit_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES users(id),
    FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_school_notes_player ON school_notes(player_id);
  CREATE INDEX IF NOT EXISTS idx_school_notes_college ON school_notes(college_id);

  CREATE TABLE IF NOT EXISTS school_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    college_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    title TEXT,
    email TEXT,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES users(id),
    FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_school_contacts_player ON school_contacts(player_id);
  CREATE INDEX IF NOT EXISTS idx_school_contacts_college ON school_contacts(college_id);
`);

// Add title column to school_contacts if it doesn't exist
try {
  const scCols = db.prepare("PRAGMA table_info(school_contacts)").all();
  if (!scCols.some(c => c.name === 'title')) {
    db.exec('ALTER TABLE school_contacts ADD COLUMN title TEXT');
    console.log('Added title column to school_contacts table');
  }
} catch (error) {
  console.log('school_contacts title migration:', error.message);
}

// Migrate JSON columns to normalized tables
try {
  const videoCount = db.prepare('SELECT COUNT(*) as count FROM player_videos').get().count;
  if (videoCount === 0) {
    const profiles = db.prepare('SELECT user_id, highlight_videos, additional_images FROM player_profiles').all();

    const insertVideo = db.prepare('INSERT INTO player_videos (player_id, filename) VALUES (?, ?)');
    const insertImage = db.prepare('INSERT INTO player_images (player_id, filename) VALUES (?, ?)');

    const migrateMedia = db.transaction(() => {
      for (const profile of profiles) {
        if (profile.highlight_videos) {
          try {
            const videos = JSON.parse(profile.highlight_videos);
            videos.forEach(v => insertVideo.run(profile.user_id, v));
          } catch (e) { /* skip invalid JSON */ }
        }
        if (profile.additional_images) {
          try {
            const images = JSON.parse(profile.additional_images);
            images.forEach(i => insertImage.run(profile.user_id, i));
          } catch (e) { /* skip invalid JSON */ }
        }
      }
    });
    migrateMedia();
    console.log('Migrated media data to normalized tables');
  }
} catch (error) {
  console.error('Media migration error:', error.message);
}

// Migrate contact columns to player_contacts table
try {
  const contactCount = db.prepare('SELECT COUNT(*) as count FROM player_contacts').get().count;
  if (contactCount === 0) {
    const profiles = db.prepare(`SELECT user_id,
      father_name, father_email, father_phone,
      mother_name, mother_email, mother_phone,
      coach_name, coach_email, coach_phone
      FROM player_profiles`).all();

    const insertContact = db.prepare('INSERT INTO player_contacts (player_id, role, name, email, phone) VALUES (?, ?, ?, ?, ?)');

    const migrateContacts = db.transaction(() => {
      for (const p of profiles) {
        if (p.father_name || p.father_email || p.father_phone) {
          insertContact.run(p.user_id, 'father', p.father_name, p.father_email, p.father_phone);
        }
        if (p.mother_name || p.mother_email || p.mother_phone) {
          insertContact.run(p.user_id, 'mother', p.mother_name, p.mother_email, p.mother_phone);
        }
        if (p.coach_name || p.coach_email || p.coach_phone) {
          insertContact.run(p.user_id, 'coach', p.coach_name, p.coach_email, p.coach_phone);
        }
      }
    });
    migrateContacts();
    console.log('Migrated contact data to player_contacts table');
  }
} catch (error) {
  console.error('Contact migration error:', error.message);
}

// Create default agent account if none exists
const agentExists = db.prepare('SELECT id FROM users WHERE role = ?').get('agent');
if (!agentExists) {
  const hashedPassword = bcrypt.hashSync('agent123', 10);
  db.prepare('INSERT INTO users (email, password, role) VALUES (?, ?, ?)').run('agent@example.com', hashedPassword, 'agent');
  console.log('Default agent account created: agent@example.com / agent123');
}

// Migrate users table to support 'admin' role
try {
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'admin'")) {
    console.log('Migrating users table to support admin role...');
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TABLE IF EXISTS users_new');
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('player', 'agent', 'admin')),
        full_name TEXT,
        phone TEXT,
        organization TEXT,
        title TEXT,
        experience INTEGER,
        bio TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users_new SELECT id, email, password, role, full_name, phone, organization, title, experience, bio, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.pragma('foreign_keys = ON');
    console.log('Users table migrated to support admin role');
  }
} catch (error) {
  console.error('Admin role migration error:', error.message);
}

// Create default admin account if none exists
const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (email, password, role, full_name) VALUES (?, ?, ?, ?)').run('admin@gridironelite.com', hashedPassword, 'admin', 'Site Administrator');
  console.log('Default admin account created: admin@gridironelite.com / admin123');
}

module.exports = db;
