const db = require('./database');

async function createTables() {
  try {
    console.log('Connecting to PostgreSQL database...');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`User: ${process.env.DB_USER}`);

    console.log('\nCreating tables and indexes...');
    await db.initialize();
    console.log('✓ Schema is up to date');

    console.log('\nVerifying tables...');
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log('Tables in database:');
    result.rows.forEach(row => console.log('  -', row.table_name));

    console.log('\n✓ PostgreSQL schema created successfully!');
  } catch (error) {
    console.error('Error creating tables:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

createTables();
