/**
 * `rebase storage orphans` reads every row as stored, past every read hook.
 *
 * The scan used to read through `fetchCollection`, which runs `beforeQuery`
 * and `afterRead`. A sweep has no caller, so the documented hook —
 * `if admin return; return { filter: { owner_id: ["==", context.user?.uid ?? null] } }`
 * — narrowed it to the rows owned by nobody, every user's file looked unused,
 * and `--delete` deleted them. An `afterRead` that drops or rewrites a file
 * field did the same.
 *
 * A real `PostgresBackendDriver` over PGlite and the real `findOrphans`.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, primaryKey, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry, tablesFromCollections } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import { HistoryService } from "../src/history/HistoryService";
import { findOrphans } from "../../server/src/storage/maintenance";
import type { StorageController } from "../../server/src/storage/types";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    owner_id: varchar("owner_id"),
    file: varchar("file"),
    deleted_at: timestamp("deleted_at")
});

const tagsTable = pgTable("tags", {
    ns: varchar("ns").notNull(),
    name: varchar("name").notNull(),
    icon: varchar("icon")
}, (table) => [primaryKey({ columns: [table.ns, table.name] })]);

const docs: CollectionConfig = {
    name: "Docs",
    slug: "docs",
    table: "docs",
    softDelete: true,
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        owner_id: { name: "Owner", type: "string" },
        file: { name: "File", type: "string", storage: { storagePath: "docs" } },
        deletedAt: { name: "Deleted at", type: "date" }
    },
    callbacks: {
        // Exactly the JSDoc example on `CollectionCallbacks.beforeQuery`.
        beforeQuery: ({ context }: { context: { user?: { uid?: string; roles?: string[] } } }) => {
            if (context.user?.roles?.includes("admin")) return;
            return { filter: { owner_id: ["==", context.user?.uid ?? null] } };
        },
        // And an `afterRead` that hides the stored key.
        afterRead: ({ row }: { row: Record<string, unknown> }) => ({ ...row, file: undefined })
    }
};

/** The tables a storage scan reads, from fixture collections, with the driver seam that names them. */
function scanSources(collections: CollectionConfig[]) {
    const fixture = tablesFromCollections(collections);
    return {
        tables: fixture.tables,
        driverCollection: (slug: string) => fixture.collections.find(collection => collection.slug === slug)
    };
}

const tags: CollectionConfig = {
    name: "Tags",
    slug: "tags",
    table: "tags",
    properties: {
        ns: { name: "Namespace", type: "string", isId: true },
        name: { name: "Name", type: "string", isId: true },
        icon: { name: "Icon", type: "string" }
    }
};

const DAY = 86_400_000;

/** A source holding the given keys, every one a week old. */
function sourceHolding(keys: string[]): StorageController {
    const old = new Date(Date.now() - 7 * DAY).toISOString();
    const unused = (): never => { throw new Error("the orphan scan only lists"); };
    return {
        async listObjects(prefix: string) {
            if (prefix !== "") return { items: [], prefixes: [] };
            return {
                items: keys.map(fullPath => ({
                    fullPath, updated: old, size: 1,
                    name: fullPath.split("/").pop() ?? fullPath, bucket: "test", root: null, parent: null,
                    toString: () => fullPath
                })),
                prefixes: []
            };
        },
        putObject: unused,
        getSignedUrl: unused,
        getObject: unused,
        deleteObject: unused,
        getType: () => "test"
    };
}

describe("storage orphans over a collection with read hooks", () => {
    let db: PGlite;
    let driver: PostgresBackendDriver;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(`
            CREATE TABLE docs (id serial PRIMARY KEY, owner_id varchar, file varchar, deleted_at timestamp);
            INSERT INTO docs (owner_id, file) VALUES ('u1', 'docs/u1-contract.pdf'), ('u2', 'docs/u2-passport.jpg');
            INSERT INTO docs (owner_id, file, deleted_at) VALUES ('u3', 'docs/u3-trashed.pdf', now());
            CREATE TABLE tags (ns varchar NOT NULL, name varchar NOT NULL, icon varchar, PRIMARY KEY (ns, name));
        `);
        // Five namespaces × five names, so a page of 4 ends mid-namespace.
        const values: string[] = [];
        for (let n = 0; n < 5; n++) for (let m = 0; m < 5; m++) values.push(`('ns${n}', 'name${m}', 'icons/${n}-${m}.svg')`);
        await db.exec(`INSERT INTO tags (ns, name, icon) VALUES ${values.join(", ")};`);

        const registry = new FixtureTableRegistry();
        registry.registerMultiple([docs, tags]);
        registry.registerPgTable(docsTable, "docs");
        registry.registerPgTable(tagsTable, "tags");
        // PGlite's drizzle database stands in for node-postgres's: the driver names NodePgDatabase, whose
        // `$client` is a pg pool, and no typed bridge between the two exists.
        const orm = drizzle(db, { schema: { docs: docsTable, tags: tagsTable } }) as unknown as NodePgDatabase;
        // The unscoped default driver the maintenance route reads through.
        driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    });

    afterEach(async () => {
        await db.close();
    });

    it("calls no file a row names an orphan, whatever the hooks let through", async () => {
        const report = await findOrphans({
            controller: sourceHolding(["docs/u1-contract.pdf", "docs/u2-passport.jpg", "docs/u3-trashed.pdf", "docs/unused.pdf"]),
            // `docs` as the server's storage scan reads it: compiled, its read
            // hooks beside the descriptor, and the collection the driver is handed.
            ...scanSources([docs]),
            driverFor: () => driver,
            olderThanMs: DAY
        });
        expect(report.unscanned).toEqual([]);
        expect(report.orphans.map(o => o.key)).toEqual(["docs/unused.pdf"]);
    });

    it("calls no file a history entry names an orphan: a revert restores it", async () => {
        await db.exec(`
            CREATE SCHEMA IF NOT EXISTS rebase;
            CREATE TABLE rebase.entity_history (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, table_name TEXT NOT NULL, entity_id TEXT NOT NULL,
                action TEXT NOT NULL, changed_fields TEXT[], "values" JSONB, previous_values JSONB, updated_by TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), format SMALLINT NOT NULL DEFAULT 1
            );
            INSERT INTO rebase.entity_history (id, table_name, entity_id, action, "values", previous_values) VALUES
                ('a', 'docs', '1', 'update', '{"file":"docs/u1-contract.pdf"}', '{"file":"docs/u1-draft.pdf"}'),
                ('b', 'docs', '1', 'update', '{"file":"docs/u1-contract.pdf"}', '{"file":"docs/u1-contract.pdf"}'),
                ('c', 'docs', '2', 'update', null, '{"gallery":["docs/u2-old-scan.jpg"]}');
        `);
        // PGlite's drizzle database stands in for node-postgres's: the driver names NodePgDatabase, whose
        // `$client` is a pg pool, and no typed bridge between the two exists.
        const orm = drizzle(db) as unknown as NodePgDatabase;
        const history = new HistoryService(orm);
        const report = await findOrphans({
            controller: sourceHolding(["docs/u1-draft.pdf", "docs/u2-old-scan.jpg", "docs/unused.pdf"]),
            ...scanSources([]),
            driverFor: () => driver,
            history: { scanStoredValues: () => history.scanStoredValues(2) },
            olderThanMs: DAY
        });
        expect(report.unscanned).toEqual([]);
        expect(report.orphans.map(o => o.key)).toEqual(["docs/unused.pdf"]);
    });

    it("reads every row of a composite-keyed table, page by page", async () => {
        const pages: number[] = [];
        const icons: unknown[] = [];
        for await (const rows of driver.scanStoredRows({ path: "tags", collection: tags, pageSize: 4 })) {
            pages.push(rows.length);
            icons.push(...rows.map(row => row.icon));
        }
        expect(icons).toHaveLength(25);
        expect(new Set(icons).size).toBe(25);
        expect(pages).toEqual([4, 4, 4, 4, 4, 4, 1]);
    });
});
