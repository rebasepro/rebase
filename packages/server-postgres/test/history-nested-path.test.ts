/**
 * A write through a nested path is recorded in the row's own history.
 *
 * The history route reads `table_name = collection.slug`. A write made through
 * a parent — `PATCH /owners/1/docs/10`, a nested create or delete, a socket
 * SAVE/DELETE with that path — was recorded under the path it came in on,
 * `owners/1/docs`, so `GET /docs/10/history` never showed it and the entry's
 * retention prune ran under a key nothing reads. A trail with gaps.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const ownersTable = pgTable("owners", { id: serial("id").primaryKey(), name: varchar("name") });
const docsTable = pgTable("docs", { id: serial("id").primaryKey(), title: varchar("title"), ownerId: integer("owner_id") });
const ownersRelations = relations(ownersTable, ({ many }) => ({ docs: many(docsTable) }));
const docsRelations = relations(docsTable, ({ one }) => ({
    owner: one(ownersTable, { fields: [docsTable.ownerId], references: [ownersTable.id] })
}));

function ownersCollection(): CollectionConfig {
    return {
        name: "Owners", slug: "owners", table: "owners",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            docs: { name: "Docs", type: "relation", relation: { kind: "hasMany", target: () => docsCollection(), foreignKeyOnTarget: "owner_id" } }
        }
    } as unknown as CollectionConfig;
}

function docsCollection(): CollectionConfig {
    return {
        name: "Docs", slug: "docs", table: "docs", history: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            owner: { name: "Owner", type: "relation", relation: { kind: "belongsTo", target: () => ownersCollection(), localKey: "owner_id" } }
        }
    } as unknown as CollectionConfig;
}

let db: PGlite;
let recorded: { tableName: string; id: string; action: string }[];

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([ownersCollection(), docsCollection()]);
    registry.registerTable(ownersTable, "owners");
    registry.registerTable(docsTable, "docs");
    registry.registerRelations?.(ownersRelations, "owners");
    registry.registerRelations?.(docsRelations, "docs");
    const orm = drizzle(pglite, { schema: { owners: ownersTable, docs: docsTable, ownersRelations, docsRelations } }) as never;
    const history = {
        recordHistory: async (p: { tableName: string; id: string; action: string }) => {
            recorded.push({ tableName: p.tableName, id: String(p.id), action: p.action });
        }
    };
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, undefined, undefined, history as never);
}

beforeEach(async () => {
    recorded = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE owners (id serial PRIMARY KEY, name varchar);
        CREATE TABLE docs (id serial PRIMARY KEY, title varchar, owner_id integer REFERENCES owners(id));
        INSERT INTO owners (id, name) VALUES (1, 'Ada');
        INSERT INTO docs (id, title, owner_id) VALUES (10, 'alpha', 1);
        SELECT setval('docs_id_seq', 10);
    `);
});

afterEach(async () => {
    await db.close();
});

describe("history is keyed by the collection, whatever path the write came in on", () => {
    it("a root-path update is recorded under the slug", async () => {
        await driverOver(db).save({ path: "docs", id: "10", values: { title: "root" }, status: "existing" });
        expect(recorded).toEqual([{ tableName: "docs", id: "10", action: "update" }]);
    });

    it("the same update through owners/1/docs is recorded under the slug too", async () => {
        await driverOver(db).save({ path: "owners/1/docs", id: "10", values: { title: "nested" }, status: "existing" });
        expect(recorded).toEqual([{ tableName: "docs", id: "10", action: "update" }]);
    });

    it("a copy is recorded as the create it is", async () => {
        await driverOver(db).save({ path: "docs", values: { title: "copied" }, status: "copy" });
        expect(recorded).toEqual([{ tableName: "docs", id: "11", action: "create" }]);
    });

    it("so are a nested create and a nested delete", async () => {
        const driver = driverOver(db);
        const row = await driver.save({ path: "owners/1/docs", values: { title: "new" }, status: "new" });
        await driver.delete({ row: { id: String(row.id), path: "owners/1/docs" } });
        expect(recorded).toEqual([
            { tableName: "docs", id: "11", action: "create" },
            { tableName: "docs", id: "11", action: "delete" }
        ]);
    });
});
