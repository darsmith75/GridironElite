const db = require('./database');
const colleges = require('./college-data');

function inferDivisionFromConference(conference) {
  const normalized = String(conference || '').trim();
  if (!normalized) return null;
  const divisionByConference = new Map([
    ['FBS Independents', 'FBS'],
    ['Pac-12', 'FBS'],
    ['American', 'FBS'],
    ['Mid-American', 'FBS'],
    ['Mountain West', 'FBS'],
    ['SEC', 'FBS'],
    ['Sun Belt', 'FBS'],
    ['ACC', 'FBS'],
    ['Big Ten', 'FBS'],
    ['Conference USA', 'FBS'],
    ['Big 12', 'FBS'],
    ['UAC', 'FCS'],
    ['NEC', 'FCS'],
    ['Independent', 'FCS'],
    ['MEAC', 'FCS'],
    ['Southland', 'FCS'],
    ['Patriot League', 'FCS'],
    ['SWAC', 'FCS'],
    ['Ivy League', 'FCS'],
    ['CAA', 'FCS'],
    ['Big South-OVC', 'FCS'],
    ['Pioneer', 'FCS'],
    ['SoCon', 'FCS'],
    ['Missouri Valley', 'FCS'],
    ['Big Sky', 'FCS'],
    ['CIAA', 'D2'],
    ['CC', 'D2'],
    ['GLIAC', 'D2'],
    ['GLVC', 'D2'],
    ['GMAC', 'D2'],
    ['LSC', 'D2'],
    ['MIAA', 'D2'],
    ['MEC', 'D2'],
    ['NE10', 'D2'],
    ['NSIC', 'D2'],
    ['Independent DII', 'D2'],
    ['PSAC', 'D2'],
    ['RMAC', 'D2'],
    ['SAC', 'D2'],
    ['SIAC', 'D2']
  ]);
  return divisionByConference.get(normalized) || null;
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