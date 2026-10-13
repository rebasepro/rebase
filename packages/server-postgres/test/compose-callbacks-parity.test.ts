/**
 * `composeCallbacks(a, b)` in a collection's slot behaves exactly as `a` in
 * the global slot and `b` in the collection's.
 *
 * `composeCallbacks` promises to combine sets the way this driver combines its
 * tiers. A second implementation of the same rules drifts from the first the
 * day one of them changes, so nothing here restates the rules: a real driver
 * over PGlite runs one scenario — saves, a failed save, reads, a count,
 * vetoed and allowed deletes — once with the sets in the two tiers and once
 * composed into one, and everything observable from outside is compared: what
 * each call answered, what the hooks saw, and what the table holds.
 */
import { describe, it, expect } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionCallbacks, CollectionConfig } from "@rebasepro/types";
import { composeCallbacks } from "@rebasepro/common";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const notesTable = pgTable("notes", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    slug: varchar("slug"),
    tenant: varchar("tenant"),
    status: varchar("status"),
    code: varchar("code", { length: 3 })
});

const SCHEMA = `
    CREATE TABLE notes (
        id serial PRIMARY KEY,
        title varchar,
        slug varchar,
        tenant varchar,
        status varchar,
        code varchar(3)
    );
    INSERT INTO notes (title, tenant, status) VALUES
        ('keep-a', 't1', 'published'),
        ('keep-b', 't1', 'published'),
        ('goes',   't1', 'published'),
        ('hidden', 't2', 'published'),
        ('draft',  't1', 'draft'),
        ('nope',   't1', 'published');
`;

function notes(callbacks: CollectionCallbacks | undefined): CollectionConfig {
    return {
        name: "Notes",
        slug: "notes",
        table: "notes",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            slug: { name: "Slug", type: "string" },
            tenant: { name: "Tenant", type: "string" },
            status: { name: "Status", type: "string" },
            code: { name: "Code", type: "string" }
        },
        ...(callbacks ? { callbacks } : {})
    };
}

/** Two independent sets, each with every hook, each writing what it saw to `log`. */
function sets(log: unknown[]): [CollectionCallbacks, CollectionCallbacks] {
    const a: CollectionCallbacks = {
        beforeSave: ({ values, status }) => {
            log.push(["a.beforeSave", status, values]);
            return { slug: String(values.title).toLowerCase() };
        },
        afterRead: ({ row }) => {
            log.push(["a.afterRead", row.id]);
            return { ...row, readBy: "a" };
        },
        beforeQuery: ({ operation, query }) => {
            log.push(["a.beforeQuery", operation, query.limit]);
            return { filter: { tenant: ["==", "t1"] } };
        },
        afterSave: ({ values }) => {
            log.push(["a.afterSave", values.slug, values.title]);
        },
        afterSaveError: ({ values }) => {
            log.push(["a.afterSaveError", values.title]);
            throw new Error("a's alert failed");
        },
        beforeDelete: ({ row }) => {
            log.push(["a.beforeDelete", row.title]);
            return row.title === "keep-a" ? false : undefined;
        },
        afterDelete: ({ row }) => {
            log.push(["a.afterDelete", row.title]);
        }
    };
    const b: CollectionCallbacks = {
        beforeSave: ({ values }) => {
            log.push(["b.beforeSave", values]);
            return { ...values, title: `${String(values.title)}!` };
        },
        afterRead: ({ row }) => {
            log.push(["b.afterRead", row.readBy]);
            return { ...row, readBy: `${String(row.readBy)}+b` };
        },
        beforeQuery: () => {
            log.push(["b.beforeQuery"]);
            return {
                filter: { tenant: ["!=", "t3"], status: ["==", "published"] },
                logical: { type: "not", conditions: [{ column: "title", operator: "==", value: "nope" }] }
            };
        },
        afterSave: ({ values }) => {
            log.push(["b.afterSave", values.title]);
        },
        afterSaveError: ({ values }) => {
            log.push(["b.afterSaveError", values.title]);
        },
        beforeDelete: ({ row }) => {
            log.push(["b.beforeDelete", row.title]);
            return row.title === "keep-b" ? false : true;
        },
        afterDelete: ({ row }) => {
            log.push(["b.afterDelete", row.title]);
        }
    };
    return [a, b];
}

async function outcome<T>(work: () => Promise<T>): Promise<{ ok: T } | { error: { message: string; code: unknown } }> {
    try {
        return { ok: await work() };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        return { error: { message, code } };
    }
}

/** The whole scenario, against sets placed by `place`. Returns everything observable. */
async function scenario(place: (registry: PostgresCollectionRegistry, a: CollectionCallbacks, b: CollectionCallbacks) => CollectionConfig) {
    const db = new PGlite();
    try {
        await db.waitReady;
        await db.exec(SCHEMA);
        const log: unknown[] = [];
        const [a, b] = sets(log);
        const registry = new PostgresCollectionRegistry();
        const collection = place(registry, a, b);
        registry.registerMultiple([collection]);
        registry.registerTable(notesTable, "notes");
        const orm = drizzle(db, { schema: { notes: notesTable } }) as never;
        const driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);

        const ids = async (title: string) =>
            (await db.query<{ id: number }>("SELECT id FROM notes WHERE title = $1", [title])).rows[0].id;

        const results = {
            created: await outcome(() => driver.save({
                path: "notes", status: "new", collection,
                values: { title: "Hello", tenant: "t1", status: "published" }
            })),
            updated: await outcome(async () => driver.save({
                path: "notes", status: "existing", collection, id: await ids("goes"),
                values: { title: "goes", status: "published" }
            })),
            failed: await outcome(() => driver.save({
                path: "notes", status: "new", collection,
                values: { title: "Too long", tenant: "t1", status: "published", code: "toolong" }
            })),
            listed: await outcome(() => driver.fetchCollection({ path: "notes", collection, limit: 10 })),
            counted: await outcome(() => driver.count({ path: "notes", collection })),
            one: await outcome(async () => driver.fetchOne({ path: "notes", collection, id: await ids("keep-a") })),
            hidden: await outcome(async () => driver.fetchOne({ path: "notes", collection, id: await ids("hidden") })),
            vetoedByA: await outcome(async () => driver.delete({ row: { id: await ids("keep-a"), path: "notes" }, collection })),
            vetoedByB: await outcome(async () => driver.delete({ row: { id: await ids("keep-b"), path: "notes" }, collection })),
            deleted: await outcome(async () => driver.delete({ row: { id: await ids("goes!"), path: "notes" }, collection }))
        };
        const table = (await db.query("SELECT id, title, slug, tenant, status, code FROM notes ORDER BY id")).rows;
        return { results, log, table };
    } finally {
        await db.close();
    }
}

describe("composeCallbacks matches the driver's tiers", () => {
    it("composed into the collection's slot, as the global set followed by the collection's", async () => {
        const tiers = await scenario((registry, a, b) => {
            registry.setGlobalCallbacks(a);
            return notes(b);
        });
        const composed = await scenario((_registry, a, b) => notes(composeCallbacks(a, b)));

        // The scenario exercised what it claims to — so equality below is
        // not two empty runs agreeing.
        expect(tiers.results.created).toMatchObject({ ok: { title: "Hello!", slug: "hello", readBy: "a+b" } });
        expect(tiers.results.vetoedByA).toHaveProperty("error");
        expect(tiers.results.vetoedByB).toHaveProperty("error");
        expect(tiers.results.deleted).toEqual({ ok: undefined });
        expect(tiers.results.failed).toHaveProperty("error");
        expect(tiers.log).toContainEqual(["b.afterSaveError", "Too long!"]);
        expect(tiers.results.listed).toMatchObject({ ok: expect.arrayContaining([expect.objectContaining({ readBy: "a+b" })]) });
        expect(tiers.results.hidden).not.toEqual({ ok: expect.objectContaining({ title: "hidden" }) });
        // Each set's narrowing removed rows only it removes: a's the other
        // tenant, b's filter the draft and b's logical group the "nope" row.
        expect(tiers.results.counted).toEqual({ ok: 4 });

        expect(composed.results).toEqual(tiers.results);
        expect(composed.log).toEqual(tiers.log);
        expect(composed.table).toEqual(tiers.table);
    });
});
