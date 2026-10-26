/**
 * E2E: `rebase.sql(q, { database: analytics })` runs on the analytics data
 * source — the example docs/backend/multiple-sources.md gives — and
 * `openRebase(…).sql` refuses a source it did not open.
 *
 * `database("analytics")` is bound by `DATABASE_URL__ANALYTICS` to whatever
 * that variable names: here a database called `warehouse`, as it would be on a
 * warehouse server. The key used to be passed to the default source's admin as
 * a Postgres database NAME, which opened `<default host>/analytics` — a
 * database that does not exist — and failed, or, where one by that name did,
 * read it instead of the source.
 *
 * The real boot with two real Postgres data sources. Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";
import { database } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { openRebase, type OpenedRebase } from "../../src/index.js";
import { createRebaseBackend, _resetRebaseMock, type RebaseBackend } from "../../../server/src/index.js";
import { adapterToBootstrapper } from "../../../server/src/boot/driver.js";

const analytics = database("analytics");

const posts: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
};

const pageViews: CollectionConfig = {
    name: "Page views",
    slug: "page_views",
    table: "page_views",
    dataSource: "analytics",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
};

function urlFor(base: string, db: string): string {
    const url = new URL(base);
    url.pathname = `/${db}`;
    return url.toString();
}

describe("rebase.sql({ database }) on two real data sources (E2E)", () => {
    let container: PgContainer;
    let backend: RebaseBackend | undefined;
    let script: OpenedRebase | undefined;
    const connections: Array<ReturnType<typeof createPostgresDatabaseConnection>> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query("CREATE DATABASE app");
        await admin.query("CREATE DATABASE warehouse");
        await admin.end();
        for (const name of ["app", "warehouse"]) {
            const client = new pg.Client({ connectionString: urlFor(container.connectionString, name) });
            await client.connect();
            await client.query("CREATE TABLE whoami (name text)");
            await client.query("INSERT INTO whoami (name) VALUES ($1)", [name]);
            await client.end();
        }

        // What the boot builds from config/resources.ts: one adapter per source,
        // each with its own connection, keyed by the declaration.
        const source = (db: string, key: string, isDefault: boolean) => {
            const url = urlFor(container.connectionString, db);
            const connection = createPostgresDatabaseConnection(url);
            connections.push(connection);
            return adapterToBootstrapper(
                createPostgresAdapter({ connection: connection.db, connectionString: url, adminConnectionString: url }),
                key,
                isDefault
            );
        };
        backend = await createRebaseBackend({
            collections: [posts, pageViews],
            bootstrappers: [source("app", "(default)", true), source("warehouse", "analytics", false)],
            auth: { jwtSecret: "sql-data-source-e2e-secret-long-enough-0123456789" },
            cronPersistence: false,
            provision: true
        });

        script = await openRebase({
            databaseUrl: urlFor(container.connectionString, "warehouse"),
            collections: [pageViews],
            dataSourceKey: "analytics"
        });
    }, 180_000);

    afterAll(async () => {
        await script?.close().catch(() => {});
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        for (const connection of connections) await connection.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("the documented example reads the analytics source", async () => {
        expect(await backend!.rebase.sql("select name from whoami", { database: analytics })).toEqual([{ name: "warehouse" }]);
    });

    it("no option reads the default source", async () => {
        expect(await backend!.rebase.sql("select name from whoami")).toEqual([{ name: "app" }]);
    });

    it("a key no source has is refused by name", async () => {
        await expect(backend!.rebase.sql("select 1", { database: "warehouse" }))
            .rejects.toThrow(/no data source "warehouse" is configured on this backend/);
    });

    it("openRebase runs SQL on the source it opened, and refuses any other", async () => {
        expect(await script!.sql("select name from whoami", { database: analytics })).toEqual([{ name: "warehouse" }]);
        expect(await script!.sql("select name from whoami")).toEqual([{ name: "warehouse" }]);
        await expect(script!.sql("select name from whoami", { database: "app" }))
            .rejects.toThrow(/opened the "analytics" data source only/);
    });
});
