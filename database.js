const Database = require('better-sqlite3-multiple-ciphers');
const bcrypt = require('bcrypt');

const db = new Database('football_platform.db');

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('player', 'agent')),
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
`);

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

// Create default agent account if none exists
const agentExists = db.prepare('SELECT id FROM users WHERE role = ?').get('agent');
if (!agentExists) {
  const hashedPassword = bcrypt.hashSync('agent123', 10);
  db.prepare('INSERT INTO users (email, password, role) VALUES (?, ?, ?)').run('agent@example.com', hashedPassword, 'agent');
  console.log('Default agent account created: agent@example.com / agent123');
}

module.exports = db;
