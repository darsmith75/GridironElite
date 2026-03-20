const bcrypt = require('bcryptjs');
const db = require('./database');

async function insertAdminUser() {
  const email = process.env.ADMIN_EMAIL || 'admin@gridironelite.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123?';
  const fullName = process.env.ADMIN_FULL_NAME || 'Admin User';
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);

  if (existing) {
    await db.prepare(`
      UPDATE users
      SET password = ?, role = 'admin', full_name = ?
      WHERE id = ?
    `).run(passwordHash, fullName, existing.id);
    console.log(`Updated admin user: ${email}`);
  } else {
    await db.prepare(`
      INSERT INTO users (email, password, role, full_name)
      VALUES (?, ?, 'admin', ?)
    `).run(email, passwordHash, fullName);
    console.log(`Inserted admin user: ${email}`);
  }

  console.log(`Admin password: ${password}`);
}

insertAdminUser()
  .catch(error => {
    console.error('Failed to insert admin user:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });