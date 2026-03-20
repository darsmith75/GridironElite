const db = require('./database');

async function main() {
	const tables = await db.query(`
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		ORDER BY table_name
	`);

	console.log('Tables in database:');
	tables.rows.forEach(t => console.log(`- ${t.table_name}`));
}

main()
	.catch(error => {
		console.error('Error:', error.message);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.close();
	});
