const db = require('./database');

async function main() {
  const players = await db.prepare(`
    SELECT u.email, p.full_name
    FROM users u
    JOIN player_profiles p ON u.id = p.user_id
    WHERE u.role = 'player'
  `).all();

  console.log('Players in database:');
  players.forEach(p => console.log(`- ${p.full_name} (${p.email})`));
}

main()
  .catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
