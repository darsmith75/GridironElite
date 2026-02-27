const bcrypt = require('bcrypt');
const db = require('./database');

const samplePlayers = [
  {
    email: 'marcus.johnson@email.com',
    password: 'player123',
    fullName: 'Marcus Johnson',
    highSchool: 'Lincoln High School',
    graduationYear: 2025,
    position: 'QB',
    height: '6\'3"',
    weight: 205,
    fortyYardDash: 4.58,
    benchPress: 225,
    squat: 385,
    verticalJump: 32.5,
    gpa: 3.8,
    bio: 'Three-year varsity starter with 8,500+ passing yards and 72 touchdowns. Team captain and honor roll student. Led team to state semifinals junior year. Strong arm with excellent field vision and leadership skills.'
  },
  {
    email: 'tyrell.washington@email.com',
    password: 'player123',
    fullName: 'Tyrell Washington',
    highSchool: 'Central Valley High',
    graduationYear: 2025,
    position: 'WR',
    height: '6\'1"',
    weight: 185,
    fortyYardDash: 4.42,
    benchPress: 185,
    squat: 315,
    verticalJump: 38.0,
    gpa: 3.5,
    bio: 'Elite speed receiver with 2,400+ receiving yards and 28 TDs over two seasons. Track and field state champion in 100m and 200m. Excellent route runner with reliable hands. All-conference selection two years running.'
  },
  {
    email: 'james.rodriguez@email.com',
    password: 'player123',
    fullName: 'James Rodriguez',
    highSchool: 'Westside Prep',
    graduationYear: 2026,
    position: 'LB',
    height: '6\'2"',
    weight: 220,
    fortyYardDash: 4.65,
    benchPress: 285,
    squat: 425,
    verticalJump: 34.0,
    gpa: 3.9,
    bio: 'Dominant linebacker with 180+ tackles and 15 sacks in junior season. Defensive MVP and team captain. 4.0 GPA student with National Honor Society membership. Excellent instincts and tackling technique.'
  },
  {
    email: 'devon.harris@email.com',
    password: 'player123',
    fullName: 'Devon Harris',
    highSchool: 'Eastwood Academy',
    graduationYear: 2025,
    position: 'RB',
    height: '5\'11"',
    weight: 195,
    fortyYardDash: 4.48,
    benchPress: 245,
    squat: 405,
    verticalJump: 36.5,
    gpa: 3.4,
    bio: 'Explosive running back with 3,200+ rushing yards and 38 touchdowns in two varsity seasons. Excellent vision and breakaway speed. Also contributes on special teams as kick returner. All-state honorable mention.'
  },
  {
    email: 'brandon.mitchell@email.com',
    password: 'player123',
    fullName: 'Brandon Mitchell',
    highSchool: 'Riverside High School',
    graduationYear: 2026,
    position: 'DL',
    height: '6\'4"',
    weight: 265,
    fortyYardDash: 4.95,
    benchPress: 325,
    squat: 485,
    verticalJump: 28.0,
    gpa: 3.6,
    bio: 'Powerful defensive lineman with 12 sacks and 22 tackles for loss as a junior. Excellent pass rush moves and run-stopping ability. Wrestling state qualifier. Strong work ethic and coachable attitude.'
  }
];

async function seedDatabase() {
  console.log('Adding sample players...');
  
  for (const player of samplePlayers) {
    try {
      // Create user account
      const hashedPassword = await bcrypt.hash(player.password, 10);
      const result = db.prepare('INSERT INTO users (email, password, role) VALUES (?, ?, ?)').run(
        player.email,
        hashedPassword,
        'player'
      );

      // Create player profile
      db.prepare(`
        INSERT INTO player_profiles (
          user_id, full_name, high_school, graduation_year, position,
          height, weight, forty_yard_dash, bench_press, squat,
          vertical_jump, gpa, bio
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.lastInsertRowid,
        player.fullName,
        player.highSchool,
        player.graduationYear,
        player.position,
        player.height,
        player.weight,
        player.fortyYardDash,
        player.benchPress,
        player.squat,
        player.verticalJump,
        player.gpa,
        player.bio
      );

      console.log(`✓ Added ${player.fullName} (${player.email})`);
    } catch (error) {
      console.log(`✗ Skipped ${player.fullName} - ${error.message}`);
    }
  }

  console.log('\nSample data seeding complete!');
  console.log('\nYou can login with any of these accounts:');
  samplePlayers.forEach(p => {
    console.log(`  ${p.email} / player123`);
  });
  console.log('\nOr login as agent: agent@example.com / agent123');
}

seedDatabase().catch(console.error);
