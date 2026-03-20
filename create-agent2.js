const bcrypt = require('bcryptjs');
const db = require('./database');

async function createAgent2() {
  const email = 'agent2@example.com';
  const password = 'password123';
  const fullName = 'Sarah Mitchell';
  
  // Check if agent already exists
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    console.log('Agent2 already exists!');
    console.log(`Email: ${email}`);
    console.log(`Password: password123`);
  } else {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const insertUser = db.prepare(`
      INSERT INTO users (email, password, role, full_name) 
      VALUES (?, ?, 'agent', ?)
    `);

    const result = await insertUser.run(email, hashedPassword, fullName);
    const userId = result.lastInsertRowid;
    
    console.log(`Created agent user with ID: ${userId}`);
    console.log('\n=== Agent Profile ===');
    console.log(`Name: ${fullName}`);
    console.log(`Email: ${email}`);
    console.log(`Role: Agent`);
    console.log('\nLogin credentials:');
    console.log(`Email: ${email}`);
    console.log(`Password: password123`);
  }
}

createAgent2()
  .then(() => {
    console.log('\nDone!');
  })
  .catch(err => {
    console.error('Error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
