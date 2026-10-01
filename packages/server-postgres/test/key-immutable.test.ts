/**
 * An update cannot move a row to another key.
 *
 * It answered 500 "Could not fetch row after save." on every door, because the
 * write read its row back by the address it had just changed. Over a request
 * the transaction rolled the move back; through the in-process data plane —
 * the base driver, no transaction around it — the row had already moved when
 * the call threw, with no `afterSave`, no history and no realtime event.
 *
 * A real driver over PGlite, with no transaction around the calls, because
 * "nothing was committed before the refusal" is the property under test.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const tagsTable = pgTable("tags", {
    slug: varchar("slug").primaryKey(),
    label: varchar("label")
});

/** What `afterSave` was told, in order. */
let saved: string[];

function tagsCollection(beforeSave?: (values: Record<string, unknown>) => Record<string, unknown>): CollectionConfig {
    return {
        name: "Tags",
        slug: "tags",
        table: "tags",
        properties: {
            slug: { name: "Slug", type: "string", isId: "manual" },
            label: { name: "Label", type: "string" }
        },
        callbacks: {
            ...(beforeSave && { beforeSave: ({ values }: { values: Record<string, unknown> }) => beforeSave(values) }),
            afterSave: ({ id }: { id: string | number }) => {
                saved.push(String(id));
            }
        }
    } as unknown as CollectionConfig;
}

let db: PGlite;

function driverOver(collection: CollectionConfig): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([collection]);
    registry.registerTable(tagsTable, "tags");
    const orm = drizzle(db, { schema: { tags: tagsTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

const slugs = async (): Promise<string[]> =>
    (await db.query<{ slug: string }>("SELECT slug FROM tags ORDER BY slug")).rows.map(row => row.slug);

beforeEach(async () => {
    saved = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE tags (slug varchar PRIMARY KEY, label varchar);
        INSERT INTO tags (slug, label) VALUES ('old-key', 'Old');
    `);
});

afterEach(async () => {
    await db.close();
});

describe("an update cannot change the row's key", () => {
    it("is refused with KEY_IMMUTABLE naming the key, and the row stays where it was", async () => {
        const driver = driverOver(tagsCollection());

        await expect(driver.data.tags.update("old-key", { slug: "new-key" }))
            .rejects.toMatchObject({
                statusCode: 400,
                code: "KEY_IMMUTABLE",
                details: { violations: [expect.objectContaining({ field: "slug" })] }
            });

        expect(await slugs()).toEqual(["old-key"]);
        expect(saved).toEqual([]);
    });

    it("accepts the key the row already has, as a form sending the whole row does", async () => {
        const driver = driverOver(tagsCollection());

        await driver.data.tags.update("old-key", { slug: "old-key", label: "Renamed" });

        expect((await db.query("SELECT slug, label FROM tags")).rows).toEqual([{ slug: "old-key", label: "Renamed" }]);
        expect(saved).toEqual(["old-key"]);
    });

    it("refuses a beforeSave that moves the key, too", async () => {
        const driver = driverOver(tagsCollection(values => ({ ...values, slug: "hooked-key" })));

        await expect(driver.data.tags.update("old-key", { label: "Edited" }))
            .rejects.toMatchObject({ statusCode: 400, code: "KEY_IMMUTABLE" });

        expect(await slugs()).toEqual(["old-key"]);
        expect(saved).toEqual([]);
    });
});
