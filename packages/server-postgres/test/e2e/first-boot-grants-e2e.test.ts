/**
 * E2E: on a database that starts EMPTY, the request role can use what the
 * first boot created — in that same process, without a restart.
 *
 * The connection role decides at connect time that requests run as
 * `rebase_user`, and grants it USAGE on the schemas it serves. On a fresh
 * database the `rebase` schema does not exist yet at that moment, so its grant
 * was skipped — and nothing granted it later: provisioning then created
 * `rebase` (the RLS helpers, the history table, `rebase.record_history`), and
 * the second look at the posture after provisioning returned early because the
 * switch was already configured. Every write to a `history: true` collection
 * failed with "permission denied for schema rebase" (answered as an RLS
 * problem), and so did every in-transaction job enqueue, until a restart found
 * the schema at connect time and granted it.
 *
 * Every other e2e suite reuses a database where `rebase` already exists, or
 * reboots first; this one boots once, from nothing, in the order `init.ts`
 * runs the bootstrapper's steps.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper } from "../../src/PostgresBootstrapper.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import type { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import type { HistoryService } from "../../src/history/HistoryService.js";
import type { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";

// What a project's generated schema hands the registry; the table itself is
// created by the boot's provisioning step below.
const ordersTable = pgTable("orders", {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title")
});

const ordersCollection: CollectionConfig = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    history: true,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

describe("first boot on an empty database (E2E)", () => {
    let container: PgContainer;
    let url: string;
    let conn: ReturnType<typeof createPostgresDatabaseConnection>;
    let observer: pg.Client;
    let driver: PostgresBackendDriver;
    let rebaseExistedAtConnect: boolean | undefined;

    beforeAll(async () => {
        container = await startPgContainer();
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query("CREATE DATABASE firstboot");
        await admin.end();
        url = container.connectionString.replace("/rebase?", "/firstboot?");

        observer = new pg.Client({ connectionString: url });
        await observer.connect();
        conn = createPostgresDatabaseConnection(url);

        const quiet = [
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined)
        ];
        try {
            const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db as never });
            const driverResult = await bootstrapper.initializeDriver!({
                collections: [ordersCollection],
                dataSourceKey: "(default)",
                realtime: { subscribe: false, provision: false }
            });
            rebaseExistedAtConnect = (await observer.query(
                "SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'rebase'"
            )).rows[0].n === 1;

            // The provisioning steps, in init.ts's order.
            await bootstrapper.ensureCollectionSchema!([ordersCollection], driverResult);
            await bootstrapper.ensureRlsRuntime!(driverResult);
            await bootstrapper.ensureCollectionPolicies!([ordersCollection], driverResult);
            await bootstrapper.finalizeSecurityPosture!(driverResult);
            const history = await bootstrapper.initializeHistory!(true, driverResult);

            const internals = driverResult.internals as { driver: PostgresBackendDriver; registry: PostgresCollectionRegistry };
            internals.registry.registerTable(ordersTable, "orders");
            driver = internals.driver;
            driver.historyService = history?.historyService as HistoryService;
        } finally {
            for (const spy of quiet) spy.mockRestore();
        }
    }, 180_000);

    afterAll(async () => {
        await observer?.end().catch(() => {});
        await conn?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("starts from a database with no rebase schema (otherwise this proves nothing)", () => {
        expect(rebaseExistedAtConnect).toBe(false);
        expect(driver.rlsUserRole).toBe("rebase_user");
    });

    it("grants the request role USAGE on the rebase schema the boot created", async () => {
        const { rows } = await observer.query(
            "SELECT has_schema_privilege('rebase_user', 'rebase', 'USAGE') AS usage"
        );
        expect(rows[0].usage).toBe(true);
    });

    it("lands a user's write to a history collection, with its entry, in the first process", async () => {
        const scoped: DataDriver = await driver.withAuth({
            // A signed-in admin: the policies the boot provisioned (the
            // default ones, for a collection that declares no rules) admit it,
            // so whatever refuses the write is not a policy.
            uid: "user-1",
            roles: ["admin"]
        } as never);
        const saved = await scoped.save({
            path: "orders",
            values: { title: "first order" },
            collection: ordersCollection,
            status: "new"
        });
        expect(saved).toMatchObject({ title: "first order" });

        const { rows } = await observer.query(
            "SELECT action FROM rebase.entity_history WHERE table_name = 'orders'"
        );
        expect(rows.map(r => r.action)).toEqual(["create"]);
    });
});
