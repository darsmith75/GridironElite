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
