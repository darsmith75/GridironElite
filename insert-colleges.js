const db = require('./database');
const colleges = require('./college-data');

function inferDivisionFromConference(conference) {
  const normalized = String(conference || '').trim();
  if (!normalized) return null;
  const fbsConferences = new Set([
    'ACC',
    'American',
    'Big 12',
    'Big Ten',
    'Conference USA',
    'FBS Independents',
    'Mid-American',
    'Mountain West',
    'Pac-12',
    'SEC',
    'Sun Belt'
  ]);
  return fbsConferences.has(normalized) ? 'NCAA Division I (FBS)' : null;
}

async function insertColleges() {
  let inserted = 0;
  let updated = 0;

  for (const college of colleges) {
    const existing = await db.prepare('SELECT id FROM colleges WHERE name = ?').get(college.name);

    if (existing) {
      const division = (college.division || '').trim() || inferDivisionFromConference(college.conference);
      await db.prepare(`
        UPDATE colleges
        SET website_url = ?, division = ?, conference = ?, team = ?
        WHERE id = ?
      `).run(college.website_url, division, college.conference, college.team, existing.id);
      updated++;
    } else {
      const division = (college.division || '').trim() || inferDivisionFromConference(college.conference);
      await db.prepare(`
        INSERT INTO colleges (name, website_url, logo, division, conference, team)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(college.name, college.website_url, null, division, college.conference, college.team);
      inserted++;
    }
  }

  console.log(`Colleges inserted: ${inserted}`);
  console.log(`Colleges updated: ${updated}`);
  console.log(`Total processed: ${colleges.length}`);
}

insertColleges()
  .catch(error => {
    console.error('Failed to insert college data:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });