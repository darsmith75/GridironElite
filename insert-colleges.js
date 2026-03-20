const db = require('./database');
const colleges = require('./college-data');

async function insertColleges() {
  let inserted = 0;
  let updated = 0;

  for (const college of colleges) {
    const existing = await db.prepare('SELECT id FROM colleges WHERE name = ?').get(college.name);

    if (existing) {
      await db.prepare(`
        UPDATE colleges
        SET website_url = ?, conference = ?, team = ?
        WHERE id = ?
      `).run(college.website_url, college.conference, college.team, existing.id);
      updated++;
    } else {
      await db.prepare(`
        INSERT INTO colleges (name, website_url, logo, conference, team)
        VALUES (?, ?, ?, ?, ?)
      `).run(college.name, college.website_url, null, college.conference, college.team);
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