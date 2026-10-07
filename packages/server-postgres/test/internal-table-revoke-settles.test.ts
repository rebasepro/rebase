/**
 * `revokeInternalTableSql` revokes only what is there to revoke.
 *
 * Every store that owns an internal table — API keys, cron, jobs, history,
 * branches, channels, idempotency keys, rate limits, metrics, MCP OAuth — runs
 * it on every boot. A `REVOKE` rewrites the table's `pg_class` row whether or
 * not anything was granted, and that invalidates every cached plan touching
 * the table on every connection. So the statement now checks the catalogue
 * first, inside the same `DO`. A database whose internal tables hold no grant
 * for the end-user role writes nothing, and every state that used to change
 * still changes the same way.
 */
import { PGlite } from "@electric-sql/pglite";
import { REBASE_USER_ROLE, revokeInternalTableSql } from "@rebasepro/common";

describe("revoking the end-user role from an internal table", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.exec(
            `CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN;` +
            "CREATE SCHEMA rebase;" +
            "CREATE TABLE rebase.api_keys (id text PRIMARY KEY, key_hash text);"
        );
    });

    afterEach(async () => {
        await db.close();
    });

    /** The transaction that last wrote the table's `pg_class` row. */
    const rowVersion = async (): Promise<string> =>
        (await db.query<{ xmin: string }>("SELECT xmin::text AS xmin FROM pg_class WHERE oid = 'rebase.api_keys'::regclass")).rows[0].xmin;

    const acl = async (): Promise<string | null> =>
        (await db.query<{ acl: string | null }>("SELECT relacl::text AS acl FROM pg_class WHERE oid = 'rebase.api_keys'::regclass")).rows[0].acl;

    const holds = async (privilege: string): Promise<boolean> =>
        (await db.query<{ holds: boolean }>(
            `SELECT has_table_privilege('${REBASE_USER_ROLE}', 'rebase.api_keys', '${privilege}') AS holds`
        )).rows[0].holds;

    const revoke = () => db.exec(revokeInternalTableSql("rebase", "api_keys"));

    it("takes a grant away, and then leaves the table's catalogue row alone", async () => {
        await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON rebase.api_keys TO ${REBASE_USER_ROLE}`);
        await revoke();
        expect(await holds("SELECT")).toBe(false);
        expect(await holds("INSERT")).toBe(false);

        const settled = await rowVersion();
        const settledAcl = await acl();
        await revoke();
        await revoke();
        expect(await rowVersion()).toBe(settled);
        expect(await acl()).toBe(settledAcl);
    });

    it("writes out an ACL that was never written, once, as the bare REVOKE did", async () => {
        expect(await acl()).toBeNull();
        await revoke();
        // What `REVOKE` always did to a table with the default ACL: write the
        // owner's privileges out explicitly.
        expect(await acl()).not.toBeNull();
        const settled = await rowVersion();
        await revoke();
        expect(await rowVersion()).toBe(settled);
    });

    it("takes back a column grant, which the table's own ACL does not show", async () => {
        await revoke();
        await db.exec(`GRANT SELECT (key_hash) ON rebase.api_keys TO ${REBASE_USER_ROLE}`);
        expect((await db.query<{ holds: boolean }>(
            `SELECT has_column_privilege('${REBASE_USER_ROLE}', 'rebase.api_keys', 'key_hash', 'SELECT') AS holds`
        )).rows[0].holds).toBe(true);

        await revoke();

        expect((await db.query<{ holds: boolean }>(
            `SELECT has_column_privilege('${REBASE_USER_ROLE}', 'rebase.api_keys', 'key_hash', 'SELECT') AS holds`
        )).rows[0].holds).toBe(false);
    });

    it("takes back a grant made by hand after it settled", async () => {
        await revoke();
        await db.exec(`GRANT SELECT ON rebase.api_keys TO ${REBASE_USER_ROLE}`);
        await revoke();
        expect(await holds("SELECT")).toBe(false);
    });

    it("still leaves a collection table alone, granted or not", async () => {
        await db.exec(
            "ALTER TABLE rebase.api_keys ENABLE ROW LEVEL SECURITY;" +
            `GRANT SELECT ON rebase.api_keys TO ${REBASE_USER_ROLE}`
        );
        await revoke();
        expect(await holds("SELECT")).toBe(true);
    });

    it("is a no-op for a table that does not exist, or a role that does not", async () => {
        await expect(db.exec(revokeInternalTableSql("rebase", "cron_logs"))).resolves.toBeDefined();
        await db.exec(`DROP ROLE ${REBASE_USER_ROLE}`);
        await expect(revoke()).resolves.toBeDefined();
    });
});
