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
