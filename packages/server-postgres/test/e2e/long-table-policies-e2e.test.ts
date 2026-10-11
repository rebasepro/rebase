/**
 * E2E: a collection whose table name is 50 bytes can be written by an admin.
 *
 * Postgres keeps the first 63 bytes of an identifier. The injected admin-write
 * rule compiles to `<table>_default_admin_write_{insert,update,delete}`, and
 * once the table is 42 bytes or more those three are one stored name: each
 * `CREATE POLICY` replaced the one before, only DELETE survived, and an admin's
 * INSERT and UPDATE were refused by RLS — while boot and push reported success.
 *
 * Two databases: one booted fresh, and one carrying the single truncated
 * policy an earlier release left behind, which the boot has to replace.
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
import type { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";

const TABLE = "a_fifty_byte_collection_table_name_for_rls_policie";

const collection: CollectionConfig = {
    name: "Long",
    slug: TABLE,
    table: TABLE,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

const drizzleTable = pgTable(TABLE, {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title")
});

/** The one policy a pre-fix boot left: all three CREATEs under one name, DELETE last. */
const LEGACY_SURVIVOR = `${TABLE}_default_admin_write_delete`.slice(0, 63);

interface Booted {
    observer: pg.Client;
    conn: ReturnType<typeof createPostgresDatabaseConnection>;
    driver: PostgresBackendDriver;
}

async function boot(url: string, beforePolicies?: (observer: pg.Client) => Promise<void>): Promise<Booted> {
    const observer = new pg.Client({ connectionString: url });
    await observer.connect();
    const conn = createPostgresDatabaseConnection(url);
    const quiet = [
        vi.spyOn(console, "log").mockImplementation(() => undefined),
        vi.spyOn(console, "info").mockImplementation(() => undefined),
        vi.spyOn(console, "warn").mockImplementation(() => undefined),
        vi.spyOn(console, "debug").mockImplementation(() => undefined)
    ];
    try {
        const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db as never });
        const driverResult = await bootstrapper.initializeDriver!({
            collections: [collection],
            dataSourceKey: "(default)",
            realtime: { subscribe: false, provision: false }
        });
        await bootstrapper.ensureCollectionSchema!([collection], driverResult);
        await bootstrapper.ensureRlsRuntime!(driverResult);
        await beforePolicies?.(observer);
        await bootstrapper.ensureCollectionPolicies!([collection], driverResult);
        await bootstrapper.finalizeSecurityPosture!(driverResult);
        const internals = driverResult.internals as { driver: PostgresBackendDriver; registry: PostgresCollectionRegistry };
        internals.registry.registerTable(drizzleTable, TABLE);
        return { observer, conn, driver: internals.driver };
    } finally {
        for (const spy of quiet) spy.mockRestore();
    }
}

async function policyNames(observer: pg.Client): Promise<{ name: string; cmd: string }[]> {
    const { rows } = await observer.query<{ name: string; cmd: string }>(
        "SELECT policyname AS name, cmd FROM pg_policies WHERE tablename = $1 ORDER BY cmd", [TABLE]);
    return rows;
}

async function adminWrites(booted: Booted): Promise<void> {
    const admin: DataDriver = await booted.driver.withAuth({ uid: "admin-1", roles: ["admin"] } as never);
    const created = await admin.save({ path: TABLE, values: { title: "inserted" }, collection, status: "new" });
    expect(created).toMatchObject({ title: "inserted" });
    const updated = await admin.save({
        path: TABLE, entityId: String(created.id), values: { title: "updated" }, collection, status: "existing"
    });
    expect(updated).toMatchObject({ title: "updated" });
}

describe("a 50-byte table name (E2E)", () => {
    let container: PgContainer;
    let fresh: Booted;
    let upgraded: Booted;

    beforeAll(async () => {
        container = await startPgContainer();
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query("CREATE DATABASE long_fresh");
        await admin.query("CREATE DATABASE long_upgraded");
        await admin.end();
        fresh = await boot(container.connectionString.replace("/rebase?", "/long_fresh?"));
        upgraded = await boot(container.connectionString.replace("/rebase?", "/long_upgraded?"), observer =>
            observer.query(`CREATE POLICY "${LEGACY_SURVIVOR}" ON "public"."${TABLE}" FOR DELETE USING (true)`)
                .then(() => undefined));
    }, 180_000);

    afterAll(async () => {
        for (const booted of [fresh, upgraded]) {
            await booted?.observer.end().catch(() => {});
            await booted?.conn.pool.end().catch(() => {});
        }
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("is long enough that the old write names collide (otherwise this proves nothing)", () => {
        expect(Buffer.byteLength(TABLE)).toBe(50);
        expect(new Set(["insert", "update", "delete"]
            .map(op => `${TABLE}_default_admin_write_${op}`.slice(0, 63))).size).toBe(1);
    });

    it("boots with a policy per operation", async () => {
        const cmds = (await policyNames(fresh.observer)).map(p => p.cmd).sort();
        expect(cmds).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    });

    it("lets an admin INSERT and UPDATE", async () => {
        await adminWrites(fresh);
    });

    it("replaces the truncated policy an earlier release left behind", async () => {
        const policies = await policyNames(upgraded.observer);
        expect(policies.map(p => p.cmd).sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
        // The legacy name now holds the read policy (its own name cuts to the
        // same 63 bytes), not the old `USING (true)` delete.
        expect(policies.find(p => p.name === LEGACY_SURVIVOR)?.cmd ?? "gone").not.toBe("DELETE");
        await adminWrites(upgraded);
    });
});
