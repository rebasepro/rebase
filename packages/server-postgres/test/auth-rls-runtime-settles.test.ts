/**
 * Auth's ensure on a settled database re-creates and revokes nothing.
 *
 * It re-created the four RLS helper functions on every boot — `CREATE OR
 * REPLACE` rewrites `pg_proc` and invalidates every cached plan a policy
 * inlined them into, on every connection — and swept a `REVOKE` over every
 * internal table name. Both now read the catalogue first: a function that
 * drifted, or a table that regained a privilege, is still repaired.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { rlsRuntimeIsCurrent } from "../src/schema/rls-bootstrap-sql";

describe("auth's ensure on a settled database", () => {
    let pglite: PGlite;
    let statements: string[];
    let db: NodePgDatabase;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        await pglite.exec("CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;");
        statements = [];
        db = drizzle(pglite, { logger: { logQuery: (query: string) => { statements.push(query.trim()); } } }) as unknown as NodePgDatabase;
    });

    afterEach(async () => {
        await pglite.close();
    });

    const functionsReplaced = () => statements.filter(s => /^CREATE OR REPLACE FUNCTION/i.test(s));
    const revokes = () => statements.filter(s => /REVOKE ALL ON/i.test(s));

    it("re-creates no helper function and revokes nothing already revoked", async () => {
        // As a boot runs it: role grants first, then auth creates its tables
        // (which the default privileges hand to the user role) and takes them back.
        await pglite.exec(`
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rebase_user;
            CREATE SCHEMA IF NOT EXISTS rebase;
            ALTER DEFAULT PRIVILEGES IN SCHEMA rebase GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rebase_user;
        `);
        await ensureAuthTablesExist(db);
        expect(functionsReplaced()).toHaveLength(4);
        expect(revokes().length).toBeGreaterThan(0);
        // Every auth table but `users`, which is a collection: its RLS and
        // policies arrive with the policies step, not here.
        const { rows: reachable } = await pglite.query<{ name: string }>(
            "SELECT c.relname AS name FROM pg_class c WHERE c.relnamespace = 'rebase'::regnamespace AND c.relkind = 'r' " +
            "AND has_table_privilege('rebase_user', c.oid, 'SELECT') AND NOT c.relrowsecurity"
        );
        expect(reachable.map(row => row.name)).toEqual(["users"]);

        statements.length = 0;
        await ensureAuthTablesExist(db);
        expect(functionsReplaced()).toEqual([]);
        expect(revokes()).toEqual([]);
        expect(statements.filter(s => /^(BEGIN|DO)\b/i.test(s))).toEqual([]);
    });

    it("re-creates a helper function that was altered, and takes back a privilege granted by hand", async () => {
        await ensureAuthTablesExist(db);
        await pglite.exec(`
            CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$ SELECT 'admin' $$ LANGUAGE sql STABLE;
            ALTER FUNCTION rebase.uid() VOLATILE;
            GRANT SELECT ON rebase.refresh_tokens TO rebase_user;
        `);
        expect(await rlsRuntimeIsCurrent(async text => (await pglite.query<Record<string, unknown>>(text)).rows)).toBe(false);

        statements.length = 0;
        await ensureAuthTablesExist(db);
        expect(functionsReplaced()).toHaveLength(4);
        expect(revokes()).toEqual([expect.stringMatching(/REVOKE ALL ON "rebase"\."refresh_tokens"/)]);
        expect(await rlsRuntimeIsCurrent(async text => (await pglite.query<Record<string, unknown>>(text)).rows)).toBe(true);
        const { rows } = await pglite.query<{ ok: boolean }>(
            "SELECT has_table_privilege('rebase_user', 'rebase.refresh_tokens', 'SELECT') AS ok"
        );
        expect(rows[0].ok).toBe(false);
    });
});
