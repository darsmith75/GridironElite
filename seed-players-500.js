/**
 * seed-players-500.js
 * Generates 500 realistic test players for LOCAL TESTING ONLY.
 *
 * SAFE GUARD: This script ALWAYS connects to localhost GridironAthletes.
 * It does NOT read .env and will refuse to run against any remote host.
 *
 * Run with:
 *   node seed-players-500.js
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// ─── HARD-CODED LOCAL-ONLY connection ────────────────────────────────────────
const DB_CONFIG = {
  host:     'localhost',
  port:     5432,
  database: 'GridironAthletes',
  user:     'postgres',
  password: 'Sctcorp98!',
  ssl:      false,
};
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PASSWORD = 'TestPlayer1!';

// ── Data pools ────────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Marcus','Jordan','DeShawn','Kyle','Malik','Trey','Isaiah','Connor','Javon','Dominic',
  'Tyrese','Cameron','Elijah','Xavier','Darius','Jaylen','Caleb','Bryce','Zach','Tyler',
  'Kendrick','Donovan','Alonzo','Marquise','Jalen','Damien','Caden','Hunter','Austin','Cole',
  'Devin','Rashad','Terrell','Miles','Nathan','Aaron','Logan','Blake','Brandon','Troy',
  'Evan','Justin','Travis','Deshawn','Lamar','Kelvin','Cedric','Raymond','Quinton','Percy',
  'Anthony','Brian','Corey','Derek','Emmett','Frank','Gerald','Harold','Ivan','Jason',
  'Kevin','Leon','Michael','Norman','Oscar','Patrick','Quincy','Robert','Samuel','Thomas',
  'Ulysses','Victor','Walter','Xavier','Yusuf','Zachary','Andre','Bernard','Carlton','Denzel',
  'Earnest','Floyd','Grant','Henry','Irvin','Jerome','Kenneth','Lawrence','Maurice','Neville',
  'Orlando','Preston','Reggie','Sterling','Tavian','Ulrich','Vincent','Warren','Xander','Yancy',
  'Jaxon','Jayden','Brayden','Colton','Parker','Mason','Carter','Grayson','Liam','Noah',
  'Ethan','Oliver','Aiden','Lucas','Owen','Wyatt','Jack','Henry','Sebastian','Mateo',
  'Jackson','Asher','Levi','Dylan','Easton','Lincoln','Bentley','Ryker','Weston','Cooper',
];

const LAST_NAMES = [
  'Thompson','Williams','Jackson','Hendricks','Davis','Anderson','Roberts','Murphy','Brown','Reyes',
  'Johnson','Smith','Jones','Taylor','Wilson','Moore','Martin','Lee','Perez','White',
  'Harris','Clark','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott',
  'Green','Baker','Adams','Nelson','Carter','Mitchell','Perez','Roberts','Turner','Phillips',
  'Campbell','Parker','Evans','Edwards','Collins','Stewart','Sanchez','Morris','Rogers','Reed',
  'Cook','Morgan','Bell','Murphy','Bailey','Rivera','Cooper','Richardson','Cox','Howard',
  'Ward','Torres','Peterson','Gray','Ramirez','James','Watson','Brooks','Kelly','Sanders',
  'Price','Bennett','Wood','Barnes','Ross','Henderson','Coleman','Jenkins','Perry','Powell',
  'Long','Patterson','Hughes','Flores','Washington','Butler','Simmons','Foster','Gonzales','Bryant',
  'Alexander','Russell','Griffin','Diaz','Hayes','Myers','Ford','Hamilton','Graham','Sullivan',
  'Wallace','Woods','Cole','West','Jordan','Owens','Reynolds','Fisher','Ellis','Harrison',
  'Gibson','McDonald','Cruz','Marshall','Ortiz','Gomez','Murray','Freeman','Wells','Webb',
  'Simpson','Stevens','Tucker','Porter','Hunter','Hicks','Crawford','Henry','Boyd','Mason',
];

const POSITIONS = ['QB','RB','WR','WR','TE','OT','OG','C','DE','DT','DT','LB','LB','CB','CB','S','S','K'];

const SCHOOLS = [
  ['St. Xavier High School','Louisville, KY'],
  ['Mater Dei High School','Santa Ana, CA'],
  ['IMG Academy','Bradenton, FL'],
  ['DeMatha Catholic','Hyattsville, MD'],
  ['Bishop Gorman High School','Las Vegas, NV'],
  ['St. Thomas Aquinas','Fort Lauderdale, FL'],
  ['IMG Academy','Bradenton, FL'],
  ['Duncanville High School','Duncanville, TX'],
  ['Allen High School','Allen, TX'],
  ['Katy High School','Katy, TX'],
  ['North Shore Senior High','Galena Park, TX'],
  ['Buford High School','Buford, GA'],
  ['Colquitt County High School','Moultrie, GA'],
  ['Valdosta High School','Valdosta, GA'],
  ['Blessed Trinity Catholic','Roswell, GA'],
  ['Grayson High School','Loganville, GA'],
  ['Milton High School','Milton, GA'],
  ['Miami Northwestern Senior High','Miami, FL'],
  ['American Heritage School','Plantation, FL'],
  ['Edgewater High School','Orlando, FL'],
  ['Venice High School','Venice, FL'],
  ['Palm Beach Lakes High School','West Palm Beach, FL'],
  ['Bishop McDevitt High School','Harrisburg, PA'],
  ['St. Joseph Prep','Philadelphia, PA'],
  ['Malvern Prep','Malvern, PA'],
  ['La Salle College High School','Wyndmoor, PA'],
  ['St. John\'s Prep','Danvers, MA'],
  ['Don Bosco Prep','Ramsey, NJ'],
  ['Bergen Catholic High School','Oradell, NJ'],
  ['St. Peter\'s Prep','Jersey City, NJ'],
  ['St. Anthony\'s High School','South Huntington, NY'],
  ['Archbishop Stepinac High School','White Plains, NY'],
  ['Erasmus Hall High School','Brooklyn, NY'],
  ['Brother Rice High School','Chicago, IL'],
  ['Mount Carmel High School','Chicago, IL'],
  ['St. Rita of Cascia High School','Chicago, IL'],
  ['Cass Technical High School','Detroit, MI'],
  ['Warren De La Salle Collegiate','Warren, MI'],
  ['Pickerington North High School','Pickerington, OH'],
  ['St. Francis DeSales High School','Columbus, OH'],
  ['Elder High School','Cincinnati, OH'],
  ['St. Ignatius High School','Cleveland, OH'],
  ['De La Salle High School','Concord, CA'],
  ['Serra High School','Gardena, CA'],
  ['Long Beach Poly','Long Beach, CA'],
  ['Folsom High School','Folsom, CA'],
  ['St. John Bosco High School','Bellflower, CA'],
  ['Centennial High School','Corona, CA'],
  ['Chandler High School','Chandler, AZ'],
  ['Saguaro High School','Scottsdale, AZ'],
  ['Hamilton High School','Chandler, AZ'],
  ['Whitehaven High School','Memphis, TN'],
  ['Ensworth School','Nashville, TN'],
  ['Oakland High School','Murfreesboro, TN'],
  ['Hoover High School','Hoover, AL'],
  ['Thompson High School','Alabaster, AL'],
  ['Hewitt-Trussville High School','Trussville, AL'],
  ['St. Paul\'s Episcopal School','Mobile, AL'],
  ['Clinton High School','Clinton, MS'],
  ['Olive Branch High School','Olive Branch, MS'],
  ['Oak Grove High School','Hattiesburg, MS'],
  ['Catholic High School','Baton Rouge, LA'],
  ['John Curtis Christian School','River Ridge, LA'],
  ['Warren Easton Charter High School','New Orleans, LA'],
  ['Edna Karr High School','New Orleans, LA'],
  ['Lake Travis High School','Austin, TX'],
  ['Southlake Carroll High School','Southlake, TX'],
  ['Denton Guyer High School','Denton, TX'],
  ['Highland Park High School','Dallas, TX'],
  ['Rockwall High School','Rockwall, TX'],
  ['Lincoln High School','Tacoma, WA'],
  ['Eastside Catholic High School','Sammamish, WA'],
  ['Gonzaga Prep','Spokane, WA'],
  ['Central Catholic High School','Portland, OR'],
  ['Jesuit High School','Portland, OR'],
  ['Cherry Creek High School','Greenwood Village, CO'],
  ['Valor Christian High School','Highlands Ranch, CO'],
  ['Regis Jesuit High School','Aurora, CO'],
  ['Millard North High School','Omaha, NE'],
  ['Creighton Prep','Omaha, NE'],
  ['St. Joseph\'s Catholic High School','Metuchen, NJ'],
  ['Paul VI High School','Fairfax, VA'],
  ['Oscar Smith High School','Chesapeake, VA'],
  ['Benedictine College Preparatory','Richmond, VA'],
];

const ACHIEVEMENTS_BY_POS = {
  QB: [
    '{yards} passing yards; {td} TDs; {int} INTs; All-State {team}; led team to state semifinals',
    'District Player of the Year; {yards} total yards; {td} touchdowns; {pct}% completion rate',
    '{td} passing TDs; 2× All-Region; {yards} yards passing; team captain senior year',
    'State champion; {yards} passing yards; {td} TDs; All-State First Team; {gpa} GPA honor roll',
  ],
  RB: [
    '{yards} rushing yards; {td} rushing TDs; All-State {team}; {avg} yards per carry average',
    'School rushing record holder; {yards} yards; {td} TDs; Under Armour All-American nominee',
    '{yards} all-purpose yards; {td} TDs; District MVP; broke school single-season record',
    '2× All-Region; {yards} rushing yards; {td} TDs; state championship finalist',
  ],
  WR: [
    '{rec} receptions; {yards} receiving yards; {td} TDs; All-State {team}; 7-on-7 All-Tournament',
    '{yards} receiving yards; {td} TDs; District WR of the Year; Top-100 WR nationally',
    '{rec} catches; {yards} yards; {td} TDs; All-Region First Team both junior and senior seasons',
    'State champion; {yards} receiving yards; {td} TDs; All-State; 4.{speed} 40-yard dash verified',
  ],
  TE: [
    '{rec} receptions; {yards} yards; {td} TDs; All-State tight end; named team offensive captain',
    '{yards} receiving yards; {td} TDs; All-Region First Team; 2× state title participant',
    '{rec} catches; {yards} yards; {td} TDs; District TE of the Year; academic All-State',
  ],
  OT: [
    '3-year starter; {sacks_allowed} sacks allowed senior season; All-State {team} offensive lineman',
    'All-Region First Team; starting left tackle 4 years; {offers} Division I scholarship offers',
    'Team offensive captain; All-State; {offers} Power Four offers; zero sacks allowed in playoffs',
  ],
  OG: [
    'All-State interior lineman; team offensive captain; anchored line that averaged {yards} rush yards/game',
    '3-year starter at guard; All-Region First Team; helped team rush for {yards} yards on season',
    'All-District guard; {offers} college offers; academic All-State; team captain',
  ],
  C: [
    'All-State center; 4-year starter; team offensive captain; academic All-State; {offers} D-I offers',
    '3× All-Region; started every game 3 years; anchor of {yards} rush yards/game attack',
    'District Lineman of the Year; {offers} scholarship offers; team captain',
  ],
  DE: [
    '{sacks} sacks; {tfl} TFL; All-State {team}; MaxPreps All-American Honorable Mention',
    '{sacks} sacks; {ff} forced fumbles; All-Region First Team; Under Armour All-American watch list',
    'Team defensive captain; {sacks} sacks; {tfl} TFL; 2× regional champion; All-State',
  ],
  DT: [
    '{tfl} TFL; {sacks} sacks; All-State interior lineman; team defensive captain; {offers} D-I offers',
    'Clogged the middle all season; {tfl} TFL; {sacks} sacks; All-Region First Team',
    '{tfl} tackles for loss; {sacks} sacks; District Lineman of the Year; state championship appearance',
  ],
  LB: [
    '{tackles} total tackles; {tfl} TFL; {sacks} sacks; All-State {team}; defensive captain',
    '{tackles} tackles; {int} INTs; {tfl} TFL; All-Region linebacker of the year',
    'Led team in tackles ({tackles}); {tfl} TFL; {ff} forced fumbles; All-State {team}',
  ],
  CB: [
    '{int} INTs; {pbu} PBUs; All-State {team}; Top-50 CB nationally per 247Sports',
    '{int} interceptions; {pbu} pass breakups; District DB of the Year; All-Region First Team',
    'Zero touchdowns allowed coverage zone all season; {int} INTs; {pbu} PBUs; All-State',
  ],
  S: [
    '{tackles} tackles; {int} INTs; {ff} forced fumbles; All-State {team}; defensive team captain',
    '{tackles} tackles; {int} INTs; {tfl} TFL; District Defensive Player of the Year',
    '{int} INTs; {pbu} PBUs; {tackles} tackles; All-Region safety; team captain',
  ],
  K: [
    '{fgpct}% field goal conversion; long of {long} yards; All-State kicker; {xp}/{xpa} extra points',
    'All-Region kicker; {fgm}/{fga} FGs; long of {long} yards; All-State honorable mention',
  ],
};

const BIOS_BY_POS = {
  QB:  [
    '{name} is a dual-threat quarterback who combines a big arm with the ability to extend plays with his legs. He has drawn interest from multiple Power Four programs for his football IQ and leadership. Off the field, he is a {gpa} GPA student with ambitions to study {major}.',
    '{name} is a pocket passer with elite anticipation and accuracy on intermediate routes. His decision-making under pressure has been a hallmark of his development. He is regarded as a leader in the huddle and maintains a {gpa} GPA.',
  ],
  RB:  [
    '{name} is an explosive running back who combines elite speed with exceptional vision between the tackles. His {forty} forty-yard dash places him among the top prospects at his position. He is a team captain who mentors younger players.',
    '{name} is a hard-running back who consistently falls forward for extra yards. Pound for pound one of the strongest backs in his class, he pairs his physicality with surprising open-field quickness. He carries a {gpa} GPA.',
  ],
  WR:  [
    '{name} is a route-running specialist with elite separation ability and natural hands. He makes difficult catches look routine and has the straight-line speed to take the top off any defense. He is a {gpa} GPA student.',
    '{name} is a long, physical receiver who dominates at the catch point. His ability to high-point the ball makes him a red-zone threat at every level. He is one of the most polished receivers in his graduation class.',
  ],
  TE:  [
    '{name} is a complete tight end equally effective as an inline blocker and seam receiver. His combination of size, athleticism, and hands is rare in his class. He is a team captain and {gpa} GPA student.',
    '{name} is a matchup nightmare at tight end — too fast for linebackers, too physical for corners. He runs crisp routes and has reliable hands in traffic. He plans to study {major} in college.',
  ],
  OT:  [
    '{name} is a prototypical offensive tackle with outstanding footwork and pass-protection instincts. His combination of length and athleticism has drawn evaluations from scouts at every major program. He plans to study {major}.',
    '{name} is a powerful left tackle who controls the edge in both run and pass blocking. He is a three-year starter who has not allowed a sack in playoff competition. Team offensive captain.',
  ],
  OG:  [
    '{name} is a powerful interior lineman who excels at the point of attack in run blocking and has developed into a reliable pass protector. He is the engine of an offensive line that produces yards in bulk.',
    '{name} is a nasty, physical guard who loves contact and finishes blocks. His drive-blocking ability makes him a coveted prospect for programs that want to run the football.',
  ],
  C:   [
    '{name} is an intelligent center who makes pre-snap protection calls and keeps the line in sync. He is a four-year starter and team captain who leads by example with a {gpa} GPA.',
    '{name} is a technically sound center with long arms and good awareness in protection. College coaches praise his football IQ and his ability to reach second-level defenders in zone run schemes.',
  ],
  DE:  [
    '{name} is a relentless pass rusher with a high ceiling. He has developed an arsenal of moves that gives offensive linemen trouble at every level. His motor never stops, and college coaches rave about his coachability.',
    '{name} is a versatile edge defender who can line up as a stand-up linebacker or a hand-in-the-dirt end. His first step and closing speed make him one of the most disruptive defenders in his state.',
  ],
  DT:  [
    '{name} is a wrecking ball at defensive tackle who disrupts the run game and creates interior pressure. He is the type of player that forces double teams, creating one-on-one opportunities for teammates.',
    '{name} is a stout, two-gap defensive tackle with surprising athleticism for his size. He reads guards\' sets quickly and has the lateral quickness to pursue plays from the backside.',
  ],
  LB:  [
    '{name} is a high-motor linebacker who excels in run defense and blitz packages. His combination of size and speed allows him to make plays sideline to sideline and match up with tight ends in coverage.',
    '{name} is an instinctive linebacker who seems to be around the ball on every play. He reads the run quickly, fills gaps with conviction, and has shown the ability to play zone and man coverage.',
  ],
  CB:  [
    '{name} is a lockdown cornerback with elite length and recovery speed. He mirrors receivers with ease and has the ball skills to make plays on the football. Already drawing interest as a top prospect nationally.',
    '{name} is a physical cornerback who loves press coverage and jams receivers at the line. His toughness and competitive nature make him one of the most sought-after defensive backs in his class.',
  ],
  S:   [
    '{name} is a rangy, instinctive safety who reads routes pre-snap, closes with elite speed, and delivers physical hits that change the tone of the game. His communication skills make him the quarterback of the defense.',
    '{name} is a versatile safety who can play both deep coverage and near the line as a physical run-stopper. He brings high-level football IQ and a passion for film study to every game.',
  ],
  K:   [
    '{name} is one of the most accurate kickers in his class with a strong leg and consistent technique. He has converted clutch field goals in playoff pressure and is a reliable contributor on kickoffs as well.',
    '{name} brings a proven track record of accuracy and consistency to the kicking game. His strong leg has produced touchbacks at a high rate, and his mental composure under pressure sets him apart.',
  ],
};

const MAJORS = ['Business Administration','Sports Management','Criminal Justice','Engineering','Communications','Exercise Science','Pre-Med','Finance','Computer Science','Psychology'];
const STATE_TEAMS = ['First Team','Second Team','Honorable Mention'];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr)       { return arr[rand(0, arr.length - 1)]; }
function frand(min, max, dec = 2) { return parseFloat((Math.random() * (max - min) + min).toFixed(dec)); }

function generateStats(pos) {
  const base = {
    forty:      null, bench: null, squat: null, vert: null,
    shuttle:    null, ldrill: null, broad: null, powerClean: null, singleLeg: null,
  };
  switch(pos) {
    case 'QB':  return { forty: frand(4.60,4.90), bench: rand(215,265), squat: rand(315,420), vert: frand(28,35), shuttle: frand(4.25,4.50), ldrill: frand(6.90,7.30), broad: rand(100,115), powerClean: rand(195,255), singleLeg: rand(18,25) };
    case 'RB':  return { forty: frand(4.38,4.60), bench: rand(225,295), squat: rand(365,455), vert: frand(34,42), shuttle: frand(4.15,4.35), ldrill: frand(6.75,7.10), broad: rand(115,130), powerClean: rand(225,285), singleLeg: rand(22,28) };
    case 'WR':  return { forty: frand(4.35,4.55), bench: rand(175,215), squat: rand(285,365), vert: frand(36,44), shuttle: frand(4.10,4.30), ldrill: frand(6.65,7.05), broad: rand(118,132), powerClean: rand(175,225), singleLeg: rand(18,24) };
    case 'TE':  return { forty: frand(4.60,4.85), bench: rand(245,305), squat: rand(365,455), vert: frand(28,36), shuttle: frand(4.30,4.55), ldrill: frand(7.10,7.40), broad: rand(100,118), powerClean: rand(225,285), singleLeg: rand(19,25) };
    case 'OT':  return { forty: frand(4.95,5.35), bench: rand(315,415), squat: rand(455,575), vert: frand(22,30), shuttle: frand(4.60,4.95), ldrill: frand(7.40,7.90), broad: rand(88,105), powerClean: rand(275,345), singleLeg: rand(15,21) };
    case 'OG':  return { forty: frand(5.00,5.40), bench: rand(325,425), squat: rand(465,585), vert: frand(22,30), shuttle: frand(4.65,5.00), ldrill: frand(7.50,8.00), broad: rand(85,102), powerClean: rand(280,350), singleLeg: rand(14,20) };
    case 'C':   return { forty: frand(5.05,5.40), bench: rand(320,420), squat: rand(460,580), vert: frand(22,30), shuttle: frand(4.65,4.95), ldrill: frand(7.45,7.95), broad: rand(85,102), powerClean: rand(275,345), singleLeg: rand(14,20) };
    case 'DE':  return { forty: frand(4.55,4.80), bench: rand(285,365), squat: rand(415,515), vert: frand(30,38), shuttle: frand(4.25,4.50), ldrill: frand(7.00,7.35), broad: rand(108,122), powerClean: rand(255,315), singleLeg: rand(20,26) };
    case 'DT':  return { forty: frand(4.80,5.20), bench: rand(335,435), squat: rand(475,595), vert: frand(24,32), shuttle: frand(4.45,4.80), ldrill: frand(7.30,7.80), broad: rand(92,108), powerClean: rand(285,365), singleLeg: rand(16,22) };
    case 'LB':  return { forty: frand(4.50,4.70), bench: rand(275,345), squat: rand(405,505), vert: frand(32,40), shuttle: frand(4.20,4.40), ldrill: frand(6.95,7.25), broad: rand(110,124), powerClean: rand(245,305), singleLeg: rand(21,27) };
    case 'CB':  return { forty: frand(4.33,4.52), bench: rand(175,215), squat: rand(285,375), vert: frand(37,44), shuttle: frand(4.10,4.28), ldrill: frand(6.65,7.00), broad: rand(118,134), powerClean: rand(175,225), singleLeg: rand(18,24) };
    case 'S':   return { forty: frand(4.42,4.62), bench: rand(215,275), squat: rand(335,435), vert: frand(34,42), shuttle: frand(4.18,4.38), ldrill: frand(6.80,7.15), broad: rand(112,126), powerClean: rand(215,275), singleLeg: rand(20,26) };
    case 'K':   return { forty: frand(4.80,5.20), bench: rand(155,215), squat: rand(255,355), vert: frand(24,32), shuttle: frand(4.45,4.75), ldrill: frand(7.20,7.70), broad: rand(90,108), powerClean: rand(155,215), singleLeg: rand(15,21) };
    default:    return base;
  }
}

function generateHeight(pos) {
  const map = {
    QB:['6\'1"','6\'2"','6\'3"','6\'4"','6\'0"'],
    RB:['5\'9"','5\'10"','5\'11"','6\'0"','5\'8"'],
    WR:['5\'10"','5\'11"','6\'0"','6\'1"','6\'2"','6\'3"'],
    TE:['6\'3"','6\'4"','6\'5"','6\'6"'],
    OT:['6\'4"','6\'5"','6\'6"','6\'7"'],
    OG:['6\'2"','6\'3"','6\'4"','6\'5"'],
    C: ['6\'1"','6\'2"','6\'3"','6\'4"'],
    DE:['6\'2"','6\'3"','6\'4"','6\'5"'],
    DT:['6\'1"','6\'2"','6\'3"','6\'4"'],
    LB:['6\'0"','6\'1"','6\'2"','6\'3"'],
    CB:['5\'9"','5\'10"','5\'11"','6\'0"','6\'1"'],
    S: ['5\'11"','6\'0"','6\'1"','6\'2"'],
    K: ['5\'10"','5\'11"','6\'0"','6\'1"'],
  };
  return pick(map[pos] || ['6\'0"']);
}

function generateWeight(pos) {
  const map = { QB:[195,215], RB:[185,215], WR:[170,200], TE:[235,255], OT:[280,315], OG:[285,320], C:[275,310], DE:[235,260], DT:[280,315], LB:[215,240], CB:[165,185], S:[185,210], K:[170,195] };
  const r = map[pos] || [185,215];
  return rand(r[0], r[1]);
}

function generateAchievement(pos, stats, gpa) {
  const template = pick(ACHIEVEMENTS_BY_POS[pos] || ACHIEVEMENTS_BY_POS['LB']);
  return template
    .replace('{yards}',    rand(900,3500).toString())
    .replace('{td}',       rand(8,35).toString())
    .replace('{int}',      rand(2,12).toString())
    .replace('{rec}',      rand(30,80).toString())
    .replace('{pct}',      rand(55,72).toString())
    .replace('{avg}',      frand(5.2,8.8,1).toString())
    .replace('{tackles}',  rand(65,140).toString())
    .replace('{tfl}',      rand(6,25).toString())
    .replace('{sacks}',    rand(5,18).toString())
    .replace('{ff}',       rand(2,7).toString())
    .replace('{pbu}',      rand(8,24).toString())
    .replace('{offers}',   rand(8,35).toString())
    .replace('{sacks_allowed}', rand(0,3).toString())
    .replace('{fgpct}',    rand(72,95).toString())
    .replace('{fgm}',      rand(10,22).toString())
    .replace('{fga}',      rand(14,26).toString())
    .replace('{long}',     rand(42,56).toString())
    .replace('{xp}',       rand(38,62).toString())
    .replace('{xpa}',      rand(38,62).toString())
    .replace('{speed}',    rand(3,5).toString())
    .replace('{team}',     pick(STATE_TEAMS))
    .replace('{gpa}',      gpa.toFixed(2));
}

function generateBio(name, pos, gpa, stats) {
  const template = pick(BIOS_BY_POS[pos] || BIOS_BY_POS['LB']);
  return template
    .replace('{name}',   name.split(' ')[0])
    .replace('{gpa}',    gpa.toFixed(2))
    .replace('{forty}',  stats.forty ? stats.forty.toFixed(2) : '4.60')
    .replace('{major}',  pick(MAJORS));
}

function generatePlayer(index) {
  const firstName = pick(FIRST_NAMES);
  const lastName  = pick(LAST_NAMES);
  const fullName  = `${firstName} ${lastName}`;
  const email     = `testplayer${index + 1}@gridirontest.com`;
  const pos       = pick(POSITIONS);
  const [school, city] = pick(SCHOOLS);
  const gradYear  = pick([2025, 2026, 2026, 2027, 2027, 2028]);
  const gpa       = frand(2.40, 4.00);
  const stats     = generateStats(pos);
  const height    = generateHeight(pos);
  const weight    = generateWeight(pos);
  const areaCode  = rand(200, 989).toString();
  const phone     = `(${areaCode}) 555-${rand(1000,9999)}`;
  const igHandle  = `${firstName.toLowerCase()}${lastName.toLowerCase()}${rand(1,99)}`;
  const hudlHandle= `${firstName.toLowerCase().replace(/[^a-z]/g,'')}${lastName.toLowerCase().replace(/[^a-z]/g,'')}_${pos.toLowerCase()}`;
  const twitterH  = `${firstName}${lastName}${pos}`;

  const contacts = [];
  // Always add one parent
  contacts.push({
    role: 'parent',
    name: `${pick(['James','Robert','John','Michael','William','David','Richard','Joseph','Thomas','Charles'])} ${lastName}`,
    email: `parent.${lastName.toLowerCase()}${index}@email.com`,
    phone: `(${rand(200,989)}) 555-${rand(1000,9999)}`,
  });
  // 40% chance of second parent
  if (Math.random() < 0.4) {
    contacts.push({
      role: 'parent',
      name: `${pick(['Mary','Patricia','Jennifer','Linda','Barbara','Susan','Jessica','Karen','Sarah','Lisa'])} ${lastName}`,
      email: `parent2.${lastName.toLowerCase()}${index}@email.com`,
      phone: `(${rand(200,989)}) 555-${rand(1000,9999)}`,
    });
  }
  // 30% chance of coach contact
  if (Math.random() < 0.3) {
    contacts.push({
      role: 'coach',
      name: `Coach ${pick(LAST_NAMES)}`,
      email: `coach${index}@schoolfootball.org`,
      phone: `(${rand(200,989)}) 555-${rand(1000,9999)}`,
    });
  }

  const videoLinks = [];
  videoLinks.push({ url: `https://www.hudl.com/profile/athlete/${hudlHandle}`, title: `${gradYear} Highlight Film` });
  if (Math.random() < 0.55) {
    videoLinks.push({ url: `https://www.youtube.com/watch?v=testfake${index}`, title: `Senior Season Top Plays` });
  }

  return {
    email, fullName, phone, school, gradYear, pos, height, weight, gpa: parseFloat(gpa.toFixed(2)),
    stats, igHandle, hudlHandle, twitterH, contacts, videoLinks,
    achievement: generateAchievement(pos, stats, gpa),
    bio: generateBio(fullName, pos, gpa, stats),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🏈  Seed 500 Test Players → ${DB_CONFIG.host}/${DB_CONFIG.database}  (LOCAL ONLY)\n`);
  const pool = new Pool(DB_CONFIG);
  const client = await pool.connect();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const TOTAL = 500;
  let inserted = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < TOTAL; i++) {
      const p = generatePlayer(i);

      const userRes = await client.query(
        `INSERT INTO users (email, password, role, full_name, phone, created_at)
         VALUES ($1, $2, 'player', $3, $4, NOW())
         ON CONFLICT (email) DO UPDATE SET
           password = EXCLUDED.password, full_name = EXCLUDED.full_name, phone = EXCLUDED.phone
         RETURNING id`,
        [p.email, passwordHash, p.fullName, p.phone]
      );
      const userId = userRes.rows[0].id;

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
           $1,$2,$3,$4,$5,
           $6,$7,$8,
           $9,$10,$11,$12,
           $13,$14,$15,$16,$17,
           $18,$19,$20,
           $21,$22,$23,
           $24,$25,$26,
           0
         )
         ON CONFLICT (user_id) DO UPDATE SET
           full_name=EXCLUDED.full_name, high_school=EXCLUDED.high_school,
           graduation_year=EXCLUDED.graduation_year, position=EXCLUDED.position,
           height=EXCLUDED.height, weight=EXCLUDED.weight, gpa=EXCLUDED.gpa,
           forty_yard_dash=EXCLUDED.forty_yard_dash, bench_press=EXCLUDED.bench_press,
           squat=EXCLUDED.squat, vertical_jump=EXCLUDED.vertical_jump,
           shuttle_5_10_5=EXCLUDED.shuttle_5_10_5, l_drill=EXCLUDED.l_drill,
           broad_jump=EXCLUDED.broad_jump, power_clean=EXCLUDED.power_clean,
           single_leg_squat=EXCLUDED.single_leg_squat,
           phone=EXCLUDED.phone, bio=EXCLUDED.bio, achievement=EXCLUDED.achievement,
           hudl_link=EXCLUDED.hudl_link, instagram_link=EXCLUDED.instagram_link,
           twitter_link=EXCLUDED.twitter_link,
           hudl_username=EXCLUDED.hudl_username, instagram_username=EXCLUDED.instagram_username,
           twitter_username=EXCLUDED.twitter_username`,
        [
          userId, p.fullName, p.school, p.gradYear, p.pos,
          p.height, p.weight, p.gpa,
          p.stats.forty, p.stats.bench, p.stats.squat, p.stats.vert,
          p.stats.shuttle, p.stats.ldrill, p.stats.broad, p.stats.powerClean, p.stats.singleLeg,
          p.phone, p.bio, p.achievement,
          `https://www.hudl.com/profile/athlete/${p.hudlHandle}`,
          `https://www.instagram.com/${p.igHandle}/`,
          `https://twitter.com/${p.twitterH}`,
          p.hudlHandle, p.igHandle, p.twitterH,
        ]
      );

      for (const c of p.contacts) {
        await client.query(
          `INSERT INTO player_contacts (user_id, role, name, email, phone) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [userId, c.role, c.name, c.email, c.phone]
        );
      }

      for (const v of p.videoLinks) {
        await client.query(
          `INSERT INTO player_video_links (user_id, url, title, created_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT DO NOTHING`,
          [userId, v.url, v.title]
        );
      }

      inserted++;
      if (inserted % 50 === 0) process.stdout.write(`  ${inserted}/${TOTAL} inserted...\n`);
    }

    await client.query('COMMIT');
    console.log(`\n✓ Done. ${inserted} players inserted into ${DB_CONFIG.database}.`);
    console.log(`  Login password for all: ${DEFAULT_PASSWORD}\n`);

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
