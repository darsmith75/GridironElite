const bcrypt = require('bcryptjs');
const db = require('./database');

const defaultUsers = [
  {
    email: 'admin@example.com',
    password: 'admin123',
    role: 'admin',
    fullName: 'Admin User'
  },
  {
    email: 'agent@example.com',
    password: 'agent123',
    role: 'agent',
    fullName: 'Default Agent'
  }
];

async function ensureUser(user) {
  const existing = await db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(user.email);
  if (existing) {
    return { created: false, user: existing };
  }

  const hashedPassword = await bcrypt.hash(user.password, 10);
  const result = await db.prepare(
    'INSERT INTO users (email, password, role, full_name) VALUES (?, ?, ?, ?)'
  ).run(user.email, hashedPassword, user.role, user.fullName);

  return {
    created: true,
    user: {
      id: result.lastInsertRowid,
      email: user.email,
      role: user.role
    }
  };
}

async function main() {
  try {
    await db.initialize();

    for (const user of defaultUsers) {
      const result = await ensureUser(user);
      const status = result.created ? 'Created' : 'Already exists';
      console.log(`${status}: ${user.role} ${user.email}`);
      console.log(`  Password: ${user.password}`);
    }
  } catch (error) {
    console.error('Failed to create default PostgreSQL users:', error);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main();