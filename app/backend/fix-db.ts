import { Pool } from "pg";

async function main() {
    const pool = new Pool({
        connectionString: "postgresql://postgres:A%3FCl8L%5DpUHiO%3A%5COT@34.22.208.81:5432/firecms",
    });
    try {
        await pool.query("ALTER TABLE products DROP COLUMN IF EXISTS image;");
        await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS images jsonb;");
        await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS available_locales jsonb;");
        console.log("✅ Schema updated manually!");
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
main();
