/**
 * A project with two databases, booted the way a backend boots.
 *
 * The end-to-end claim behind `database("analytics")`: the second database is
 * served by the development daemon, bound by its suffixed variable, and gets
 * its OWN tables and policies — the collection routed to it lives there and
 * only there, and reads through the routed data plane reach it.
 *
 * Provisioning used to filter collections by engine, so `events` (routed to
 * `analytics`, also Postgres) was created in the DEFAULT database and the
 * analytics database stayed empty; every query routed there then failed on a
 * missing relation behind a boot that reported the schema up to date. Both
 * halves of that are asserted here: the table is in the second database, and
 * it is not in the first.
 *
 * Against PGlite rather than a Postgres container, because that is what
 * `rebase dev` serves and the only Postgres this suite can rely on; the
 * managed daemon runs the same DDL a server does.
 */
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { database, resetDeclaredResources, declaredDataSources, resourceEnvSuffix, type CollectionConfig } from "@rebasepro/types";
import { ensureManagedDatabase, stopManagedDatabase } from "./daemon";
import { MANAGED_POOL_MAX } from "./constraints";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);
const CLI_ENTRY = path.join(HERE, "__fixtures__", "cli-entry.ts");
const BOOT_TIMEOUT = 180_000;

let root: string;
const pools: pg.Pool[] = [];
let shutdown: (() => Promise<void>) | undefined;

/**
 * One pool per database, one connection each. The daemon admits four sockets
 * per instance, and a booted backend already holds a pool client and a
 * LISTEN client on each — a fresh pool per query would run the instance out
 * of sockets and read as "connection terminated".
 */
const poolsByUrl = new Map<string, pg.Pool>();
function connect(url: string): pg.Pool {
    let pool = poolsByUrl.get(url);
    if (!pool) {
        pool = new pg.Pool({ connectionString: url, max: 1 });
        poolsByUrl.set(url, pool);
        pools.push(pool);
    }
    return pool;
}

const collection = (slug: string, dataSource?: string): CollectionConfig => ({
    name: slug,
    slug,
    table: slug,
    schema: "public",
    ...(dataSource ? { dataSource } : {}),
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" }
    },
    securityRules: [{ operation: "all", access: "public" }]
} as unknown as CollectionConfig);

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-two-dbs-")));
    resetDeclaredResources();
});

afterEach(async () => {
    await shutdown?.().catch(() => {});
    shutdown = undefined;
    poolsByUrl.clear();
    await Promise.all(pools.splice(0).map(p => p.end().catch(() => {})));
    await stopManagedDatabase(root).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
    resetDeclaredResources();
}, BOOT_TIMEOUT);

describe("two declared databases", () => {
    it("provisions each collection in the database it is routed to, and serves it from there", { timeout: BOOT_TIMEOUT }, async () => {
        database();
        database("analytics");

        const managed = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true, additionalKeys: ["analytics"] });
        const env = {
            DATABASE_URL: managed.url,
            [`DATABASE_URL${resourceEnvSuffix("analytics")}`]: managed.additional.analytics,
            REBASE_DB_POOL_MAX: String(MANAGED_POOL_MAX),
            JWT_SECRET: "two-databases-test-secret-that-is-long-enough-0123456789"
        };
        expect(env.DATABASE_URL__ANALYTICS).toBeDefined();
        expect(env.DATABASE_URL__ANALYTICS).not.toBe(env.DATABASE_URL);

        const server = await import("@rebasepro/server");
        // Hono is the server's dependency, not this package's; resolved from
        // the server so the test uses the copy the backend itself mounts on.
        const requireFromServer = createRequire(requireFromHere.resolve("@rebasepro/server"));
        const { Hono } = await import(pathToFileURL(requireFromServer.resolve("hono")).href) as { Hono: new () => unknown };
        const resolved = server.resolveDataSources(env, declaredDataSources());
        expect(resolved.map(r => r.key).sort()).toEqual(["(default)", "analytics"]);
        // Resolved from this package, which depends on the driver — the
        // server's own directory does not.
        const sources = await server.initializeDataSources(resolved, undefined, [HERE]);

        const backend = await server.initializeRebaseBackend({
            app: new Hono() as never,
            // Never listened on: the websocket layer attaches to it at boot.
            server: http.createServer() as never,
            collections: [collection("posts"), collection("events", "analytics")],
            bootstrappers: sources.map(s => s.bootstrapper),
            auth: { jwtSecret: env.JWT_SECRET },
            cronPersistence: false,
            logging: { level: "error" }
        } as never);
        shutdown = async () => {
            await (backend as { shutdown?: (ms?: number) => Promise<void> }).shutdown?.(2_000);
            await Promise.allSettled(sources.map(s => s.connection.pool?.end()));
        };

        // The table is where the routing says, and only there.
        const tablesIn = async (url: string) => {
            const { rows } = await connect(url).query<{ tablename: string }>(
                "select tablename from pg_tables where schemaname = 'public' and tablename in ('posts', 'events') order by 1"
            );
            return rows.map(r => r.tablename);
        };
        expect(await tablesIn(env.DATABASE_URL)).toEqual(["posts"]);
        expect(await tablesIn(env.DATABASE_URL__ANALYTICS!)).toEqual(["events"]);

        // Policies and the helper functions they call exist on the second
        // database too — a table with RLS on and no working policy answers
        // nothing, which is the state this used to boot into.
        const { rows: helpers } = await connect(env.DATABASE_URL__ANALYTICS!).query<{ n: string }>(
            "select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'rebase' and p.proname = 'uid'"
        );
        expect(helpers[0].n).toBe("1");
        const { rows: policies } = await connect(env.DATABASE_URL__ANALYTICS!).query<{ n: string }>(
            "select count(*)::text as n from pg_policies where tablename = 'events'"
        );
        expect(Number(policies[0].n)).toBeGreaterThan(0);

        // And the routed data plane writes and reads there.
        const data = server.rebase.dataAsAdmin as unknown as {
            collection(slug: string): { create(v: unknown): Promise<unknown>; find(q?: unknown): Promise<{ data: { title?: string }[] }> };
        };
        await data.collection("events").create({ title: "boot" });
        const found = await data.collection("events").find({});
        expect(found.data.map(r => r.title)).toEqual(["boot"]);
        const { rows: stored } = await connect(env.DATABASE_URL__ANALYTICS!).query<{ title: string }>("select title from events");
        expect(stored.map(r => r.title)).toEqual(["boot"]);
        const { rows: notHere } = await connect(env.DATABASE_URL).query<{ n: string }>(
            "select count(*)::text as n from pg_tables where tablename = 'events'"
        );
        expect(notHere[0].n).toBe("0");
    });
});
