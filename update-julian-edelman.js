const db = require('./database');

// Update Julian Edelman's profile with sample data
async function main() {
  const updateJulian = db.prepare(`
    UPDATE player_profiles
    SET
      height = ?,
      weight = ?,
      forty_yard_dash = ?,
      bench_press = ?,
      squat = ?,
      vertical_jump = ?,
      shuttle_5_10_5 = ?,
      l_drill = ?,
      broad_jump = ?,
      power_clean = ?,
      single_leg_squat = ?,
      gpa = ?,
      hudl_link = ?,
      hudl_username = ?,
      instagram_link = ?,
      instagram_username = ?,
      twitter_link = ?,
      twitter_username = ?
    WHERE user_id = (SELECT id FROM users WHERE email = 'darrensmith75@gmail.com')
  `);

  const result = await updateJulian.run(
    "5'10\"",
    198,
    4.52,
    225,
    405,
    34.5,
    4.18,
    6.95,
    120,
    275,
    315,
    3.2,
    'https://www.hudl.com/profile/julian-edelman',
    'julianedelman',
    'https://www.instagram.com/edelman11',
    '@edelman11',
    'https://twitter.com/edelman11',
    '@edelman11'
  );

  console.log(`Updated Julian Edelman's profile: ${result.changes} row(s) changed`);

  const julian = await db.prepare(`
    SELECT p.*, u.email
    FROM player_profiles p
    JOIN users u ON p.user_id = u.id
    WHERE u.email = 'darrensmith75@gmail.com'
  `).get();

  if (!julian) {
    console.log('Player not found for email darrensmith75@gmail.com');
    return;
  }

  console.log("\nJulian Edelman's updated data:");
  console.log(`Height: ${julian.height}`);
  console.log(`Weight: ${julian.weight} lbs`);
  console.log(`40-Yard Dash: ${julian.forty_yard_dash}s`);
  console.log(`Vertical Jump: ${julian.vertical_jump}"`);
  console.log(`GPA: ${julian.gpa}`);
  console.log(`Instagram: ${julian.instagram_username}`);
  console.log(`Twitter: ${julian.twitter_username}`);
}

main()
  .catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
