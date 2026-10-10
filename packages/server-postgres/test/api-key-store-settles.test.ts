/**
 * A warm boot of the API-key store reads the catalogue once and writes nothing.
 *
 * `ensureTable` ran its whole bootstrap on every boot: `CREATE SCHEMA` and
 * `CREATE TABLE IF NOT EXISTS`, four `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
 * (each queues for the table's ACCESS EXCLUSIVE lock before finding the column
 * there, so a long reader on `api_keys` held the boot), two
 * `CREATE INDEX IF NOT EXISTS` (each taking a SHARE lock), the duplicate-index
 * drop, a readability probe, the legacy-column probe and a `REVOKE` that
 * rewrote the table's catalogue row. That was 12 statements on a database
 * where every one of them was a no-op.
 *
 * Now one read decides it. Anything missing, granted or legacy, or a read that
 * fails, runs the full bootstrap as before, so every repair still happens.
 */
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import { createApiKeyStore } from "../../server/src/auth/api-keys/api-key-store";

describe("the API-key store's boot settles", () => {
    let db: PGlite;
    let statements: string[];
    let driver: DataDriver;

    beforeEach(async () => {
        db = new PGlite();
        await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN`);
        statements = [];
        driver = {
            admin: {
                executeSql: async (text: string, options?: { params?: unknown[] }) => {
                    statements.push(text.replace(/\s+/g, " ").trim());
                    return (await db.query<Record<string, unknown>>(text, options?.params)).rows;
                }
            }
        } as unknown as DataDriver;
    });

    afterEach(async () => {
        await db.close();
    });

    const boot = async (): Promise<string[]> => {
        statements = [];
        await createApiKeyStore(driver)!.ensureTable();
        return statements;
    };

    /** The transaction that last wrote `rebase.api_keys`'s `pg_class` row. */
    const rowVersion = async (): Promise<string> =>
        (await db.query<{ xmin: string }>("SELECT xmin::text AS xmin FROM pg_class WHERE oid = 'rebase.api_keys'::regclass")).rows[0].xmin;

    const userRoleCanRead = async (): Promise<boolean> =>
        (await db.query<{ holds: boolean }>(
            `SELECT has_table_privilege('${REBASE_USER_ROLE}', 'rebase.api_keys', 'SELECT') AS holds`
        )).rows[0].holds;

    const indexNames = async (): Promise<string[]> =>
        (await db.query<{ name: string }>(
            "SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'rebase' AND tablename = 'api_keys' ORDER BY 1"
        )).rows.map(row => row.name);

    it("runs one read and writes nothing once the table is in place", async () => {
        const cold = await boot();
        expect(cold.length).toBeGreaterThan(5);
        const settled = await rowVersion();
        const indexes = await indexNames();

        const warm = await boot();

        expect(warm).toHaveLength(1);
        expect(warm[0]).toMatch(/^SELECT /);
        expect(await rowVersion()).toBe(settled);
        expect(await indexNames()).toEqual(indexes);
        expect(await userRoleCanRead()).toBe(false);
    });

    it("takes back a privilege granted by hand", async () => {
        await boot();
        await db.exec(`GRANT SELECT ON rebase.api_keys TO ${REBASE_USER_ROLE}`);
        expect(await userRoleCanRead()).toBe(true);

        await boot();

        expect(await userRoleCanRead()).toBe(false);
    });

    it("puts back a dropped index", async () => {
        await boot();
        const indexes = await indexNames();
        await db.exec("DROP INDEX rebase.idx_api_keys_prefix");

        await boot();

        expect(await indexNames()).toEqual(indexes);
        expect(await boot()).toHaveLength(1);
    });

    it("puts back a dropped column", async () => {
        await boot();
        await db.exec("ALTER TABLE rebase.api_keys DROP COLUMN kind");

        const repair = await boot();

        expect(repair.some(s => s.includes("ADD COLUMN IF NOT EXISTS kind"))).toBe(true);
        expect(await boot()).toHaveLength(1);
    });

    it("drops the duplicate hash index an older release built", async () => {
        await boot();
        await db.exec("CREATE INDEX idx_api_keys_hash ON rebase.api_keys (key_hash)");

        await boot();

        expect(await indexNames()).not.toContain("idx_api_keys_hash");
    });

    it("still backfills scopes while the pre-scopes columns are there", async () => {
        await boot();
        await db.exec(
            "ALTER TABLE rebase.api_keys ADD COLUMN permissions JSONB, ADD COLUMN admin BOOLEAN DEFAULT false;" +
            "INSERT INTO rebase.api_keys (id, name, key_prefix, key_hash, scopes, created_by, permissions, admin) VALUES " +
            "('k1', 'old', 'rk_live_0000', 'h1', NULL, 'u', '[{\"collection\":\"posts\",\"operations\":[\"read\"]}]', false)"
        );

        await boot();

        const { rows } = await db.query<{ scopes: string[] }>("SELECT scopes FROM rebase.api_keys WHERE id = 'k1'");
        expect(rows[0].scopes).toEqual(["data:read:posts"]);
    });
});
