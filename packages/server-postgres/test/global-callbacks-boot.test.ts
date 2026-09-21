/**
 * Global callbacks run on a booted Postgres server.
 *
 * `initializeRebaseBackend({ callbacks })` stored them on the backend's own
 * collection registry, and `PostgresBootstrapper.initializeDriver` builds a
 * registry of its own for the driver — which is where the driver looks for
 * global callbacks. So a global `afterRead` masking a field across every
 * collection was accepted and documented, and the field went out unmasked.
 *
 * The driver's own tests mock `getGlobalCallbacks` on the registry they hand
 * it, which is exactly the step boot skipped. This boots the backend over a
 * real `PostgresBackendDriver` on PGlite, returned the way the bootstrapper
 * returns it — with its own registry — and reads through it.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionCallbacks, CollectionConfig, InitializedDriver } from "@rebasepro/types";
import { initializeRebaseBackend, _resetRebaseMock } from "@rebasepro/server";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const notesTable = pgTable("notes", {
    id: varchar("id").primaryKey(),
    body: varchar("body"),
    tenant: varchar("tenant")
});

function notes(): CollectionConfig {
    return {
        name: "Notes",
        slug: "notes",
        table: "notes",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            body: { name: "Body", type: "string" },
            tenant: { name: "Tenant", type: "string" }
        }
    } as unknown as CollectionConfig;
}

let db: PGlite;

/** A driver over PGlite, returned with its own registry, as the bootstrapper returns one. */
function bootstrapperOver(pglite: PGlite): { bootstrapper: BackendBootstrapper; driver: PostgresBackendDriver } {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([notes()]);
    registry.registerTable(notesTable, "notes");
    const orm = drizzle(pglite) as never;
    const driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    const bootstrapper = {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collectionRegistry: registry, internals: { driver } } as unknown as InitializedDriver;
        }
    } as unknown as BackendBootstrapper;
    return { bootstrapper, driver };
}

async function boot(callbacks: CollectionCallbacks): Promise<PostgresBackendDriver> {
    const { bootstrapper, driver } = bootstrapperOver(db);
    await initializeRebaseBackend({
        app: new Hono() as never,
        server: {} as never,
        collections: [notes()],
        bootstrappers: [bootstrapper],
        callbacks
    } as never);
    return driver;
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(async () => {
    process.env.NODE_ENV = "test";
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE notes (id varchar PRIMARY KEY, body varchar, tenant varchar);
        INSERT INTO notes VALUES ('n1', 'secret one', 'a'), ('n2', 'secret two', 'b');
    `);
});

afterEach(async () => {
    _resetRebaseMock();
    process.env.NODE_ENV = originalNodeEnv;
    await db.close();
});

describe("global callbacks on a booted Postgres server", () => {
    it("run a global `afterRead` on the rows a read returns", async () => {
        const driver = await boot({
            afterRead: ({ row }) => ({ ...row, body: "[masked]" })
        });

        const rows = await driver.fetchCollection({ path: "notes" });

        expect(rows.map(r => r.body)).toEqual(["[masked]", "[masked]"]);
    });

    it("narrow every read with a global `beforeQuery`", async () => {
        const driver = await boot({
            beforeQuery: () => ({ filter: { tenant: ["==", "a"] } })
        });

        const rows = await driver.fetchCollection({ path: "notes" });

        expect(rows.map(r => r.id)).toEqual(["n1"]);
        expect(await driver.count({ path: "notes" })).toBe(1);
    });
});
