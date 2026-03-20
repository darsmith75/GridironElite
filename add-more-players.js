const bcrypt = require('bcryptjs');
const db = require('./database');

const newPlayers = [
  {
    email: 'caleb.thompson@email.com',
    password: 'player123',
    fullName: 'Caleb Thompson',
    highSchool: 'St. Augustine Prep',
    graduationYear: 2027,
    position: 'QB',
    height: '6\'2"',
    weight: 200,
    fortyYardDash: 4.62,
    benchPress: 215,
    squat: 365,
    verticalJump: 31.0,
    shuttle5105: 4.38,
    lDrill: 7.10,
    broadJump: 112,
    powerClean: 260,
    singleLegSquat: 175,
    gpa: 3.7,
    phone: '610-555-0142',
    bio: 'Dual-threat quarterback with a strong arm and quick feet. 5,200+ passing yards and 45 TDs through two varsity seasons. Also rushed for 800+ yards. Team captain and two-time all-conference selection. Poised in the pocket with excellent decision-making.'
  },
  {
    email: 'xavier.brooks@email.com',
    password: 'player123',
    fullName: 'Xavier Brooks',
    highSchool: 'Archbishop Wood',
    graduationYear: 2026,
    position: 'CB',
    height: '5\'11"',
    weight: 175,
    fortyYardDash: 4.38,
    benchPress: 175,
    squat: 305,
    verticalJump: 39.5,
    shuttle5105: 4.12,
    lDrill: 6.78,
    broadJump: 128,
    powerClean: 225,
    singleLegSquat: 155,
    gpa: 3.6,
    phone: '215-555-0287',
    bio: 'Lockdown cornerback with elite speed and ball skills. 14 interceptions over two seasons with 4 pick-sixes. Shutdown coverage corner who also excels as a punt returner. Track athlete running a 10.6 100m. All-state first team.'
  },
  {
    email: 'jaylen.carter@email.com',
    password: 'player123',
    fullName: 'Jaylen Carter',
    highSchool: 'DeMatha Catholic',
    graduationYear: 2027,
    position: 'S',
    height: '6\'1"',
    weight: 195,
    fortyYardDash: 4.52,
    benchPress: 235,
    squat: 375,
    verticalJump: 36.0,
    shuttle5105: 4.28,
    lDrill: 7.00,
    broadJump: 120,
    powerClean: 270,
    singleLegSquat: 190,
    gpa: 3.85,
    phone: '301-555-0193',
    bio: 'Hard-hitting safety with excellent range and football IQ. 95+ tackles and 8 interceptions as a junior. Versatile defender comfortable in single-high or box safety roles. National Honor Society member and team leader. Excellent communicator on the back end.'
  },
  {
    email: 'malik.davis@email.com',
    password: 'player123',
    fullName: 'Malik Davis',
    highSchool: 'IMG Academy',
    graduationYear: 2026,
    position: 'WR',
    height: '6\'3"',
    weight: 200,
    fortyYardDash: 4.45,
    benchPress: 205,
    squat: 340,
    verticalJump: 37.5,
    shuttle5105: 4.22,
    lDrill: 6.90,
    broadJump: 124,
    powerClean: 250,
    singleLegSquat: 170,
    gpa: 3.4,
    phone: '941-555-0331',
    bio: 'Big-bodied receiver with exceptional catch radius and red zone presence. 1,800+ receiving yards and 22 TDs as a junior. Elite body control and contested catch ability. Runs crisp routes despite his size. Two-sport athlete also lettering in basketball.'
  },
  {
    email: 'aiden.williams@email.com',
    password: 'player123',
    fullName: 'Aiden Williams',
    highSchool: 'Bergen Catholic',
    graduationYear: 2027,
    position: 'TE',
    height: '6\'5"',
    weight: 235,
    fortyYardDash: 4.72,
    benchPress: 265,
    squat: 415,
    verticalJump: 33.0,
    shuttle5105: 4.45,
    lDrill: 7.20,
    broadJump: 110,
    powerClean: 285,
    singleLegSquat: 205,
    gpa: 3.9,
    phone: '201-555-0476',
    bio: 'Dynamic tight end combining size, athleticism, and blocking ability. 950+ receiving yards and 12 TDs while also grading out as an elite blocker. Matchup nightmare who can line up inline, in the slot, or split out wide. 4.0 GPA and National Merit Scholar semifinalist.'
  },
  {
    email: 'trevon.jackson@email.com',
    password: 'player123',
    fullName: 'Trevon Jackson',
    highSchool: 'Gonzaga College High',
    graduationYear: 2026,
    position: 'RB',
    height: '5\'10"',
    weight: 190,
    fortyYardDash: 4.42,
    benchPress: 255,
    squat: 420,
    verticalJump: 37.0,
    shuttle5105: 4.18,
    lDrill: 6.82,
    broadJump: 126,
    powerClean: 275,
    singleLegSquat: 200,
    gpa: 3.3,
    phone: '202-555-0518',
    bio: 'Explosive and elusive running back with outstanding contact balance. 2,800+ rushing yards and 32 TDs in junior season. Dangerous receiver out of the backfield with 40+ catches. Electric in the open field with 4.4 speed. Two-time conference offensive player of the year.'
  },
  {
    email: 'noah.martinez@email.com',
    password: 'player123',
    fullName: 'Noah Martinez',
    highSchool: 'La Salle College High School',
    graduationYear: 2027,
    position: 'OL',
    height: '6\'5"',
    weight: 290,
    fortyYardDash: 5.15,
    benchPress: 340,
    squat: 505,
    verticalJump: 27.0,
    shuttle5105: 4.85,
    lDrill: 7.65,
    broadJump: 96,
    powerClean: 305,
    singleLegSquat: 260,
    gpa: 3.75,
    phone: '215-555-0624',
    bio: 'Dominant offensive tackle with elite size and technique. Allowed zero sacks in 12 games last season. Excellent footwork and hand placement. Pancake machine in the run game. Team captain and honor roll student. Projects as a left tackle at the next level.'
  },
  {
    email: 'deshawn.lewis@email.com',
    password: 'player123',
    fullName: 'DeShawn Lewis',
    highSchool: 'Imhotep Institute',
    graduationYear: 2026,
    position: 'LB',
    height: '6\'2"',
    weight: 225,
    fortyYardDash: 4.58,
    benchPress: 295,
    squat: 445,
    verticalJump: 35.5,
    shuttle5105: 4.32,
    lDrill: 7.08,
    broadJump: 119,
    powerClean: 300,
    singleLegSquat: 220,
    gpa: 3.5,
    phone: '215-555-0739',
    bio: 'Sideline-to-sideline linebacker with a nose for the football. 165+ tackles, 12 sacks, and 5 forced fumbles as a junior. Physical downhill player who also excels in coverage. Two-time all-city selection and defensive MVP. Vocal leader of the defense.'
  },
  {
    email: 'jordan.patel@email.com',
    password: 'player123',
    fullName: 'Jordan Patel',
    highSchool: 'Haverford School',
    graduationYear: 2027,
    position: 'K',
    height: '5\'11"',
    weight: 175,
    fortyYardDash: 4.85,
    benchPress: 185,
    squat: 315,
    verticalJump: 30.0,
    shuttle5105: 4.55,
    lDrill: 7.35,
    broadJump: 105,
    powerClean: 215,
    singleLegSquat: 165,
    gpa: 4.0,
    phone: '610-555-0842',
    bio: 'Elite kicker with a powerful and accurate leg. 92% on field goals with a long of 52 yards. Perfect on PATs last season (78/78). Also handles kickoffs with 85% touchback rate. Dedicated student with a 4.0 GPA. Recruited by multiple D1 programs as a specialist.'
  },
  {
    email: 'isaiah.green@email.com',
    password: 'player123',
    fullName: 'Isaiah Green',
    highSchool: 'Roman Catholic',
    graduationYear: 2026,
    position: 'DL',
    height: '6\'3"',
    weight: 255,
    fortyYardDash: 4.78,
    benchPress: 335,
    squat: 475,
    verticalJump: 32.0,
    shuttle5105: 4.52,
    lDrill: 7.30,
    broadJump: 112,
    powerClean: 320,
    singleLegSquat: 240,
    gpa: 3.2,
    phone: '267-555-0957',
    bio: 'Powerful interior defensive lineman with a devastating bull rush. 18 sacks and 65+ tackles as a junior playing defensive tackle. Disruptive force against the run and pass. Excellent first step and hand usage. All-league first team and invited to national combine showcase.'
  }
];

async function addPlayers() {
  console.log('Adding 10 new player profiles...\n');
  const hashedPassword = await bcrypt.hash('player123', 10);

  for (const player of newPlayers) {
    // Check if user already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(player.email);
    if (existing) {
      console.log(`⚠ ${player.fullName} (${player.email}) already exists, skipping`);
      continue;
    }

    // Create user
    const userResult = db.prepare(
      'INSERT INTO users (email, password, role, full_name) VALUES (?, ?, ?, ?)'
    ).run(player.email, hashedPassword, 'player', player.fullName);
    const userId = userResult.lastInsertRowid;

    // Create player profile
    db.prepare(`INSERT INTO player_profiles (
      user_id, full_name, high_school, graduation_year, position,
      height, weight, forty_yard_dash, bench_press, squat,
      vertical_jump, shuttle_5_10_5, l_drill, broad_jump,
      power_clean, single_leg_squat, gpa, bio, phone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId,
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
      player.shuttle5105,
      player.lDrill,
      player.broadJump,
      player.powerClean,
      player.singleLegSquat,
      player.gpa,
      player.bio,
      player.phone
    );

    console.log(`✓ Added ${player.fullName} - ${player.position} - ${player.highSchool} (${player.email})`);
  }

  console.log('\nDone! All new players can login with password: player123');
}

addPlayers().catch(console.error);
