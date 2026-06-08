require('dotenv').config();
const db = require('../database');

const D2_LOGO_MAP = {
  'Barton College': 'images/collegelogos/D2/CC/sch-barton-17538800486938_sm.jpg',
  'Chowan University': 'images/collegelogos/D2/CC/sch-chowan-15402373801594_sm.jpg',
  'Erskine College': 'images/collegelogos/D2/CC/sch-erskine-15820544053547_sm.jpg',
  'Ferrum College': 'images/collegelogos/D2/CC/sch-ferrum-17440627988467_sm.jpg',
  'North Greenville University': 'images/collegelogos/D2/CC/sch-north-greenville-17538804909813_sm.jpg',
  'Shorter University': 'images/collegelogos/D2/CC/sch-shorter-15402630183188_sm.jpg',
  'University of North Carolina at Pembroke': 'images/collegelogos/D2/CC/sch-unc-pembroke-15402644190936_sm.jpg',
  'Bluefield State University': 'images/collegelogos/D2/CIAA/sch-bluefield-state-17539064736067_sm.jpg',
  'Bowie State University': 'images/collegelogos/D2/CIAA/sch-bowie-state-17444796652935_sm.jpg',
  'Elizabeth City State University': 'images/collegelogos/D2/CIAA/sch-elizabeth-city-state-17533703376799_sm.jpg',
  'Fayetteville State University': 'images/collegelogos/D2/CIAA/sch-fayetteville-state-17533708064537_sm.jpg',
  'Johnson C. Smith University': 'images/collegelogos/D2/CIAA/sch-johnson-c.-smith-17533711075043_sm.jpg',
  'Lincoln University (PA)': 'images/collegelogos/D2/CIAA/sch-lincoln-pa-17533714452123_sm.jpg',
  'Livingstone College': 'images/collegelogos/D2/CIAA/sch-livingstone-17533717392114_sm.jpg',
  'Shaw University': 'images/collegelogos/D2/CIAA/sch-shaw-17533720039991_sm.jpg',
  'Virginia State University': 'images/collegelogos/D2/CIAA/sch-virginia-state-17533722802064_sm.jpg',
  'Virginia Union University': 'images/collegelogos/D2/CIAA/sch-virginia-union-17575424219505_sm.jpg',
  'Winston-Salem State University': 'images/collegelogos/D2/CIAA/sch-winston-salem-state-17533728611274_sm.jpg',
  'Davenport University': 'images/collegelogos/D2/GLIAC/sch-davenport-17537262692997_sm.jpg',
  'Ferris State University': 'images/collegelogos/D2/GLIAC/sch-ferris-state-17352478064993_sm.jpg',
  'Grand Valley State University': 'images/collegelogos/D2/GLIAC/sch-grand-valley-17533894899297_sm.jpg',
  'Michigan Technological University': 'images/collegelogos/D2/GLIAC/sch-mtech-17537273755902_sm.jpg',
  'Northern Michigan University': 'images/collegelogos/D2/GLIAC/sch-northern-mich-17537296478735_sm.jpg',
  'Roosevelt University': 'images/collegelogos/D2/GLIAC/sch-roosevelt-17241759899269_sm.jpg',
  'Saginaw Valley State University': 'images/collegelogos/D2/GLIAC/sch-saginaw-17537304175487_sm.jpg',
  'Wayne State University': 'images/collegelogos/D2/GLIAC/sch-wayne-state-17537309793021_sm.jpg',
  'Lincoln (Mo.)': 'images/collegelogos/D2/GLVC/sch-lincoln-mo.-17538814652603_sm.jpg',
  'McKendree University': 'images/collegelogos/D2/GLVC/sch-mckendree-172505588969_sm.jpg',
  'Missouri S&T': 'images/collegelogos/D2/GLVC/sch-missouri-st-15791883726254_sm.jpg',
  'Quincy University': 'images/collegelogos/D2/GLVC/sch-quincy-15402628542821_sm.jpg',
  'Southwest Baptist University': 'images/collegelogos/D2/GLVC/sch-southwest-baptist-17538940286077_sm.jpg',
  'Truman State University': 'images/collegelogos/D2/GLVC/sch-truman-state-17539000643267_sm.jpg',
  'University of Indianapolis': 'images/collegelogos/D2/GLVC/sch-indianapolis-15651452014691_sm.jpg',
  'Upper Iowa University': 'images/collegelogos/D2/GLVC/sch-upper-iowa-17539007974026_sm.jpg',
  'William Jewell College': 'images/collegelogos/D2/GLVC/sch-william-jewell-15651418963418_sm.jpg',
  'Ashland University': 'images/collegelogos/D2/GMAC/sch-ashland-15402013328406_sm.jpg',
  'Hillsdale College': 'images/collegelogos/D2/GMAC/sch-hillsdale-16619825487995_sm.jpg',
  'Kentucky Wesleyan College': 'images/collegelogos/D2/GMAC/sch-kentucky-wesleyan-1565145123947_sm.jpg',
  'Lake Erie College': 'images/collegelogos/D2/GMAC/sch-lake-erie-15651450436932_sm.jpg',
  'Northwood': 'images/collegelogos/D2/GMAC/sch-northwood-17241755751869_sm.jpg',
  'Ohio Dominican University': 'images/collegelogos/D2/GMAC/sch-ohio-dominican-17539021677197_sm.jpg',
  'Thomas More University': 'images/collegelogos/D2/GMAC/sch-thomas-more-16739304887787_sm.jpg',
  'Tiffin University': 'images/collegelogos/D2/GMAC/sch-tiffin-17243636402468_sm.jpg',
  'University of Findlay': 'images/collegelogos/D2/GMAC/sch-findlay-17539016351737_sm.jpg',
  'Walsh University': 'images/collegelogos/D2/GMAC/sch-walsh-15651424456076_sm.jpg',
  'Angelo State University': 'images/collegelogos/D2/LSC/sch-angelo-state-17539032502728_sm.jpg',
  'Central Washington University': 'images/collegelogos/D2/LSC/sch-central-washington-17539036754306_sm.jpg',
  'Eastern New Mexico University': 'images/collegelogos/D2/LSC/sch-eastern-new-mexico-17241753325483_sm.jpg',
  'Midwestern State University': 'images/collegelogos/D2/LSC/sch-midwestern-state-15402609937904_sm.jpg',
  'Sul Ross State University': 'images/collegelogos/D2/LSC/sch-sul-ross-17533681139447_sm.jpg',
  'Texas A&M University-Kingsville': 'images/collegelogos/D2/LSC/sch-texas-am-kingsville-15651429020349_sm.jpg',
  'University of Texas Permian Basin': 'images/collegelogos/D2/LSC/sch-ut-permian-basin-17539041240919_sm.jpg',
  'Western New Mexico University': 'images/collegelogos/D2/LSC/sch-western-new-mexico-15402662620146_sm.jpg',
  'Western Oregon University': 'images/collegelogos/D2/LSC/sch-western-oregon-17241757836952_sm.jpg',
  'West Texas A&M University': 'images/collegelogos/D2/LSC/sch-west-texas-am-15651400304693_sm.jpg',
  'Concord University': 'images/collegelogos/D2/MEC/sch-concord-17539053137871_sm.jpg',
  'Fairmont State University': 'images/collegelogos/D2/MEC/sch-fairmont-state-15651467375543_sm.jpg',
  'Frostburg State University': 'images/collegelogos/D2/MEC/sch-frostburg-state-17241754252538_sm.jpg',
  'Glenville State University': 'images/collegelogos/D2/MEC/sch-glenville-state-15402518865457_sm.jpg',
  'University of Charleston': 'images/collegelogos/D2/MEC/sch-charleston-15959639668043_sm.jpg',
  'West Liberty University': 'images/collegelogos/D2/MEC/sch-west-liberty-15651420799777_sm.jpg',
  'West Virginia State University': 'images/collegelogos/D2/MEC/sch-west-virginia-state-17539058471654_sm.jpg',
  'West Virginia Wesleyan College': 'images/collegelogos/D2/MEC/sch-west-virginia-wesleyan-15402662022462_sm.jpg',
  'Wheeling University': 'images/collegelogos/D2/MEC/sch-wheeling-jesuit-15508802715379_sm.jpg',
  'American International College': 'images/collegelogos/D2/NE10/sch-american-international-17241543157266_sm.jpg',
  'Assumption University': 'images/collegelogos/D2/NE10/sch-assumption-17241752259678_sm.jpg',
  'Bentley University': 'images/collegelogos/D2/NE10/sch-bentley-16617059417062_sm.jpg',
  'Franklin Pierce University': 'images/collegelogos/D2/NE10/sch-franklin-pierce-1547962471352_sm.jpg',
  'Pace University': 'images/collegelogos/D2/NE10/sch-pace-15402628275717_sm.jpg',
  'Post University': 'images/collegelogos/D2/NE10/sch-post-16126322471299_sm.jpg',
  'Saint Anselm College': 'images/collegelogos/D2/NE10/sch-saint-anselm-17538224790478_sm.jpg',
  'Augustana University': 'images/collegelogos/D2/NSIC/sch-augie-17538179350162_sm.jpg',
  'Bemidji State University': 'images/collegelogos/D2/NSIC/sch-bemidji-state-17538183362553_sm.jpg',
  'Concordia University, St. Paul': 'images/collegelogos/D2/NSIC/sch-concordia-st.-paul-17538218264839_sm.jpg',
  'University of Jamestown': 'images/collegelogos/D2/NSIC/sch-jamestown-1753229743127_sm.jpg',
  'University of Mary': 'images/collegelogos/D2/NSIC/sch-mary-15651446832796_sm.jpg',
  'University of Minnesota Duluth': 'images/collegelogos/D2/NSIC/sch-minnesota-duluth-15402608275043_sm.jpg',
  'Minnesota State University, Mankato': 'images/collegelogos/D2/NSIC/sch-minnesota-state-17538189953656_sm.jpg',
  'Minot State University': 'images/collegelogos/D2/NSIC/sch-minot-state-17538194128862_sm.jpg',
  'MSU Moorhead': 'images/collegelogos/D2/NSIC/sch-msu-moorhead-17538198798386_sm.jpg',
  'Northern State University': 'images/collegelogos/D2/NSIC/sch-northern-state-15402625519521_sm.jpg',
  'University of Sioux Falls': 'images/collegelogos/D2/NSIC/sch-sioux-falls-17533922069949_sm.jpg',
  'Southwest Minnesota State University': 'images/collegelogos/D2/NSIC/sch-southwest-minnesota-state-17538203253511_sm.jpg',
  'Wayne State College': 'images/collegelogos/D2/NSIC/sch-wayne-state-neb.-17538208780632_sm.jpg',
  'Winona State University': 'images/collegelogos/D2/NSIC/sch-winona-state-1753821317091_sm.jpg',
  'Bloomsburg University': 'images/collegelogos/D2/PSAC/bloomsburg.jpg',
  'California University of Pennsylvania': 'images/collegelogos/D2/PSAC/california.jpg',
  'Clarion University': 'images/collegelogos/D2/PSAC/clarion.jpg',
  'East Stroudsburg University': 'images/collegelogos/D2/PSAC/east-stroudsburg.jpg',
  'Edinboro University': 'images/collegelogos/D2/PSAC/edinboro.jpg',
  'Gannon University': 'images/collegelogos/D2/PSAC/gannon.jpg',
  'Indiana University of Pennsylvania': 'images/collegelogos/D2/PSAC/iup.jpg',
  'Kutztown University': 'images/collegelogos/D2/PSAC/kutztown.jpg',
  'Lock Haven University': 'images/collegelogos/D2/PSAC/lock-haven.jpg',
  'Millersville University': 'images/collegelogos/D2/PSAC/millersville.jpg',
  'Seton Hill University': 'images/collegelogos/D2/PSAC/seton-hill.jpg',
  'Shepherd University': 'images/collegelogos/D2/PSAC/shepherd.jpg',
  'Shippensburg University': 'images/collegelogos/D2/PSAC/shippensburg.jpg',
  'Slippery Rock University': 'images/collegelogos/D2/PSAC/slippery-rock.jpg',
  'West Chester University': 'images/collegelogos/D2/PSAC/west-chester.jpg'
};

(async () => {
  let updated = 0;
  let skipped = 0;

  for (const [name, logo] of Object.entries(D2_LOGO_MAP)) {
    const existing = await db.prepare('SELECT id, logo FROM colleges WHERE name = ?').get(name);
    if (!existing) {
      skipped++;
      console.log(`SKIP missing college: ${name}`);
      continue;
    }

    if (existing.logo === logo) {
      skipped++;
      console.log(`SKIP already correct: ${name}`);
      continue;
    }

    await db.prepare('UPDATE colleges SET logo = ? WHERE id = ?').run(logo, existing.id);
    updated++;
    console.log(`UPDATED ${name} -> ${logo}`);
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
})()
  .catch((error) => {
    console.error('Failed to repair D2 logo paths:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
