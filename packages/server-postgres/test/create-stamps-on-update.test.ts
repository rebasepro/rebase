/**
 * The create-time stamps are the server's, on an update as on a create.
 *
 * `user_on_create` and an `on_create` date are stamped from the call context
 * when a row is created, and the body's value is overwritten — a caller who can
 * set `createdBy` is a caller who can attribute their write to somebody else.
 * An update left both to the body: `PATCH /docs/1 {createdBy: "carol",
 * createdAt: "2001-01-01"}` from bob stored both, through every write door
 * (REST, bulk, `_batch`, the socket, MCP), so the audit columns said whatever
 * the last writer wanted.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, User } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
    updatedBy: varchar("updated_by")
});

/** When set, a `beforeSave` that tries to rewrite the creator. */
let hookRewritesCreator: boolean;

function docsCollection(): CollectionConfig {
    return {
        name: "Docs",
        slug: "docs",
        table: "docs",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            createdBy: { name: "Created by", type: "string", columnName: "created_by", autoValue: "user_on_create" },
            createdAt: { name: "Created at", type: "date", columnName: "created_at", autoValue: "on_create" },
            updatedBy: { name: "Updated by", type: "string", columnName: "updated_by", autoValue: "user_on_update" }
        },
        callbacks: {
            beforeSave: ({ values }) => hookRewritesCreator ? { ...values, createdBy: "mallory" } : values
        }
    } as unknown as CollectionConfig;
}

const BOB = { uid: "bob", roles: ["user"] } as unknown as User;

let db: PGlite;
let rowId: number;

function driverOver(pglite: PGlite, user?: User): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([docsCollection()]);
    registry.registerTable(docsTable, "docs");
    const orm = drizzle(pglite, { schema: { docs: docsTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, user);
}

type Stored = { title: string; created_by: string | null; created_at: string | null; updated_by: string | null };
const stored = async (): Promise<Stored> =>
    (await db.query<Stored>(
        "SELECT title, created_by, created_at::text, updated_by FROM docs WHERE id = $1", [rowId])).rows[0];

function expectCreationKept(row: Stored): void {
    expect(row.created_by).toBe("alice");
    expect(row.created_at?.startsWith("2020-01-01")).toBe(true);
}

const FORGED = { createdBy: "carol", createdAt: "2001-01-01T00:00:00Z" };

beforeEach(async () => {
    hookRewritesCreator = false;
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE docs (id serial PRIMARY KEY, title varchar, created_by varchar,
                           created_at timestamptz, updated_by varchar);
        INSERT INTO docs (title, created_by, created_at) VALUES ('alpha', 'alice', '2020-01-01T00:00:00Z');
    `);
    rowId = (await db.query<{ id: number }>("SELECT id FROM docs")).rows[0].id;
});

afterEach(async () => {
    await db.close();
});

describe("an update cannot rewrite the create-time stamps", () => {
    it("a single update naming them changes the rest and keeps both", async () => {
        const saved = await driverOver(db, BOB).save({
            path: "docs", id: String(rowId), values: { title: "edited", ...FORGED }, status: "existing"
        });

        const row = await stored();
        expect(row).toMatchObject({ title: "edited", updated_by: "bob" });
        expectCreationKept(row);
        expect(saved.createdBy).toBe("alice");
    });

    it("a bulk update (PATCH /bulk) keeps both", async () => {
        await driverOver(db, BOB).updateMany({
            path: "docs", updates: [{ id: rowId, values: { title: "bulk", ...FORGED } }]
        });

        expectCreationKept(await stored());
    });

    it("a `_batch` update keeps both", async () => {
        await driverOver(db, BOB).batchWrite({
            operations: [{ op: "update", path: "docs", id: String(rowId), values: { title: "batch", ...FORGED } }]
        });

        expectCreationKept(await stored());
    });

    it("nor can a `beforeSave` hook reattribute the row", async () => {
        hookRewritesCreator = true;
        await driverOver(db, BOB).save({
            path: "docs", id: String(rowId), values: { title: "hooked" }, status: "existing"
        });

        expectCreationKept(await stored());
    });
});
