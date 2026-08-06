/**
 * E2E: `updateMany` and `deleteMany` against a real Postgres.
 *
 * Two properties need a real database to mean anything, and both are the reason
 * these exist as driver methods rather than as a loop in the REST layer:
 *
 *  1. **Atomicity.** A batch that fails part-way must leave nothing behind. A
 *     loop of single writes would leave the prefix committed, and the caller
 *     cannot tell which half landed without re-reading everything. Only a
 *     transaction gives that, and only a database can prove it.
 *  2. **The pipeline still runs.** `deleteMany` loops the single-row delete
 *     rather than emitting one `DELETE ... WHERE id = ANY($1)`. The single
 *     statement would be faster and would skip every callback — so a collection
 *     relying on `beforeDelete` to veto, or on `afterDelete` to clean up
 *     dependents, would behave differently depending on how many rows the
 *     caller happened to delete at once. That is the kind of difference nobody
 *     finds until production.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar, integer } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

const itemsTable = pgTable("items", {
    id: varchar("id").primaryKey(),
    name: varchar("name"),
    qty: integer("qty")
});

/** `qty` is NOT NULL in the schema, which is how a mid-batch failure is forced. */
const itemsCollection = {
    name: "Items", slug: "items", table: "items",
    properties: {
        id: { name: "ID", type: "string", isId: true, validation: { required: true } },
        name: { name: "Name", type: "string" },
        qty: { name: "Qty", type: "number" }
    }
} as unknown as CollectionConfig;

describe("bulk update/delete (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    let registry: PostgresCollectionRegistry;

    async function rows(): Promise<{ id: string; name: string; qty: number }[]> {
        const r = await admin.query("SELECT id, name, qty FROM public.items ORDER BY id");
        return r.rows;
    }

    beforeAll(async () => {
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        await admin.query(`
            CREATE TABLE public.items (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255),
                qty INTEGER NOT NULL
            );
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        registry = new PostgresCollectionRegistry();
        registry.registerMultiple([itemsCollection]);
        registry.registerTable(itemsTable, "items");

        const db = drizzle(pool);
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
    }, 120_000);

    afterAll(async () => {
        if (pool) await pool.end().catch(() => {});
        if (admin) await admin.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    beforeEach(async () => {
        await admin.query("TRUNCATE public.items");
        await admin.query(`
            INSERT INTO public.items (id, name, qty) VALUES
                ('a', 'alpha', 1), ('b', 'bravo', 2), ('c', 'charlie', 3);
        `);
        // Callbacks are per-collection state on the registry; reset between tests.
        (itemsCollection as { callbacks?: unknown }).callbacks = undefined;
        registry.registerMultiple([itemsCollection]);
    });

    describe("updateMany", () => {
        it("applies every update and returns the rows in order", async () => {
            const written = await driver.updateMany({
                path: "items",
                updates: [
                    { id: "a", values: { name: "ALPHA" } },
                    { id: "c", values: { name: "CHARLIE", qty: 30 } }
                ],
                collection: itemsCollection
            });

            expect(written.map(r => r.id)).toEqual(["a", "c"]);
            expect(await rows()).toEqual([
                { id: "a", name: "ALPHA", qty: 1 },
                { id: "b", name: "bravo", qty: 2 },
                { id: "c", name: "CHARLIE", qty: 30 }
            ]);
        });

        it("writes only the columns given, leaving the rest alone", async () => {
            await driver.updateMany({
                path: "items",
                updates: [{ id: "b", values: { name: "BRAVO" } }],
                collection: itemsCollection
            });
            // qty survives: a merge, not a replace.
            expect((await rows()).find(r => r.id === "b")).toEqual({ id: "b", name: "BRAVO", qty: 2 });
        });

        it("rolls the whole batch back when one row fails", async () => {
            // The second update violates NOT NULL. The first must not survive.
            await expect(driver.updateMany({
                path: "items",
                updates: [
                    { id: "a", values: { name: "committed?" } },
                    { id: "b", values: { qty: null as unknown as number } }
                ],
                collection: itemsCollection
            })).rejects.toThrow();

            expect(await rows()).toEqual([
                { id: "a", name: "alpha", qty: 1 },
                { id: "b", name: "bravo", qty: 2 },
                { id: "c", name: "charlie", qty: 3 }
            ]);
        });

        it("names the offending entry in the error", async () => {
            // "the batch failed" is unactionable at a thousand rows.
            await expect(driver.updateMany({
                path: "items",
                updates: [
                    { id: "a", values: { name: "ok" } },
                    { id: "b", values: { qty: null as unknown as number } }
                ],
                collection: itemsCollection
            })).rejects.toThrow(/Update 1 of 2 \(id "b"\)/);
        });

        it("404s the batch on an id that matches no row, writing nothing", async () => {
            await expect(driver.updateMany({
                path: "items",
                updates: [
                    { id: "a", values: { name: "ok" } },
                    { id: "nope", values: { name: "ghost" } }
                ],
                collection: itemsCollection
            })).rejects.toMatchObject({ statusCode: 404 });

            expect((await rows()).find(r => r.id === "a")!.name).toBe("alpha");
        });

        it("runs beforeSave for each row", async () => {
            const seen: unknown[] = [];
            (itemsCollection as { callbacks?: unknown }).callbacks = {
                beforeSave: ({ values }: { values: Record<string, unknown> }) => {
                    seen.push(values.name);
                    return { ...values, name: String(values.name).toUpperCase() };
                }
            };
            registry.registerMultiple([itemsCollection]);

            await driver.updateMany({
                path: "items",
                updates: [{ id: "a", values: { name: "x" } }, { id: "b", values: { name: "y" } }],
                collection: itemsCollection
            });

            expect(seen).toEqual(["x", "y"]);
            const after = await rows();
            expect(after.find(r => r.id === "a")!.name).toBe("X");
            expect(after.find(r => r.id === "b")!.name).toBe("Y");
        });
    });

    describe("deleteMany", () => {
        it("deletes every id", async () => {
            await driver.deleteMany({ path: "items", ids: ["a", "c"], collection: itemsCollection });
            expect((await rows()).map(r => r.id)).toEqual(["b"]);
        });

        it("rolls back when one id matches no row", async () => {
            await expect(driver.deleteMany({
                path: "items",
                ids: ["a", "nope"],
                collection: itemsCollection
            })).rejects.toMatchObject({ statusCode: 404 });

            // 'a' is still here: all-or-nothing, so a typo in a list of a
            // thousand ids does not delete the 999 before it.
            expect((await rows()).map(r => r.id)).toEqual(["a", "b", "c"]);
        });

        it("runs beforeDelete and afterDelete for every row", async () => {
            const before: unknown[] = [];
            const after: unknown[] = [];
            (itemsCollection as { callbacks?: unknown }).callbacks = {
                beforeDelete: ({ id }: { id: string | number }) => { before.push(id); },
                afterDelete: ({ id }: { id: string | number }) => { after.push(id); }
            };
            registry.registerMultiple([itemsCollection]);

            await driver.deleteMany({ path: "items", ids: ["a", "b"], collection: itemsCollection });

            // The property that a single `DELETE ... WHERE id = ANY(...)` would
            // have quietly broken.
            expect(before).toEqual(["a", "b"]);
            expect(after).toEqual(["a", "b"]);
            expect((await rows()).map(r => r.id)).toEqual(["c"]);
        });

        it("rolls the batch back when a beforeDelete callback throws", async () => {
            (itemsCollection as { callbacks?: unknown }).callbacks = {
                beforeDelete: ({ id }: { id: string | number }) => {
                    if (id === "b") throw new Error("vetoed");
                }
            };
            registry.registerMultiple([itemsCollection]);

            await expect(driver.deleteMany({
                path: "items",
                ids: ["a", "b"],
                collection: itemsCollection
            })).rejects.toThrow(/vetoed/);

            expect((await rows()).map(r => r.id)).toEqual(["a", "b", "c"]);
        });
    });
});
