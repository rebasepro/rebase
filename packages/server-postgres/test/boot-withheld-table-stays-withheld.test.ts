/**
 * A table boot could not lock stays out of the user role's reach to the end
 * of the boot.
 *
 * When `ENABLE ROW LEVEL SECURITY` fails — a table the connection role does
 * not own, say — the policies step takes `rebase_user`'s privileges on it back,
 * so the table is "unreachable rather than unprotected". Then
 * `finalizeSecurityPosture` ran `ensureAppRole`, whose schema-wide `GRANT …
 * ON ALL TABLES` handed them straight back: RLS off, DML granted, every
 * authenticated request reading and writing every row — the one state the
 * policies step exists to prevent, reported in the log as closed.
 *
 * Real Postgres semantics on PGlite: the connection role `app` does not own
 * `customers` (it holds ALL WITH GRANT OPTION from its owner), so the ENABLE
 * genuinely fails and the revoke genuinely succeeds. The boot's order is
 * replayed: the driver's grant, the policies step, the final posture check.
 */
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";
import { ensureAppRole } from "../src/security/rls-enforcement";

const tiers = {
    name: "Tiers", slug: "tiers", table: "tiers", schema: "public",
    properties: { id: { name: "ID", type: "string", isId: true }, label: { name: "L", type: "string" } },
    securityRules: [{ operation: "select", access: "public" }]
} as unknown as CollectionConfig;

const customers = {
    name: "Customers", slug: "customers", table: "customers", schema: "public",
    properties: { id: { name: "ID", type: "string", isId: true }, name: { name: "N", type: "string" } },
    securityRules: [{ operation: "select", roles: ["admin"] }]
} as unknown as CollectionConfig;

const collections = [tiers, customers];

/** The drizzle surface the bootstrapper uses, over one PGlite session. */
function drizzleOver(pg: PGlite) {
    const dialect = new PgDialect();
    const execute = async (query: SQL) => {
        const { sql: text, params } = dialect.sqlToQuery(query);
        return { rows: (await pg.query(text, params)).rows };
    };
    return {
        execute,
        transaction: async <T>(fn: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> => {
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

describe("boot keeps a table it could not lock withheld from the user role", () => {
    let pg: PGlite;

    beforeEach(async () => {
        pg = new PGlite();
        await pg.waitReady;
        await pg.exec(`
            CREATE ROLE app NOLOGIN;
            CREATE ROLE other NOLOGIN;
            CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
            GRANT rebase_user TO app;
            ALTER SCHEMA public OWNER TO app;
            CREATE SCHEMA rebase AUTHORIZATION app;
            DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO app', current_database()); END $$;
            CREATE TABLE public.customers (id text PRIMARY KEY, name text);
            ALTER TABLE public.customers OWNER TO other;
            GRANT ALL ON public.customers TO app WITH GRANT OPTION;
            SET ROLE app;
            CREATE TABLE public.tiers (id text PRIMARY KEY, label text);
        `);
    });

    afterEach(async () => {
        await pg.close();
    });

    const reach = async (table: string): Promise<{ rls: boolean; select: boolean }> => {
        const { rows } = await pg.query<{ rls: boolean; select: boolean }>(
            `SELECT c.relrowsecurity AS rls, has_table_privilege('rebase_user', c.oid, 'SELECT') AS select
               FROM pg_class c WHERE c.oid = 'public.${table}'::regclass`
        );
        return rows[0];
    };

    it("does not hand the privileges back in the final schema-wide grant", async () => {
        const db = drizzleOver(pg);
        const bootstrapper = createPostgresBootstrapper({ connection: db } as never);
        const driverResult = {
            internals: {
                db,
                driver: { rlsUserRole: "rebase_user" },
                realtimeService: { rlsUserRole: "rebase_user" },
                registry: { getCollections: () => collections }
            }
        } as never;
        const runSql = async (text: string) => (await pg.query<Record<string, unknown>>(text)).rows;

        // initializeDriver: the role, and DML on every table in the schema.
        await ensureAppRole(runSql, ["public", "rebase"]);
        expect(await reach("customers")).toEqual({ rls: false, select: true });

        // The policies step: `customers` cannot be locked, so it is closed.
        await bootstrapper.ensureCollectionPolicies!(collections, driverResult);
        expect(await reach("customers")).toEqual({ rls: false, select: false });
        expect(await reach("tiers")).toEqual({ rls: true, select: true });

        // The final posture check re-grants on the schema — but not on it.
        await bootstrapper.finalizeSecurityPosture!(driverResult);
        expect(await reach("customers")).toEqual({ rls: false, select: false });
        expect(await reach("tiers")).toEqual({ rls: true, select: true });
    });
});
