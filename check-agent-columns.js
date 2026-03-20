const db = require('./database');

async function main() {
	const columns = await db.query(`
		SELECT column_name AS name, data_type AS type
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'users'
		ORDER BY ordinal_position
	`);

	console.log('Users table columns:');
	columns.rows.forEach(col => console.log(`- ${col.name} (${col.type})`));

	const agent = await db.prepare('SELECT * FROM users WHERE email = ?').get('agent2@example.com');
	console.log('\nCurrent agent2 data:');
	console.log(JSON.stringify(agent || null, null, 2));
}

main()
	.catch(error => {
		console.error('Error:', error.message);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.close();
	});
