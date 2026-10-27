/**
 * `rebase.sql(q, { database: analytics })` runs on the analytics data source.
 *
 * The documented example (docs/backend/multiple-sources.md) declares
 * `database("analytics")`, bound to its own server through
 * `DATABASE_URL__ANALYTICS`, and queries it with
 * `rebase.sql("select count(*) from page_views", { database: analytics })`.
 * The key used to be handed to the DEFAULT source's admin as a Postgres
 * database name, which opened `<default host>/analytics`: "database does not
 * exist" where the source lives elsewhere, and the default database, silently,
 * wherever the name resolved anyway. `rebase.dataAsAdmin` always routed by
 * source; `sql` now does too.
 *
 * Each source here is a PGlite database of its own behind a stand-in driver.
 * The default one's admin answers a `database` option the way the Postgres
 * driver does — a database of that name on the same server — and that server
 * has no `analytics` database, as a real one would not.
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";
import { database as declareDatabase } from "@rebasepro/types";
import { createRebaseBackend, type RebaseBackend } from "@rebasepro/server";

async function whoamiDb(name: string): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN`);
    await db.exec("CREATE TABLE whoami (name text)");
    await db.query("INSERT INTO whoami (name) VALUES ($1)", [name]);
    return db;
}

/** A driver whose SQL admin is `db`; a `database` option is a database on the same server, as in the Postgres driver. */
function driverFor(db: PGlite, sameServer: Record<string, PGlite>): DataDriver {
    const executeSql = async (text: string, options?: { database?: string; params?: unknown[] }) => {
        const target = options?.database === undefined ? db : sameServer[options.database];
        if (!target) throw new Error(`database "${options?.database}" does not exist`);
        return (await target.query<Record<string, unknown>>(text, options?.params)).rows;
    };
    const scoped = {
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 0,
        admin: { executeSql }
    };
    return { ...scoped, withAuth: async () => scoped as unknown as DataDriver } as unknown as DataDriver;
}

function bootstrapper(id: string, isDefault: boolean, driver: DataDriver): BackendBootstrapper {
    const repo = {
        getUserRoleIds: async () => [],
        getUserById: async () => null,
        getAccountAccessState: async () => null,
        getUserByEmail: async () => null
    };
    return {
        type: "postgres",
        id,
        isDefault,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: {} } as unknown as InitializedDriver;
        },
        ...(isDefault ? { async initializeAuth() { return { userService: repo, authRepository: repo }; } } : {}),
        async ensureCollectionSchema() { return { applied: 0 }; },
        async ensureCollectionPolicies() { return { applied: 0 }; },
        getAdmin: () => (driver as unknown as { admin: unknown }).admin
    } as unknown as BackendBootstrapper;
}

const collection = (slug: string, dataSource?: string): CollectionConfig => ({
    name: slug,
    slug,
    table: slug,
    ...(dataSource ? { dataSource } : {}),
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
}) as unknown as CollectionConfig;

const analytics = declareDatabase("analytics");
const main = declareDatabase();

let mainDb: PGlite;
let analyticsDb: PGlite;
let backend: RebaseBackend;

beforeAll(async () => {
    mainDb = await whoamiDb("main");
    analyticsDb = await whoamiDb("analytics");
    // The default server holds the default database and nothing called
    // `analytics`: that source is a server of its own.
    const mainDriver = driverFor(mainDb, {});
    const analyticsDriver = driverFor(analyticsDb, {});
    backend = await createRebaseBackend({
        collections: [collection("posts"), collection("page_views", "analytics")],
        bootstrappers: [
            bootstrapper("(default)", true, mainDriver),
            bootstrapper("analytics", false, analyticsDriver)
        ],
        auth: { jwtSecret: "sql-data-source-secret-0123456789abcdef-0123" },
        cronPersistence: false,
        provision: true
    });
});

afterAll(async () => {
    await backend?.shutdown(0);
    await mainDb?.close();
    await analyticsDb?.close();
});

describe("rebase.sql({ database }) reaches the data source it names", () => {
    it("by handle — the documented example", async () => {
        const rows = await backend.rebase.sql("select name from whoami", { database: analytics });
        expect(rows).toEqual([{ name: "analytics" }]);
    });

    it("by key", async () => {
        const rows = await backend.rebase.sql("select name from whoami", { database: "analytics" });
        expect(rows).toEqual([{ name: "analytics" }]);
    });

    it("with params", async () => {
        const rows = await backend.rebase.sql("select name from whoami where name = $1", { database: analytics, params: ["analytics"] });
        expect(rows).toEqual([{ name: "analytics" }]);
    });

    it("the default handle, and no option at all, reach the default source", async () => {
        expect(await backend.rebase.sql("select name from whoami", { database: main })).toEqual([{ name: "main" }]);
        expect(await backend.rebase.sql("select name from whoami")).toEqual([{ name: "main" }]);
    });

    it("refuses a key that is no configured source, by name", async () => {
        await expect(backend.rebase.sql("select 1", { database: "warehouse" }))
            .rejects.toThrow(/no data source "warehouse" is configured on this backend/);
    });
});
