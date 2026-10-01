/**
 * An upsert that lands on a stored row is an update of that row.
 *
 * Every upsert door — `POST /:c?on_conflict=`, `POST /:c/bulk {upsert:true}`,
 * `_batch` upsert, the SDK's `upsert()` / `createMany(rows, {upsert:true})`, a
 * socket `SAVE {upsert:true}` — reaches `driver.save({ status: "new", upsert })`.
 * The driver ran the whole create pipeline for it and the conflict branch then
 * wrote that row over the stored one: every omitted field with a `defaultValue`
 * was reset to it, `user_on_create` was re-stamped with whoever ran the import,
 * `beforeSave` was told "new" with no previous values, history said "create",
 * and a row the caller's `beforeQuery` hides was updated and then answered 500
 * ("Could not fetch row after save.") instead of the 404 an update gets.
 *
 * A real driver over PGlite, because the defect is in what the statement does
 * to a stored row.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { boolean, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig, User } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    code: varchar("code").unique(),
    title: varchar("title"),
    tenant: varchar("tenant"),
    active: boolean("active"),
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});

/** What each `beforeSave` was told, in order. */
let seen: { status?: string; previousTitle?: unknown }[];
/** What history recorded, in order. */
let recorded: { tableName: string; id: string; action: string }[];

function docsCollection(): CollectionConfig {
    return {
        name: "Docs",
        slug: "docs",
        table: "docs",
        history: true,
        softDelete: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            code: { name: "Code", type: "string", validation: { unique: true } },
            title: { name: "Title", type: "string" },
            tenant: { name: "Tenant", type: "string" },
            active: { name: "Active", type: "boolean", defaultValue: true },
            createdBy: { name: "Created by", type: "string", columnName: "created_by", autoValue: "user_on_create" },
            createdAt: { name: "Created at", type: "date", columnName: "created_at", autoValue: "on_create" },
            deletedAt: { name: "Deleted at", type: "date", columnName: "deleted_at" }
        },
        callbacks: {
            beforeQuery: ({ context }) => {
                const tenant = (context.user as { tenant?: string } | undefined)?.tenant;
                if (!tenant) return;
                return { filter: { tenant: ["==", tenant] } };
            },
            beforeSave: ({ status, previousValues, values }) => {
                seen.push({ status, previousTitle: (previousValues as { title?: unknown } | undefined)?.title });
                return values;
            }
        }
    } as unknown as CollectionConfig;
}

const BOB_A = { uid: "bob", roles: ["user"], tenant: "a" } as unknown as User;

let db: PGlite;

function driverOver(pglite: PGlite, user?: User): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([docsCollection()]);
    registry.registerTable(docsTable, "docs");
    const orm = drizzle(pglite, { schema: { docs: docsTable } }) as never;
    const history = {
        recordHistory: async (p: { tableName: string; id: string; action: string }) => {
            recorded.push({ tableName: p.tableName, id: String(p.id), action: p.action });
        }
    };
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, user, undefined, history as never);
}

type Stored = {
    id: number; code: string; title: string; tenant: string; active: boolean;
    created_by: string | null; created_at: string | null; deleted_at: string | null
};
const rowOf = async (id: number): Promise<Stored | undefined> =>
    (await db.query<Stored>(
        "SELECT id, code, title, tenant, active, created_by, created_at::text, deleted_at::text FROM docs WHERE id = $1",
        [id])).rows[0];

/** Alice's row in tenant a; Carol's in tenant b (hidden from tenant a); a trashed one in a. */
let visible: number;
let hidden: number;
let trashed: number;

beforeEach(async () => {
    seen = [];
    recorded = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE docs (id serial PRIMARY KEY, code varchar UNIQUE, title varchar, tenant varchar,
                           active boolean, created_by varchar, created_at timestamptz, deleted_at timestamptz);
        INSERT INTO docs (code, title, tenant, active, created_by, created_at, deleted_at) VALUES
            ('A-1', 'alpha', 'a', false, 'alice', '2020-01-01T00:00:00Z', NULL),
            ('B-1', 'gamma', 'b', false, 'carol', '2020-01-01T00:00:00Z', NULL),
            ('A-9', 'trash', 'a', false, 'alice', '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z');
    `);
    const ids = (await db.query<{ id: number; code: string }>("SELECT id, code FROM docs")).rows;
    visible = ids.find(r => r.code === "A-1")!.id;
    hidden = ids.find(r => r.code === "B-1")!.id;
    trashed = ids.find(r => r.code === "A-9")!.id;
});

afterEach(async () => {
    await db.close();
});

/** The stored row's create-time facts, unchanged. */
function expectCreateFactsKept(row: Stored | undefined): void {
    expect(row).toMatchObject({ active: false, created_by: "alice" });
    expect(row?.created_at?.startsWith("2020-01-01")).toBe(true);
}

describe("an upsert over a stored row is an update of it", () => {
    it("keeps omitted defaults and the create stamps, and runs the update pipeline", async () => {
        await driverOver(db, BOB_A).save({
            path: "docs", values: { id: visible, title: "via-upsert", tenant: "a" }, status: "new", upsert: true
        });

        const row = await rowOf(visible);
        expect(row?.title).toBe("via-upsert");
        expectCreateFactsKept(row);
        expect(seen).toEqual([{ status: "existing", previousTitle: "alpha" }]);
        expect(recorded).toEqual([{ tableName: "docs", id: String(visible), action: "update" }]);
    });

    it("does the same for a bulk upsert", async () => {
        await driverOver(db, BOB_A).saveMany({
            path: "docs", rows: [{ id: visible, title: "via-bulk", tenant: "a" }], upsert: true
        });

        const row = await rowOf(visible);
        expect(row?.title).toBe("via-bulk");
        expectCreateFactsKept(row);
        expect(seen).toEqual([{ status: "existing", previousTitle: "alpha" }]);
    });

    it("on a natural key, updates the stored row under its own key", async () => {
        await driverOver(db, BOB_A).save({
            path: "docs", values: { id: 4242, code: "A-1", title: "by-code", tenant: "a" },
            status: "new", upsert: true, onConflict: ["code"]
        });

        const row = await rowOf(visible);
        expect(row?.title).toBe("by-code");
        expectCreateFactsKept(row);
        expect(await rowOf(4242)).toBeUndefined();
    });

    it("still inserts a key nobody has, with its defaults and stamps", async () => {
        await driverOver(db, BOB_A).save({
            path: "docs", values: { id: 900, code: "N-1", title: "new", tenant: "a" }, status: "new", upsert: true
        });

        const row = await rowOf(900);
        expect(row).toMatchObject({ title: "new", active: true, created_by: "bob" });
        expect(row?.created_at).not.toBeNull();
        expect(seen).toEqual([{ status: "new", previousTitle: undefined }]);
        expect(recorded).toEqual([{ tableName: "docs", id: "900", action: "create" }]);
    });

    it("on the key of a row the caller's beforeQuery hides, is a 404 and writes nothing", async () => {
        await expect(driverOver(db, BOB_A).save({
            path: "docs", values: { id: hidden, title: "stolen", tenant: "a" }, status: "new", upsert: true
        })).rejects.toMatchObject({ statusCode: 404 });

        expect(await rowOf(hidden)).toMatchObject({ title: "gamma", tenant: "b", active: false, created_by: "carol" });
    });

    it("on the key of a row in the trash, is refused and writes nothing", async () => {
        // This test used a trashed row to reach the INSERT's conflict branch,
        // because the read that routes an upsert hid it — and so pinned that
        // the statement wrote into the trash. It is refused now, by name.
        await expect(driverOver(db, BOB_A).save({
            path: "docs", values: { id: trashed, title: "re-imported", tenant: "a" }, status: "new", upsert: true
        })).rejects.toMatchObject({ statusCode: 409, code: "ROW_IN_TRASH" });

        expect(await rowOf(trashed)).toMatchObject({ title: "trash", deleted_at: expect.stringMatching(/^2021-01-01/) });
        expect(seen).toEqual([]);
        expect(recorded).toEqual([]);
    });

    it("when the statement itself meets the stored row, it sets only what the caller sent", async () => {
        // The path a concurrent insert of the same key takes: the read that
        // routes an upsert found nothing, and the INSERT meets the row anyway.
        // The race is staged by making that read come back empty.
        const driver = driverOver(db, BOB_A);
        Object.defineProperty(driver, "findUpsertTarget", { value: async () => undefined });
        await driver.save({
            path: "docs", values: { id: visible, title: "re-imported", tenant: "a" }, status: "new", upsert: true
        });

        const row = await rowOf(visible);
        expect(row?.title).toBe("re-imported");
        expectCreateFactsKept(row);
    });

    it("when the statement itself meets a row in the trash, it refuses rather than write into it", async () => {
        // The same race, onto a trashed row: the statement holds the rule the
        // read would have.
        const driver = driverOver(db, BOB_A);
        Object.defineProperty(driver, "findUpsertTarget", { value: async () => undefined });
        await expect(driver.save({
            path: "docs", values: { id: trashed, title: "re-imported", tenant: "a" }, status: "new", upsert: true
        })).rejects.toMatchObject({ statusCode: 409, code: "ROW_IN_TRASH" });

        expect(await rowOf(trashed)).toMatchObject({ title: "trash" });
    });
});
