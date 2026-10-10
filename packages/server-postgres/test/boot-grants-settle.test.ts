/**
 * The user role's grants are made once, and only where missing.
 *
 * The grant tier ran in full twice per boot — at connect, and again in the
 * final posture check: `GRANT … ON ALL TABLES IN SCHEMA` rewrites every
 * table's `pg_class` row whether or not the ACL changes, which invalidates every
 * table's cached plans on every connection, then `ALTER DEFAULT PRIVILEGES`
 * and a 23-statement internal-table `REVOKE` sweep per schema. It now reads the
 * catalogue and issues only what would change something; these pin both
 * halves — nothing on a settled database, the old statements wherever
 * something is missing, and the same ACLs either way.
 */
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { ensureAppRole, ensureAppRoleGrants } from "../src/security/rls-enforcement";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";

/** Statements that write the catalogue (or take a lock to). */
const WRITES = /^\s*(GRANT|REVOKE|ALTER|CREATE OR REPLACE|DO\b|BEGIN|DROP|CREATE (UNIQUE )?INDEX)/i;

/** A role-owned database: `app` connects and owns the schemas, `rebase_user` serves requests. */
async function database(): Promise<PGlite> {
    const pg = new PGlite();
    await pg.waitReady;
    await pg.exec(`
        CREATE ROLE app NOLOGIN;
        CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
        GRANT rebase_user TO app;
        ALTER SCHEMA public OWNER TO app;
        CREATE SCHEMA rebase AUTHORIZATION app;
        SET ROLE app;
        CREATE TABLE public.tiers (id text PRIMARY KEY, label text);
        ALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;
        CREATE TABLE public.notes (id serial PRIMARY KEY, body text);
        ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
        CREATE TABLE rebase.refresh_tokens (id text PRIMARY KEY, token_hash text);
        CREATE TABLE rebase.jobs (id text PRIMARY KEY);
    `);
    return pg;
}

/** Every grant the tier makes, as the catalogue holds it — what must not change. */
async function grants(pg: PGlite): Promise<string[]> {
    const { rows } = await pg.query<{ x: string }>(`
        SELECT n.nspname || '.' || c.relname || ' ' || c.relkind::text || ' ' || coalesce(c.relacl::text, '-') AS x
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('public', 'rebase') AND c.relkind IN ('r', 'v', 'm', 'f', 'p', 'S')
        UNION ALL SELECT nspname || ' ' || coalesce(nspacl::text, '-') FROM pg_namespace WHERE nspname IN ('public', 'rebase')
        UNION ALL SELECT coalesce(defaclnamespace::regnamespace::text, '*') || ' ' || defaclobjtype::text || ' ' || defaclacl::text FROM pg_default_acl
        ORDER BY 1`);
    return rows.map(row => row.x);
}

/** The grant tier's statements, unconditional — what every boot ran before. */
async function grantEverything(pg: PGlite): Promise<void> {
    for (const s of ["public", "rebase"]) {
        await pg.exec(`
            GRANT USAGE ON SCHEMA "${s}" TO rebase_user;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${s}" TO rebase_user;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${s}" TO rebase_user;
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${s}" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rebase_user;
            ALTER DEFAULT PRIVILEGES IN SCHEMA "${s}" GRANT USAGE, SELECT ON SEQUENCES TO rebase_user;
        `);
        for (const table of ["refresh_tokens", "jobs"]) {
            const { rows } = await pg.query<{ rls: boolean }>(
                `SELECT relrowsecurity AS rls FROM pg_class WHERE oid = to_regclass('"${s}"."${table}"')`
            );
            if (rows[0] && !rows[0].rls) await pg.exec(`REVOKE ALL ON "${s}"."${table}" FROM rebase_user`);
        }
    }
}

const recorder = (pg: PGlite) => {
    const ran: string[] = [];
    const run = async (text: string) => {
        ran.push(text.trim());
        return (await pg.query<Record<string, unknown>>(text)).rows;
    };
    return { ran, run, writes: () => ran.filter(text => WRITES.test(text)) };
};

describe("the user role's grants", () => {
    let pg: PGlite;
    beforeEach(async () => { pg = await database(); });
    afterEach(async () => { await pg.close(); });

    it("are not re-issued when they already hold", async () => {
        const { ran, run, writes } = recorder(pg);
        await ensureAppRole(run, ["public", "rebase"]);
        expect(writes().length).toBeGreaterThan(0);
        const settled = await grants(pg);

        ran.length = 0;
        await ensureAppRole(run, ["public", "rebase"]);
        expect(writes()).toEqual([]);
        ran.length = 0;
        await ensureAppRoleGrants(run, ["public", "rebase"]);
        expect(writes()).toEqual([]);
        expect(ran).toHaveLength(1);
        expect(await grants(pg)).toEqual(settled);
    });

    it("end exactly where the unconditional statements end", async () => {
        const { run } = recorder(pg);
        await ensureAppRole(run, ["public", "rebase"]);
        const ours = await grants(pg);
        await grantEverything(pg);
        expect(await grants(pg)).toEqual(ours);
    });

    it("are issued again for a table that lost them, and the internal tables taken back", async () => {
        const { run, writes, ran } = recorder(pg);
        await ensureAppRole(run, ["public", "rebase"]);
        const settled = await grants(pg);

        // A table the policies step withheld on an earlier boot, and an
        // internal table someone granted by hand.
        await pg.exec("REVOKE ALL ON public.notes FROM rebase_user; GRANT SELECT ON rebase.jobs TO rebase_user;");
        ran.length = 0;
        await ensureAppRoleGrants(run, ["public", "rebase"]);
        expect(writes()).toEqual(expect.arrayContaining([
            expect.stringMatching(/^GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public"/),
            expect.stringMatching(/REVOKE ALL ON "rebase"\."jobs"/)
        ]));
        // Nothing in `rebase` but the one revoke.
        expect(writes().filter(text => /"rebase"/.test(text) && !/"rebase"\."jobs"/.test(text))).toEqual([]);
        expect(await grants(pg)).toEqual(settled);
    });

    it("cover a table another role created, which no default privilege reaches", async () => {
        const { run } = recorder(pg);
        await ensureAppRole(run, ["public", "rebase"]);
        await pg.exec("RESET ROLE; CREATE TABLE public.adopted (id int); ALTER TABLE public.adopted OWNER TO app; SET ROLE app;");
        await ensureAppRoleGrants(run, ["public", "rebase"]);
        const { rows } = await pg.query<{ ok: boolean }>(
            "SELECT has_table_privilege('rebase_user', 'public.adopted', 'SELECT,INSERT,UPDATE,DELETE') AS ok"
        );
        expect(rows[0].ok).toBe(true);
    });
});

/** The drizzle surface the bootstrapper uses, over one PGlite session, counting statements. */
function drizzleOver(pg: PGlite, ran: string[]) {
    const dialect = new PgDialect();
    const execute = async (query: SQL) => {
        const { sql: text, params } = dialect.sqlToQuery(query);
        ran.push(text.trim());
        return { rows: (await pg.query(text, params)).rows };
    };
    return {
        execute,
        transaction: async <T>(fn: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> => {
            ran.push("BEGIN");
            await pg.exec("BEGIN");
            try {
                const result = await fn({ execute });
                await pg.exec("COMMIT");
                return result;
            } catch (err) {
                await pg.exec("ROLLBACK");
                throw err;
            }
        }
    };
}

describe("the boot's final posture check", () => {
    it("reads the grants once and writes nothing when connect already made them", async () => {
        const pg = await database();
        try {
            const { run } = recorder(pg);
            await ensureAppRole(run, ["public", "rebase"]);
            const ran: string[] = [];
            const db = drizzleOver(pg, ran);
            const bootstrapper = createPostgresBootstrapper({ connection: db } as never);
            await bootstrapper.finalizeSecurityPosture!({
                internals: {
                    db,
                    driver: { rlsUserRole: "rebase_user" },
                    realtimeService: { rlsUserRole: "rebase_user" },
                    registry: { getCollections: () => [] }
                }
            } as never);
            expect(ran.filter(text => WRITES.test(text))).toEqual([]);
            expect(ran).toHaveLength(1);
        } finally {
            await pg.close();
        }
    });
});
