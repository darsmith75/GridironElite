/**
 * seed-players.js
 * Inserts 10 realistic test players into the local GridironAthletes database.
 * Run with:
 *   $env:DB_HOST='localhost'; $env:DB_PORT='5432'; $env:DB_NAME='GridironAthletes';
 *   $env:DB_USER='postgres'; $env:DB_PASS='Sctcorp98!'; node seed-players.js
 */

try { require('dotenv').config(); } catch (_) {}

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'GridironAthletes',
  user:     process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
  ssl:      false,
});

const DEFAULT_PASSWORD = 'TestPlayer1!';

const PLAYERS = [
  {
    email:    'marcus.thompson@gridirontest.com',
    fullName: 'Marcus Thompson',
    phone:    '(215) 555-0101',
    school:   'Bishop McDevitt High School',
    city:     'Harrisburg, PA',
    gradYear: 2026,
    pos:      'QB',
    height:   '6\'3"',
    weight:   205,
    gpa:      3.85,
    forty:    4.72,
    bench:    235,
    squat:    365,
    vert:     32.5,
    shuttle:  4.31,
    ldrill:   7.02,
    broad:    112,
    powerClean: 225,
    singleLeg:  22,
    hudlUser: 'mthompson_qb',
    igUser:   'marcust_qb',
    twitterU: 'MarcusThompsonQB',
    achievement: '3-year starter; 2025 District 3 Player of the Year; 3,412 passing yards and 34 TDs senior season; 4× Academic All-State',
    bio: 'Marcus is a dual-threat quarterback with elite arm talent and football IQ. He has drawn interest from multiple Power Four programs. Off the field, he maintains a 3.85 GPA and plans to study Business Administration. Known for his leadership in the huddle and community volunteer work.',
    contacts: [
      { role: 'parent', name: 'Robert Thompson', email: 'robert.thompson@email.com', phone: '(215) 555-0102' },
      { role: 'parent', name: 'Linda Thompson',  email: 'linda.thompson@email.com',  phone: '(215) 555-0103' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-marcus-hl-2025', title: '2025 Junior Highlight Film' },
      { url: 'https://www.youtube.com/watch?v=fake-marcus-games', title: 'Senior Season Top Throws' },
    ],
  },
  {
    email:    'jordan.williams@gridirontest.com',
    fullName: 'Jordan Williams',
    phone:    '(404) 555-0201',
    school:   'Buford High School',
    city:     'Buford, GA',
    gradYear: 2026,
    pos:      'RB',
    height:   '5\'11"',
    weight:   195,
    gpa:      3.40,
    forty:    4.44,
    bench:    275,
    squat:    410,
    vert:     38.0,
    shuttle:  4.22,
    ldrill:   6.88,
    broad:    121,
    powerClean: 255,
    singleLeg:  26,
    hudlUser: 'jwilliams_rb22',
    igUser:   'jordan_williams_rb',
    twitterU: 'JordanW_RB',
    achievement: '2× Region Champion; 1,847 rushing yards and 22 TDs; Named to Georgia 7A All-Region First Team; Under Armour All-American nominee',
    bio: 'Jordan is an explosive running back who combines elite speed with exceptional vision between the tackles. His 4.44 forty places him among the top prospects in the country at his position. He is a team captain and mentors younger players in the program.',
    contacts: [
      { role: 'parent',  name: 'Darius Williams', email: 'darius.williams@email.com', phone: '(404) 555-0202' },
      { role: 'coach',   name: 'Coach Ray Malone', email: 'r.malone@bufordfootball.org', phone: '(404) 555-0299' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-jordan-hl-2025', title: '2025 Highlight Reel' },
    ],
  },
  {
    email:    'deshawn.jackson@gridirontest.com',
    fullName: 'DeShawn Jackson',
    phone:    '(972) 555-0301',
    school:   'Duncanville High School',
    city:     'Duncanville, TX',
    gradYear: 2027,
    pos:      'WR',
    height:   '6\'1"',
    weight:   185,
    gpa:      3.20,
    forty:    4.38,
    bench:    185,
    squat:    315,
    vert:     40.5,
    shuttle:  4.18,
    ldrill:   6.78,
    broad:    125,
    powerClean: 195,
    singleLeg:  20,
    hudlUser: 'djackson_wr',
    igUser:   'deshawn_fly',
    twitterU: 'DeShawnFlies',
    achievement: '2025 Sophomore of the Year – Texas 6A Division I; 58 receptions 1,102 yards 14 TDs; All-District First Team both sophomore and junior seasons',
    bio: 'DeShawn is a junior standout at Duncanville with rare separation ability and elite ball-tracking skills. He runs crisp routes and has natural hands that make difficult catches look routine. Already drawing interest as a top-50 prospect nationally in the class of 2027.',
    contacts: [
      { role: 'parent', name: 'Sandra Jackson', email: 'sandra.jackson@email.com', phone: '(972) 555-0302' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-deshawn-hl-2025', title: 'Junior Year Highlights' },
      { url: 'https://www.youtube.com/watch?v=fake-deshawn-7on7', title: '7-on-7 Summer Circuit' },
    ],
  },
  {
    email:    'kyle.hendricks@gridirontest.com',
    fullName: 'Kyle Hendricks',
    phone:    '(614) 555-0401',
    school:   'St. Francis DeSales High School',
    city:     'Columbus, OH',
    gradYear: 2025,
    pos:      'OT',
    height:   '6\'6"',
    weight:   295,
    gpa:      3.60,
    forty:    5.18,
    bench:    365,
    squat:    530,
    vert:     27.0,
    shuttle:  4.75,
    ldrill:   7.60,
    broad:    95,
    powerClean: 305,
    singleLeg:  18,
    hudlUser: 'khendricks_ot72',
    igUser:   'kyle_the_wall',
    twitterU: 'KyleHendricksOL',
    achievement: 'Ohio Mr. Football Offensive Lineman of the Year finalist; 3-year starter; 0 sacks allowed senior season; Ohio 3A First-Team All-State',
    bio: 'Kyle is a prototypical NFL-frame offensive tackle with outstanding footwork and pass-protection instincts honed over four varsity seasons. His combination of length, athleticism, and football intelligence has drawn evaluations from scouts at every major program. He plans to study engineering.',
    contacts: [
      { role: 'parent', name: 'Greg Hendricks',  email: 'greg.hendricks@email.com',  phone: '(614) 555-0402' },
      { role: 'parent', name: 'Pam Hendricks',   email: 'pam.hendricks@email.com',   phone: '(614) 555-0403' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-kyle-hl-2025', title: 'Senior Season O-Line Film' },
    ],
  },
  {
    email:    'malik.davis@gridirontest.com',
    fullName: 'Malik Davis',
    phone:    '(305) 555-0501',
    school:   'Miami Northwestern Senior High School',
    city:     'Miami, FL',
    gradYear: 2026,
    pos:      'LB',
    height:   '6\'2"',
    weight:   225,
    gpa:      3.10,
    forty:    4.55,
    bench:    315,
    squat:    455,
    vert:     36.0,
    shuttle:  4.28,
    ldrill:   7.10,
    broad:    115,
    powerClean: 265,
    singleLeg:  24,
    hudlUser: 'malik_davis_lb',
    igUser:   'malikyoungbull',
    twitterU: 'MalikDavis_LB',
    achievement: '127 total tackles; 12 TFL; 6 sacks; 2 forced fumbles; Florida 6A All-State Second Team; Under Armour All-American watch list',
    bio: 'Malik is a high-motor linebacker who excels in run defense and blitz packages. His combination of size and speed allows him to make plays sideline to sideline and match up with tight ends in coverage. He leads by example and is regarded as the defensive anchor of an elite South Florida program.',
    contacts: [
      { role: 'parent',  name: 'Terrence Davis', email: 'terrence.davis@email.com', phone: '(305) 555-0502' },
      { role: 'coach',   name: 'Coach James Bright', email: 'j.bright@miamiNW.edu',  phone: '(305) 555-0598' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-malik-hl-2025', title: '2025 Defense Highlights' },
    ],
  },
  {
    email:    'trey.anderson@gridirontest.com',
    fullName: 'Trey Anderson',
    phone:    '(770) 555-0601',
    school:   'Colquitt County High School',
    city:     'Moultrie, GA',
    gradYear: 2026,
    pos:      'DE',
    height:   '6\'4"',
    weight:   245,
    gpa:      2.95,
    forty:    4.63,
    bench:    330,
    squat:    480,
    vert:     34.5,
    shuttle:  4.35,
    ldrill:   7.18,
    broad:    118,
    powerClean: 280,
    singleLeg:  22,
    hudlUser: 'trey_anderson_de',
    igUser:   'trey_unleashed',
    twitterU: 'TreyAndersonDE',
    achievement: '15 sacks; 22 TFL; Georgia 7A First-Team All-State; MaxPreps All-American Honorable Mention; 4× regional champion',
    bio: 'Trey is a relentless pass rusher with a high ceiling. He has developed a repertoire of moves including a devastating spin move and a quick inside counter that give offensive linemen trouble at every level. His motor never stops and college coaches rave about his coachability.',
    contacts: [
      { role: 'parent', name: 'Monica Anderson', email: 'monica.anderson@email.com', phone: '(770) 555-0602' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-trey-hl-2025', title: 'Pass Rush Highlights 2025' },
      { url: 'https://www.youtube.com/watch?v=fake-trey-combine', title: 'Regional Combine Workout' },
    ],
  },
  {
    email:    'isaiah.roberts@gridirontest.com',
    fullName: 'Isaiah Roberts',
    phone:    '(818) 555-0701',
    school:   'Serra High School',
    city:     'Gardena, CA',
    gradYear: 2027,
    pos:      'CB',
    height:   '6\'0"',
    weight:   175,
    gpa:      3.50,
    forty:    4.36,
    bench:    185,
    squat:    305,
    vert:     41.0,
    shuttle:  4.15,
    ldrill:   6.72,
    broad:    126,
    powerClean: 185,
    singleLeg:  19,
    hudlUser: 'isaiah_roberts_cb',
    igUser:   'isaiah_shutdown',
    twitterU: 'IsaiahRobertsDB',
    achievement: '6 INTs; 18 PBUs; California Interscholastic Federation Southern Section First Team All-CIF; Top-15 CB nationally per 247Sports (class of 2027)',
    bio: 'Isaiah is a lockdown cornerback prospect with elite length and recovery speed. He mirrors wide receivers with ease and has the ball skills to make plays on the football. Named a top-15 cornerback nationally in the 2027 class, he is already fielding offers from the nation\'s elite programs.',
    contacts: [
      { role: 'parent',  name: 'Cheryl Roberts', email: 'cheryl.roberts@email.com', phone: '(818) 555-0702' },
      { role: 'parent',  name: 'Harold Roberts', email: 'harold.roberts@email.com', phone: '(818) 555-0703' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-isaiah-hl-2025', title: 'Junior DB Highlights' },
    ],
  },
  {
    email:    'connor.murphy@gridirontest.com',
    fullName: 'Connor Murphy',
    phone:    '(617) 555-0801',
    school:   'St. John\'s Prep',
    city:     'Danvers, MA',
    gradYear: 2025,
    pos:      'TE',
    height:   '6\'5"',
    weight:   245,
    gpa:      3.75,
    forty:    4.78,
    bench:    265,
    squat:    415,
    vert:     30.0,
    shuttle:  4.45,
    ldrill:   7.25,
    broad:    105,
    powerClean: 240,
    singleLeg:  21,
    hudlUser: 'connor_murphy_te',
    igUser:   'cmurphy_bigred',
    twitterU: 'ConnorMurphyTE',
    achievement: 'Massachusetts Division 1 All-State Tight End; 48 receptions 712 yards 9 TDs; Team captain; 3× Super Bowl champion (state title); National Honor Society',
    bio: 'Connor is a complete tight end with the frame, athleticism, and hands to thrive in any offensive system. He is equally effective as an inline blocker and a receiving threat in the seam and red zone. A team captain and National Honor Society member, he is as impressive in the classroom as on the field.',
    contacts: [
      { role: 'parent', name: 'Sean Murphy',   email: 'sean.murphy@email.com',   phone: '(617) 555-0802' },
      { role: 'parent', name: 'Kathleen Murphy', email: 'kathy.murphy@email.com', phone: '(617) 555-0803' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-connor-hl-2025', title: 'Senior TE Film 2025' },
      { url: 'https://www.youtube.com/watch?v=fake-connor-blocking', title: 'Blocking & Receiving Combo Cut' },
    ],
  },
  {
    email:    'javon.brown@gridirontest.com',
    fullName: 'Javon Brown',
    phone:    '(901) 555-0901',
    school:   'Whitehaven High School',
    city:     'Memphis, TN',
    gradYear: 2026,
    pos:      'WR',
    height:   '6\'2"',
    weight:   190,
    gpa:      3.00,
    forty:    4.42,
    bench:    195,
    squat:    325,
    vert:     39.0,
    shuttle:  4.20,
    ldrill:   6.82,
    broad:    122,
    powerClean: 200,
    singleLeg:  20,
    hudlUser: 'javon_brown_wr',
    igUser:   'javon1route',
    twitterU: 'JavonBrown_WR',
    achievement: '72 receptions 1,288 yards 16 TDs; Tennessee 6A All-State First Team; 2025 Memphis Commercial Appeal Dream Team; Top-100 WR nationally (class of 2026)',
    bio: 'Javon is a long, physical receiver who dominates at the catch point. His ability to high-point the ball and win contested catches has drawn comparisons to NFL receivers who thrive in the red zone. He also has the straight-line speed to take the top off any defense.',
    contacts: [
      { role: 'parent', name: 'Carolyn Brown', email: 'carolyn.brown@email.com', phone: '(901) 555-0902' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-javon-hl-2025', title: '2025 WR Highlights' },
    ],
  },
  {
    email:    'dominic.reyes@gridirontest.com',
    fullName: 'Dominic Reyes',
    phone:    '(602) 555-1001',
    school:   'Chandler High School',
    city:     'Chandler, AZ',
    gradYear: 2025,
    pos:      'S',
    height:   '6\'1"',
    weight:   200,
    gpa:      3.30,
    forty:    4.50,
    bench:    245,
    squat:    385,
    vert:     37.5,
    shuttle:  4.25,
    ldrill:   6.95,
    broad:    119,
    powerClean: 245,
    singleLeg:  23,
    hudlUser: 'dom_reyes_safety',
    igUser:   'domreyes_hawk',
    twitterU: 'DomReyes_S',
    achievement: '94 tackles; 8 INTs; 3 forced fumbles; 2 defensive TDs; Arizona 6A All-State First Team; East Valley Tribune Player of the Year',
    bio: 'Dominic is a rangy, instinctive safety who is a nightmare for opposing quarterbacks. He reads routes pre-snap, closes with elite speed, and delivers physical hits that change the tone of the game. His communication skills allow him to function as the quarterback of the defense.',
    contacts: [
      { role: 'parent', name: 'Carlos Reyes',  email: 'carlos.reyes@email.com',  phone: '(602) 555-1002' },
      { role: 'parent', name: 'Maria Reyes',   email: 'maria.reyes@email.com',   phone: '(602) 555-1003' },
      { role: 'coach',  name: 'Coach Al Pena', email: 'a.pena@chandlerhs.edu',    phone: '(602) 555-1099' },
    ],
    videoLinks: [
      { url: 'https://www.hudl.com/video/3/fake-dominic-hl-2025', title: 'Senior Safety Highlights' },
      { url: 'https://www.youtube.com/watch?v=fake-dominic-allstate', title: 'All-State Reel 2025' },
    ],
  },
];

async function run() {
  const client = await pool.connect();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  try {
    await client.query('BEGIN');

    for (const p of PLAYERS) {
      // 1. Insert user
      const userRes = await client.query(
        `INSERT INTO users (email, password, role, full_name, phone, created_at)
         VALUES ($1, $2, 'player', $3, $4, NOW())
         ON CONFLICT (email) DO UPDATE SET
           password = EXCLUDED.password,
           full_name = EXCLUDED.full_name,
           phone = EXCLUDED.phone
         RETURNING id`,
        [p.email, passwordHash, p.fullName, p.phone]
      );
      const userId = userRes.rows[0].id;

      // 2. Insert player profile
      await client.query(
        `INSERT INTO player_profiles (
           user_id, full_name, high_school, graduation_year, position,
           height, weight, gpa,
           forty_yard_dash, bench_press, squat, vertical_jump,
           shuttle_5_10_5, l_drill, broad_jump, power_clean, single_leg_squat,
           phone, bio, achievement,
           hudl_link, instagram_link, twitter_link,
           hudl_username, instagram_username, twitter_username,
           profile_view_count
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11, $12,
           $13, $14, $15, $16, $17,
           $18, $19, $20,
           $21, $22, $23,
           $24, $25, $26,
           0
         )
         ON CONFLICT (user_id) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           high_school = EXCLUDED.high_school,
           graduation_year = EXCLUDED.graduation_year,
           position = EXCLUDED.position,
           height = EXCLUDED.height, weight = EXCLUDED.weight, gpa = EXCLUDED.gpa,
           forty_yard_dash = EXCLUDED.forty_yard_dash,
           bench_press = EXCLUDED.bench_press,
           squat = EXCLUDED.squat,
           vertical_jump = EXCLUDED.vertical_jump,
           shuttle_5_10_5 = EXCLUDED.shuttle_5_10_5,
           l_drill = EXCLUDED.l_drill,
           broad_jump = EXCLUDED.broad_jump,
           power_clean = EXCLUDED.power_clean,
           single_leg_squat = EXCLUDED.single_leg_squat,
           phone = EXCLUDED.phone, bio = EXCLUDED.bio, achievement = EXCLUDED.achievement,
           hudl_link = EXCLUDED.hudl_link,
           instagram_link = EXCLUDED.instagram_link,
           twitter_link = EXCLUDED.twitter_link,
           hudl_username = EXCLUDED.hudl_username,
           instagram_username = EXCLUDED.instagram_username,
           twitter_username = EXCLUDED.twitter_username`,
        [
          userId, p.fullName, p.school, p.gradYear, p.pos,
          p.height, p.weight, p.gpa,
          p.forty, p.bench, p.squat, p.vert,
          p.shuttle, p.ldrill, p.broad, p.powerClean, p.singleLeg,
          p.phone, p.bio, p.achievement,
          `https://www.hudl.com/profile/athlete/${p.hudlUser}`,
          `https://www.instagram.com/${p.igUser}/`,
          `https://twitter.com/${p.twitterU}`,
          p.hudlUser, p.igUser, p.twitterU,
        ]
      );

      // 3. Insert contacts (skip if already present for this user)
      for (const c of p.contacts) {
        await client.query(
          `INSERT INTO player_contacts (user_id, role, name, email, phone)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [userId, c.role, c.name, c.email, c.phone]
        );
      }

      // 4. Insert video links
      for (const v of p.videoLinks) {
        await client.query(
          `INSERT INTO player_video_links (user_id, url, title, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT DO NOTHING`,
          [userId, v.url, v.title]
        );
      }

      console.log(`  ✓ ${p.fullName} (${p.pos}, ${p.school}) — user_id ${userId}`);
    }

    await client.query('COMMIT');
    console.log(`\nDone. Inserted/updated ${PLAYERS.length} players. Password for all: ${DEFAULT_PASSWORD}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error — rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => { process.exitCode = 1; });
