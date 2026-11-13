/**
 * The relations the driver's single get fills in (those its `include` names)
 * are the target's rows as the caller may see them — its `beforeQuery` scope
 * and its soft delete applied.
 *
 * `fetchOne` is what the socket's `FETCH_ONE` and the MCP `get_document` tool
 * serve, and it populated every relation through drizzle's relational `with`,
 * which knows neither. So a tenant-a user fetching `owners/1` received
 * tenant b's docs and the trashed ones under `owner.docs`, while
 * `GET /owners/1?include=docs` answered `['alpha']`. The `via` loader applied
 * the scope but not the soft delete.
 *
 * A real driver over PGlite; every relation kind the owner declares is asked
 * for the same three docs.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { User } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import { testUser } from "./helpers/spg-b-fixtures";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const ownersTable = pgTable("owners", { id: serial("id").primaryKey(), name: varchar("name") });
const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    tenant: varchar("tenant"),
    ownerId: integer("owner_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});
const ownersRelations = relations(ownersTable, ({ many }) => ({ docs: many(docsTable) }));
const docsRelations = relations(docsTable, ({ one }) => ({
    owner: one(ownersTable, { fields: [docsTable.ownerId], references: [ownersTable.id] })
}));

function owners(): LegacyCollectionConfig {
    return {
        name: "Owners", slug: "owners", table: "owners",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" },
            docs: { name: "Docs", type: "relation", relation: { kind: "hasMany", target: () => docs(), foreignKeyOnTarget: "owner_id" } },
            viaDocs: {
                name: "Docs (join path)",
                type: "relation",
                relation: {
                    kind: "via",
                    target: () => docs(),
                    cardinality: "many",
                    // Joined on the drizzle table's own keys, which is how the
                    // join-path loaders resolve a step's columns.
                    joinPath: [{ table: "docs", on: { from: "id", to: "ownerId" } }]
                }
            }
        }
    };
}

function docs(): LegacyCollectionConfig {
    return {
        name: "Docs", slug: "docs", table: "docs",
        softDelete: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            tenant: { name: "Tenant", type: "string" },
            deletedAt: { name: "Deleted", type: "date", columnName: "deleted_at" },
            owner: { name: "Owner", type: "relation", relation: { kind: "belongsTo", target: () => owners(), localKey: "owner_id" } }
        },
        callbacks: {
            // The caller's tenant rides on their token's claims.
            beforeQuery: ({ context }) => {
                const tenant = context.user?.claims?.tenant;
                if (typeof tenant !== "string") return;
                return { filter: { tenant: ["==", tenant] } };
            }
        }
    };
}

const TENANT_USER = testUser({ uid: "u1", roles: ["user"], claims: { tenant: "a" } });

let db: PGlite;

/** `withSchema: false` leaves `db.query` empty, which is the path a fetch fell back to. */
function driverOver(pglite: PGlite, user?: User, options: { withSchema: boolean } = { withSchema: true }): PostgresBackendDriver {
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([owners(), docs()]);
    registry.registerPgTable(ownersTable, "owners");
    registry.registerPgTable(docsTable, "docs");
    registry.registerRelations({ ownersRelations, docsRelations });
    const orm = options.withSchema
        ? pgliteNodePg(pglite, { schema: { owners: ownersTable, docs: docsTable, ownersRelations, docsRelations } })
        : pgliteNodePg(pglite);
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, user);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE owners (id serial PRIMARY KEY, name varchar);
        CREATE TABLE docs (id serial PRIMARY KEY, title varchar, tenant varchar, owner_id integer REFERENCES owners(id), deleted_at timestamptz);
        INSERT INTO owners (id, name) VALUES (1, 'Ada');
        INSERT INTO docs (title, tenant, owner_id, deleted_at) VALUES
            ('alpha', 'a', 1, NULL), ('trashed-a', 'a', 1, now()), ('gamma-b', 'b', 1, NULL);
    `);
});

afterEach(async () => {
    await db.close();
});

const ids = (value: unknown) => (value as Record<string, unknown>[]).map(row => row.id);
const INCLUDE = ["docs", "viaDocs"];

describe("driver.fetchOne (WS FETCH_ONE, MCP get_document)", () => {
    it("serves what the REST include serves", async () => {
        const driver = driverOver(db, TENANT_USER);
        const rest = await driver.restFetchService.fetchOneForRest("owners", 1, ["docs"]);
        expect((rest?.docs as Record<string, unknown>[]).map(d => d.title)).toEqual(["alpha"]);

        const row = await driver.fetchOne({ path: "owners", id: 1, include: ["docs"] });
        expect(row).toEqual(rest);
    });

    it("loads no relation it was not asked for", async () => {
        const row = await driverOver(db, TENANT_USER).fetchOne({ path: "owners", id: 1 });
        expect(row).toEqual({ id: 1, name: "Ada" });
    });

    it("hides a soft-deleted target on a join-path relation too", async () => {
        const row = await driverOver(db, TENANT_USER).fetchOne({ path: "owners", id: 1, include: INCLUDE });
        expect(ids(row?.viaDocs)).toEqual([1]);
    });

    it("hides it with no beforeQuery scope at all", async () => {
        const row = await driverOver(db).fetchOne({ path: "owners", id: 1, include: INCLUDE });
        expect(ids(row?.docs)).toEqual([1, 3]);
        expect(ids(row?.viaDocs)).toEqual([1, 3]);
    });

    it("scopes them on a driver built without the relational query API", async () => {
        const row = await driverOver(db, TENANT_USER, { withSchema: false }).fetchOne({ path: "owners", id: 1, include: INCLUDE });
        expect(ids(row?.docs)).toEqual([1]);
        expect(ids(row?.viaDocs)).toEqual([1]);
    });

    it("renders each target as its own row — never a ref", async () => {
        const owner = await driverOver(db, TENANT_USER).fetchOne({ path: "owners", id: 1, include: ["docs"] });
        const [doc] = owner?.docs as Record<string, unknown>[];
        expect(doc).toMatchObject({ id: 1, title: "alpha" });
        expect(doc).not.toHaveProperty("__type");

        const alpha = await driverOver(db, TENANT_USER).fetchOne({ path: "docs", id: 1, include: ["owner"] });
        expect(alpha?.owner).toEqual({ id: 1, name: "Ada" });
        expect(alpha?.ownerId).toBe(1);
    });
});

describe("the single-parent relation loader", () => {
    it("hides a soft-deleted target on a join path, as it does on every other relation kind", async () => {
        const driver = driverOver(db);
        const viaRows = await driver.dataService.fetchRelatedEntities("owners", 1, "viaDocs");
        expect(viaRows.map(r => r.title).sort()).toEqual(["alpha", "gamma-b"]);
        const fkRows = await driver.dataService.fetchRelatedEntities("owners", 1, "docs");
        expect(fkRows.map(r => r.title).sort()).toEqual(["alpha", "gamma-b"]);
    });
});
