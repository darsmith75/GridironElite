const db = require('./database');

async function fixDarren() {
  console.log('Creating profile for Darren Smith...');
  
  // Get Darren's user ID
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get('darrensmith75@gmail.com');
  
  if (!user) {
    console.log('User not found!');
    return;
  }
  
  // Check if profile already exists
  const existing = db.prepare('SELECT id FROM player_profiles WHERE user_id = ?').get(user.id);
  
  if (existing) {
    console.log('Profile already exists!');
    return;
  }
  
  // Create the profile
  db.prepare('INSERT INTO player_profiles (user_id, full_name) VALUES (?, ?)').run(user.id, 'Darren Smith');
  
  console.log('✓ Profile created successfully!');
  
  // Verify
  const profile = db.prepare('SELECT * FROM player_profiles WHERE user_id = ?').get(user.id);
  console.log('\nNew profile:', profile);
}

fixDarren().catch(console.error);
