const db = require('./database');

function qid(identifier) {
    return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function main() {
    const tablesResult = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `);

    const tables = tablesResult.rows.map(r => r.table_name);
    console.log('Tables found:', tables);

    for (const tableName of tables) {
        const countResult = await db.query(`SELECT COUNT(*)::int AS cnt FROM ${qid(tableName)}`);
        const count = countResult.rows[0]?.cnt || 0;

        console.log(`${tableName}: ${count} rows`);
        if (count > 0 && count <= 20) {
            const rows = await db.query(`SELECT * FROM ${qid(tableName)}`);
            console.log('  Data:', JSON.stringify(rows.rows, null, 2));
        } else if (count > 20) {
            const rows = await db.query(`SELECT * FROM ${qid(tableName)} LIMIT 5`);
            console.log('  First 5 rows:', JSON.stringify(rows.rows, null, 2));
        }
    }
}

main()
    .catch(error => {
        console.error('Error:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.close();
    });
