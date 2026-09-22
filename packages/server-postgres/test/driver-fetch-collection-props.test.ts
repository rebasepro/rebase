/**
 * The driver's `fetchCollection` answers the query it was asked.
 *
 * It destructured ten of `FetchCollectionProps` and handed only those to the
 * fetch, so `logical`, `include`, `fields`, `distinct`, `withDeleted` and
 * `searchExplain` were accepted and dropped. This is the read the socket's
 * `FETCH_COLLECTION` and the MCP tools are served from, and the in-process SDK
 * falls back to it on a driver with no REST fetch service: `or(name == 'ann')`
 * returned every row while `COUNT` with the same group answered 1, a trash view
 * showed live rows, and an `include` came back without the relation.
 *
 * A real driver over PGlite, asked each question once.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const ownersTable = pgTable("owners", { id: serial("id").primaryKey(), name: varchar("name") });
const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    status: varchar("status"),
    ownerId: integer("owner_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});
const ownersRelations = relations(ownersTable, ({ many }) => ({ docs: many(docsTable) }));
const docsRelations = relations(docsTable, ({ one }) => ({
    owner: one(ownersTable, { fields: [docsTable.ownerId], references: [ownersTable.id] })
}));

function owners(): CollectionConfig {
    return {
        name: "Owners", slug: "owners", table: "owners",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            docs: { name: "Docs", type: "relation", relation: { kind: "hasMany", target: () => docs(), foreignKeyOnTarget: "owner_id" } }
        }
    } as unknown as CollectionConfig;
}

function docs(): CollectionConfig {
    return {
        name: "Docs", slug: "docs", table: "docs",
        softDelete: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            status: { name: "Status", type: "string" },
            deletedAt: { name: "Deleted", type: "date", columnName: "deleted_at" },
            owner: { name: "Owner", type: "relation", relation: { kind: "belongsTo", target: () => owners(), localKey: "owner_id" } }
        }
    } as unknown as CollectionConfig;
}

let db: PGlite;

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([owners(), docs()]);
    registry.registerTable(ownersTable, "owners");
    registry.registerTable(docsTable, "docs");
    registry.registerRelations?.(ownersRelations, "owners");
    registry.registerRelations?.(docsRelations, "docs");
    const orm = drizzle(pglite, { schema: { owners: ownersTable, docs: docsTable, ownersRelations, docsRelations } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE owners (id serial PRIMARY KEY, name varchar);
        CREATE TABLE docs (id serial PRIMARY KEY, title varchar, status varchar, owner_id integer REFERENCES owners(id), deleted_at timestamptz);
        INSERT INTO owners (id, name) VALUES (1, 'Ada');
        INSERT INTO docs (title, status, owner_id, deleted_at) VALUES
            ('alpha', 'draft', 1, NULL),
            ('beta', 'draft', 1, NULL),
            ('gamma', 'live', 1, NULL),
            ('trashed', 'live', 1, now());
    `);
});

afterEach(async () => {
    await db.close();
});

const titles = (rows: Record<string, unknown>[]) => rows.map(r => r.title).sort();

describe("driver.fetchCollection", () => {
    it("honours a logical group, and agrees with count about it", async () => {
        const driver = driverOver(db);
        const logical = { type: "or" as const, conditions: [{ column: "title", operator: "==" as const, value: "alpha" }] };
        const rows = await driver.fetchCollection({ path: "docs", logical });
        expect(titles(rows)).toEqual(["alpha"]);
        expect(await driver.count({ path: "docs", logical })).toBe(1);
    });

    it("honours withDeleted, in both spellings", async () => {
        const driver = driverOver(db);
        expect(titles(await driver.fetchCollection({ path: "docs" }))).toEqual(["alpha", "beta", "gamma"]);
        expect(titles(await driver.fetchCollection({ path: "docs", withDeleted: true })))
            .toEqual(["alpha", "beta", "gamma", "trashed"]);
        expect(titles(await driver.fetchCollection({ path: "docs", withDeleted: "only" }))).toEqual(["trashed"]);
    });

    it("projects to `fields`, keeping the key", async () => {
        const driver = driverOver(db);
        const rows = await driver.fetchCollection({ path: "docs", fields: ["title"] });
        expect(rows).toHaveLength(3);
        for (const row of rows) expect(Object.keys(row).sort()).toEqual(["id", "title"]);
    });

    it("answers a distinct read with one row per value", async () => {
        const driver = driverOver(db);
        const rows = await driver.fetchCollection({ path: "docs", fields: ["status"], distinct: true });
        expect(rows.map(r => r.status).sort()).toEqual(["draft", "live"]);
    });

    it("loads the relations `include` names", async () => {
        const driver = driverOver(db);
        const [owner] = await driver.fetchCollection({ path: "owners", include: ["docs"] });
        expect(titles(owner.docs as Record<string, unknown>[])).toEqual(["alpha", "beta", "gamma"]);
    });
});

describe("what a frame spread whole cannot reach", () => {
    it("ignores a `relatedTo` sent by the caller — the scope comes from the path", async () => {
        const driver = driverOver(db);
        const smuggled = { path: "docs", relatedTo: { parentId: 1 } } as unknown as Parameters<PostgresBackendDriver["fetchCollection"]>[0];
        expect(titles(await driver.fetchCollection(smuggled))).toEqual(["alpha", "beta", "gamma"]);
    });
});
