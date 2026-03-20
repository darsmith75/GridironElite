const db = require('./database');

async function main() {
  const tableResult = await db.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_favorites'
    LIMIT 1
  `);
  const tableExists = tableResult.rows.length > 0;
  console.log('Agent favorites table exists:', tableExists);

  if (tableExists) {
    const columns = await db.query(`
      SELECT column_name AS name, data_type AS type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'agent_favorites'
      ORDER BY ordinal_position
    `);
    console.log('\nTable structure:');
    columns.rows.forEach(col => console.log(`- ${col.name} (${col.type})`));

    const count = await db.prepare('SELECT COUNT(*)::int AS count FROM agent_favorites').get();
    console.log(`\nCurrent favorites count: ${count.count}`);
  }

  console.log('\nFavorites system is ready!');
}

main()
  .catch(error => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
