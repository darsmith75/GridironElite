const db = require('./database');

const updateData = {
  phone: '(555) 234-5678',
  organization: 'Elite Sports Management',
  title: 'Senior Recruiting Agent',
  experience: 8,
  bio: 'Experienced recruiting agent specializing in high school football talent. Former college athlete with a passion for helping young players achieve their dreams. Extensive network of college coaches and proven track record of successful placements.'
};

async function main() {
  const stmt = db.prepare(`
    UPDATE users
    SET phone = ?, organization = ?, title = ?, experience = ?, bio = ?
    WHERE email = ?
  `);

  await stmt.run(
    updateData.phone,
    updateData.organization,
    updateData.title,
    updateData.experience,
    updateData.bio,
    'agent2@example.com'
  );

  const agent = await db.prepare('SELECT * FROM users WHERE email = ?').get('agent2@example.com');
  if (!agent) {
    console.log('agent2@example.com not found');
    return;
  }

  console.log('Updated agent2 profile:');
  console.log('======================');
  console.log(`Name: ${agent.full_name}`);
  console.log(`Email: ${agent.email}`);
  console.log(`Phone: ${agent.phone}`);
  console.log(`Organization: ${agent.organization}`);
  console.log(`Title: ${agent.title}`);
  console.log(`Experience: ${agent.experience} years`);
  console.log(`Bio: ${agent.bio}`);
  console.log('\nLogin credentials:');
  console.log(`Email: ${agent.email}`);
  console.log('Password: password123');

  console.log('\nAgent profile successfully updated!');
}

main()
  .catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
