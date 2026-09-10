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
import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
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

/**
 * A collection that soft-deletes, which nothing here covered.
 *
 * Both bugs this pins shipped because the only delete test in the tree used a
 * collection without `softDelete`, so the entire soft path — the majority of
 * the delete code — ran in no test at all.
 */
const trashTable = pgTable("trash_notes", {
    id: varchar("id").primaryKey(),
    body: varchar("body"),
    // Keyed by the PROPERTY name, column named separately — the same shape
    // `notesTable` uses. Keying this `deleted_at` made the registry unable to
    // find the property `deletedAt`, and the save was refused with
    // "'trash_notes' has no column 'deletedAt'" — which is the driver's error
    // doing its job on a mistake in this file.
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});

const trashCollection: CollectionConfig = {
    name: "Trash notes", slug: "trash_notes", table: "trash_notes",
    softDelete: true,
    properties: {
        id: { name: "ID", type: "string", isId: true },
        body: { name: "Body", type: "string" },
        deletedAt: { name: "Deleted at", type: "date" }
    }
} as unknown as CollectionConfig;

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
        await admin.query(`CREATE TABLE public.trash_notes (id VARCHAR(255) PRIMARY KEY, body VARCHAR(255), deleted_at TIMESTAMPTZ);`);
        await admin.end();

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([notesCollection, trashCollection]);
        registry.registerTable(notesTable, "notes");
        registry.registerTable(trashTable, "trash_notes");
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

    /**
     * A soft delete stamps the row instead of removing it, and both of these
     * failed on a released canary.
     */
    describe("a collection that soft-deletes", () => {

        const make = async (id: string) => {
            await driver.save({
                path: "trash_notes", collection: trashCollection,
                values: { id, body: "trash me" }
            } as never);
            return id;
        };

        /**
         * Asserted in SQL, not through a read API.
         *
         * `FetchCollectionProps` has no `withDeleted`, so the driver's own list
         * cannot ask for stamped rows at all — and a test that went through a
         * read path would be asserting that path's filter rather than what the
         * delete actually did. The table is the fact.
         */
        const state = async (id: string): Promise<"live" | "stamped" | "gone"> => {
            const r = await pool.query(
                "SELECT deleted_at FROM public.trash_notes WHERE id = $1", [id]
            );
            if (r.rowCount === 0) return "gone";
            return r.rows[0].deleted_at === null ? "live" : "stamped";
        };

        it("stamps the row instead of removing it, and does not throw doing so", async () => {
            // It threw. A soft delete IS a save, and `PersistService` read the
            // row back through the ordinary walk — which hides stamped rows —
            // so it could not see what it had just written and raised "Could
            // not fetch row after save." inside the transaction. That rolled
            // the stamp back: every DELETE on a soft-delete collection was a
            // 500 and the row stayed live. The feature did not work at all.
            const id = await make("t-1");

            await expect(driver.delete({
                row: { id, path: "trash_notes", values: {} },
                collection: trashCollection
            } as never)).resolves.toBeUndefined();

            expect(await state(id)).toBe("stamped");
        });

        it("purges a row that is already in the trash", async () => {
            // `?hard=true` on a stamped row is the "empty trash" operation, and
            // the route looked the row up with the default read — which hides
            // exactly the rows it was asked to remove — so it answered 404 for
            // a row `?deleted=only` was listing a moment earlier. A trashed row
            // could never be purged.
            const id = await make("t-2");
            await driver.delete({
                row: { id, path: "trash_notes", values: {} },
                collection: trashCollection
            } as never);
            expect(await state(id)).toBe("stamped");

            await driver.delete({
                row: { id, path: "trash_notes", values: {} },
                collection: trashCollection, hard: true
            } as never);

            expect(await state(id)).toBe("gone");
        });

        it("purges a live row directly", async () => {
            const id = await make("t-3");
            await driver.delete({
                row: { id, path: "trash_notes", values: {} },
                collection: trashCollection, hard: true
            } as never);
            expect(await state(id)).toBe("gone");
        });
    });
});
