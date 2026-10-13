/**
 * E2E: `openRebase` opens a project's data from a script — reads and writes,
 * a user's view under row-level security, `close()` — and changes nothing in
 * the database by opening it.
 *
 * Opening a driver used to mean the server's boot in miniature: it created the
 * restricted role requests run as, the branch-metadata table, channel-history
 * tables and change-capture triggers, read `DATABASE_READ_URL` and `REALTIME_*`
 * from the environment, and could open a `LISTEN` connection. A REPL pointed at
 * a production database had no business doing any of that.
 *
 * Imported from the package entry, the way a script would.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";

const notesCollection: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
        { name: "owner_update", operation: "update", ownerField: "ownerId" },
        { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        title: { name: "Title", type: "string" }
    }
};

/** Connections from openRebase's own pool carry this name, so they can be counted. */
const APP_NAME = "open-rebase-e2e";

/** Everything opening could have created: tables, roles, functions, triggers, schemas. */
async function catalogue(client: pg.Client): Promise<Record<string, string[]>> {
    const list = async (query: string) => (await client.query<{ name: string }>(query)).rows.map(r => r.name).sort();
    return {
        tables: await list("SELECT schemaname || '.' || tablename AS name FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"),
        roles: await list("SELECT rolname AS name FROM pg_roles"),
        schemas: await list("SELECT nspname AS name FROM pg_namespace"),
        functions: await list("SELECT n.nspname || '.' || p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')"),
        triggers: await list("SELECT tgrelid::regclass::text || '.' || tgname AS name FROM pg_trigger WHERE NOT tgisinternal")
    };
}

async function connectionsFromOpenRebase(client: pg.Client): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1", [APP_NAME]
    );
    return rows[0].n;
}

/** The connection string for database `name` in the container, tagged with {@link APP_NAME}. */
function urlFor(container: PgContainer, name: string, appName?: string): string {
    const url = new URL(container.connectionString);
    url.pathname = `/${name}`;
    if (appName) url.searchParams.set("application_name", appName);
    return url.toString();
}

describe("openRebase (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    const quiet: Array<{ mockRestore(): void }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined)
        );
        const setup = new pg.Client({ connectionString: container.connectionString });
        await setup.connect();
        await setup.query("CREATE DATABASE untouched");
        await setup.query("CREATE DATABASE app");
        await setup.end();
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await observer?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    describe("on a database no server has booted on", () => {
        let client: pg.Client;

        beforeAll(async () => {
            client = new pg.Client({ connectionString: urlFor(container, "untouched") });
            await client.connect();
            // A table with row-level security on and no Rebase anything around it.
            await client.query("CREATE TABLE public.notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL, title text)");
            await client.query("ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY");
            await client.query("INSERT INTO public.notes (owner_id, title) VALUES ('ada', 'first')");
        });

        afterAll(async () => {
            await client?.end().catch(() => {});
        });

        it("creates nothing — no role, no schema, no function, no table, no trigger", async () => {
            const before = await catalogue(client);
            expect(before.roles).not.toContain("rebase_user");

            const rebase = await openRebase({ databaseUrl: urlFor(container, "untouched"), collections: [notesCollection] });
            try {
                expect(await rebase.sql("SELECT title FROM public.notes")).toEqual([{ title: "first" }]);
            } finally {
                await rebase.close();
            }

            expect(await catalogue(client)).toEqual(before);
        });

        it("reads no environment variable — a server's settings in the shell change nothing", async () => {
            // Each of these, read, would install capture triggers, dial a
            // replica that does not exist, or refuse to open over a number.
            vi.stubEnv("REALTIME_CDC", "trigger");
            vi.stubEnv("REALTIME_CHANNEL_BUS", "postgres");
            vi.stubEnv("DATABASE_READ_URL", "postgresql://nobody@127.0.0.1:1/nowhere");
            vi.stubEnv("REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET", "not-a-number");
            vi.stubEnv("REBASE_DB_POOL_MAX", "1");
            try {
                const before = await catalogue(client);
                const rebase = await openRebase({ databaseUrl: urlFor(container, "untouched"), collections: [notesCollection] });
                try {
                    expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes")).toEqual([{ n: 1 }]);
                } finally {
                    await rebase.close();
                }
                expect(await catalogue(client)).toEqual(before);
            } finally {
                vi.unstubAllEnvs();
            }
        });

        it("refuses a user's request rather than run it with no policy applied", async () => {
            // The connection is a superuser, which bypasses row-level security,
            // and the restricted role it would switch to was never created.
            const rebase = await openRebase({ databaseUrl: urlFor(container, "untouched"), collections: [notesCollection] });
            try {
                const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
                await expect(ada.data.notes.find()).rejects.toThrow();
                const bob = await rebase.withAuth({ uid: "bob", roles: ["user"] });
                await expect(bob.data.notes.find()).rejects.toThrow();
            } finally {
                await rebase.close();
            }
        });
    });

    describe("on a database a server has provisioned", () => {
        let rebase: OpenedRebase;
        let before: Record<string, string[]>;

        beforeAll(async () => {
            // What a server's boot does to a fresh database: tables, the RLS
            // runtime, policies and the restricted role.
            const url = urlFor(container, "app");
            const conn = createPostgresDatabaseConnection(url);
            try {
                const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
                const driverResult = await bootstrapper.initializeDriver({
                    collections: [notesCollection],
                    realtime: { subscribe: false, provision: false }
                });
                await bootstrapper.ensureCollectionSchema!([notesCollection], driverResult);
                await bootstrapper.ensureRlsRuntime!(driverResult);
                await bootstrapper.ensureCollectionPolicies!([notesCollection], driverResult);
                await bootstrapper.finalizeSecurityPosture!(driverResult);
            } finally {
                await conn.pool.end();
            }

            observer = new pg.Client({ connectionString: url });
            await observer.connect();
            before = await catalogue(observer);
            rebase = await openRebase({ databaseUrl: urlFor(container, "app", APP_NAME), collections: [notesCollection] });
        }, 120_000);

        afterAll(async () => {
            await rebase?.close();
        });

        it("writes and reads through dataAsAdmin, and runs SQL with params", async () => {
            const ada = await rebase.dataAsAdmin.notes.create({ ownerId: "ada", title: "ada's" });
            await rebase.dataAsAdmin.notes.create({ ownerId: "bob", title: "bob's" });
            expect(ada).toMatchObject({ ownerId: "ada", title: "ada's" });

            const all = await rebase.dataAsAdmin.notes.find();
            expect(all.data.map(row => row.title).sort()).toEqual(["ada's", "bob's"]);

            expect(await rebase.sql("SELECT title FROM public.notes WHERE owner_id = $1", { params: ["bob"] }))
                .toEqual([{ title: "bob's" }]);
        });

        it("withAuth sees and writes only what the user's policies allow", async () => {
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            const mine = await ada.data.notes.find();
            expect(mine.data.map(row => row.title)).toEqual(["ada's"]);

            await expect(ada.data.notes.create({ ownerId: "bob", title: "forged" })).rejects.toThrow();
            expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes WHERE title = 'forged'"))
                .toEqual([{ n: 0 }]);
        });

        it("has created nothing in the database by opening it", async () => {
            expect(await catalogue(observer)).toEqual(before);
        });

        it("close() releases the pool", async () => {
            expect(await connectionsFromOpenRebase(observer)).toBeGreaterThan(0);
            await rebase.close();
            await rebase.close();

            let left = await connectionsFromOpenRebase(observer);
            for (let attempt = 0; left > 0 && attempt < 50; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                left = await connectionsFromOpenRebase(observer);
            }
            expect(left).toBe(0);
            await expect(rebase.dataAsAdmin.notes.find()).rejects.toThrow();
        });
    });
});
