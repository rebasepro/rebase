import { Client } from "pg";
const client = new Client({
  connectionString: "postgresql://postgres:A%3FCl8L%5DpUHiO%3A%5COT@34.22.208.81:5432/firecms"
});
client.connect().then(async () => {
  let hasData = false;
  const res = await client.query(`
    SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');
  `);
  for (const row of res.rows) {
    const table = row.tablename;
    const schema = row.schemaname;
    const countRes = await client.query(`SELECT count(*) FROM "${schema}"."${table}";`);
    if (countRes.rows[0].count > 0) {
      hasData = true;
      console.log(`Table ${schema}.${table} has ${countRes.rows[0].count} rows`);
    }
  }
  if (!hasData) console.log("No data found in any tables.");
  await client.end();
}).catch(console.error);
