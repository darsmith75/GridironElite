const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database('football_platform.db');

// Update Julian Edelman's profile with sample data
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

const result = updateJulian.run(
  "5'10\"",           // height
  198,                // weight
  4.52,               // 40-yard dash
  225,                // bench press
  405,                // squat
  34.5,               // vertical jump
  4.18,               // 5-10-5 shuttle
  6.95,               // L-drill
  120,                // broad jump
  275,                // power clean
  315,                // single leg squat
  3.2,                // GPA
  'https://www.hudl.com/profile/julian-edelman',  // hudl_link
  'julianedelman',    // hudl_username
  'https://www.instagram.com/edelman11',  // instagram_link
  '@edelman11',       // instagram_username
  'https://twitter.com/edelman11',  // twitter_link
  '@edelman11'        // twitter_username
);

console.log(`Updated Julian Edelman's profile: ${result.changes} row(s) changed`);

// Verify the update
const julian = db.prepare(`
  SELECT p.*, u.email 
  FROM player_profiles p 
  JOIN users u ON p.user_id = u.id 
  WHERE u.email = 'darrensmith75@gmail.com'
`).get();

console.log('\nJulian Edelman\'s updated data:');
console.log(`Height: ${julian.height}`);
console.log(`Weight: ${julian.weight} lbs`);
console.log(`40-Yard Dash: ${julian.forty_yard_dash}s`);
console.log(`Vertical Jump: ${julian.vertical_jump}"`);
console.log(`GPA: ${julian.gpa}`);
console.log(`Instagram: ${julian.instagram_username}`);
console.log(`Twitter: ${julian.twitter_username}`);

db.close();
