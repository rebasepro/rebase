/**
 * E2E: this driver's half of the `DataDriver.delete` contract.
 *
 * The rule is stated on the interface and checked by a kit both server drivers
 * run — see `packages/server/test/contract/delete-contract.ts` for why it lives
 * there rather than in either driver's suite. The short version: Mongo asserted
 * "should not throw for non-existent entity" and Postgres asserted a 404 for
 * the same call, both suites passed forever, and each described its own
 * driver's habit rather than the contract.
 *
 * Against a real database rather than a mock, because the answer this pins
 * comes from `rowCount` — the one thing a mocked query builder is free to
 * invent.
 *
 * Requires Docker.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { assertDeleteContract } from "../../../server/test/contract/delete-contract";

const notesTable = pgTable("notes", {
    id: varchar("id").primaryKey(),
    body: varchar("body")
});

const notesCollection: CollectionConfig = {
    name: "Notes", slug: "notes", table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        body: { name: "Body", type: "string" }
    }
} as unknown as CollectionConfig;

describe("DataDriver.delete contract (Postgres, E2E)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;

    beforeAll(async () => {
        container = await startPgContainer();

        const admin = new pg.Client({ connectionString: container.connectionString });
        for (let i = 0; ; i++) {
            try {
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        await admin.query(`CREATE TABLE public.notes (id VARCHAR(255) PRIMARY KEY, body VARCHAR(255));`);
        await admin.end();

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([notesCollection]);
        registry.registerTable(notesTable, "notes");
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
    }, 120_000);

    afterAll(async () => {
        if (pool) await pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("resolves for a row it removed and rejects for one that was not there", async () => {
        let seq = 0;
        await assertDeleteContract(
            {
                path: "notes",
                create: async () => {
                    const id = `n-${++seq}`;
                    // The id travels inside `values`. A top-level `id` means
                    // "update the row with this id", which on an empty table is
                    // a 404 from the very guard this file is here to check.
                    await driver.save({
                        path: "notes", collection: notesCollection,
                        values: { id, body: "contract" }
                    } as never);
                    return id;
                },
                delete: (id) => driver.delete({
                    row: { id, path: "notes", values: {} },
                    collection: notesCollection
                } as never),
                exists: async (id) =>
                    (await driver.fetchOne({ path: "notes", id, collection: notesCollection } as never)) != null,
                // Any string the key column accepts and no row holds.
                missingId: () => "n-does-not-exist"
            },
            {
                rejectsNotFound: async (promise, id) => {
                    await expect(promise).rejects.toMatchObject({
                        statusCode: 404,
                        message: expect.stringContaining(`"${id}"`)
                    });
                }
            }
        );
    });
});
