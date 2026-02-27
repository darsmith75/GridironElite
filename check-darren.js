const db = require('./database');

async function checkDarren() {
  console.log('\n=== Checking Darren Smith ===');
  
  // Find user
  const user = db.prepare('SELECT * FROM users WHERE email LIKE ?').get('%darren%');
  console.log('User:', user);
  
  if (user) {
    // Find profile
    const profile = db.prepare('SELECT * FROM player_profiles WHERE user_id = ?').get(user.id);
    console.log('\nProfile:', profile);
  }
}

checkDarren().catch(console.error);
