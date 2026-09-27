/**
 * A create that names its key is still a create.
 *
 * `save({ id, status: "new" })` is what in-process `data.x.create(values, id)`,
 * MCP `create_document { id }` and a socket `SAVE { id, status: "new" }` send.
 * The persistence layer chose INSERT or UPDATE from the presence of `id` alone,
 * so each of those was an UPDATE: a new id answered `404 No row to update`, and
 * an existing id was silently overwritten with create-time values — defaults
 * filled back in, `created_by` and `created_at` re-stamped — for what the
 * caller had asked to be a new row. The HTTP SDK puts the id in the body and
 * inserts, so the same SDK call did two different operations by door.
 *
 * A real driver over PGlite: the question is what the statement does to the
 * table, and a mocked query builder would only record which branch was taken.
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
    title: varchar("title"),
    tenant: varchar("tenant"),
    active: boolean("active"),
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
});

/** What each `beforeSave` was told, in order. */
let seen: { status?: string; id?: unknown }[];

function docsCollection(): CollectionConfig {
    return {
        name: "Docs",
        slug: "docs",
        table: "docs",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            tenant: { name: "Tenant", type: "string" },
            active: { name: "Active", type: "boolean", defaultValue: true },
            createdBy: { name: "Created by", type: "string", columnName: "created_by", autoValue: "user_on_create" },
            createdAt: { name: "Created at", type: "date", columnName: "created_at", autoValue: "on_create" }
        },
        callbacks: {
            beforeQuery: ({ context }) => {
                const tenant = (context.user as { tenant?: string } | undefined)?.tenant;
                if (!tenant) return;
                return { filter: { tenant: ["==", tenant] } };
            },
            beforeSave: ({ status, id, values }) => {
                seen.push({ status, id });
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
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, user);
}

type Stored = { title: string; tenant: string; active: boolean; created_by: string | null; created_at: string | null };
const rowOf = async (id: number): Promise<Stored | undefined> =>
    (await db.query<Stored>(
        "SELECT title, tenant, active, created_by, created_at::text FROM docs WHERE id = $1", [id])).rows[0];

/** Alice's row in tenant a, and Carol's in tenant b (hidden from tenant a). */
let visible: number;
let hidden: number;

beforeEach(async () => {
    seen = [];
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE docs (id serial PRIMARY KEY, title varchar, tenant varchar,
                           active boolean, created_by varchar, created_at timestamptz);
        INSERT INTO docs (title, tenant, active, created_by, created_at) VALUES
            ('alpha', 'a', false, 'alice', '2020-01-01T00:00:00Z'),
            ('gamma', 'b', false, 'carol', '2020-01-01T00:00:00Z');
    `);
    visible = (await db.query<{ id: number }>("SELECT id FROM docs WHERE tenant = 'a'")).rows[0].id;
    hidden = (await db.query<{ id: number }>("SELECT id FROM docs WHERE tenant = 'b'")).rows[0].id;
});

afterEach(async () => {
    await db.close();
});

describe("create(values, id) inserts the row under that id", () => {
    it("in-process `data.x.create(values, id)` of a new id inserts it", async () => {
        const created = await driverOver(db).data.collection("docs").create({ title: "fresh", tenant: "a" }, 999);

        expect(created.id).toBe(999);
        const row = await rowOf(999);
        expect(row).toMatchObject({ title: "fresh", tenant: "a", active: true, created_by: null });
        expect(row?.created_at).not.toBeNull();
        expect(seen).toEqual([{ status: "new", id: 999 }]);
    });

    it("save({ id, status: 'new' }) — the MCP and socket shape — inserts a new id", async () => {
        const saved = await driverOver(db, BOB_A).save({
            path: "docs", id: "500", values: { title: "via-socket", tenant: "a" }, status: "new"
        });

        expect(saved.id).toBe(500);
        expect(await rowOf(500)).toMatchObject({ title: "via-socket", active: true, created_by: "bob" });
    });

    it("an id that already exists is a 409, and the stored row is untouched", async () => {
        await expect(driverOver(db, BOB_A).save({
            path: "docs", id: String(visible), values: { title: "via-create", tenant: "a" }, status: "new"
        })).rejects.toMatchObject({ statusCode: 409 });

        const row = await rowOf(visible);
        expect(row).toMatchObject({ title: "alpha", active: false, created_by: "alice" });
        expect(row?.created_at?.startsWith("2020-01-01")).toBe(true);
    });

    it("an id of a row the caller's beforeQuery hides is never written", async () => {
        await expect(driverOver(db, BOB_A).save({
            path: "docs", id: String(hidden), values: { title: "x", tenant: "a" }, status: "new"
        })).rejects.toMatchObject({ statusCode: 409 });

        expect(await rowOf(hidden)).toMatchObject({ title: "gamma", tenant: "b", active: false, created_by: "carol" });
    });

    it("status 'copy' with an id is a create too", async () => {
        await driverOver(db, BOB_A).save({
            path: "docs", id: "777", values: { title: "copied", tenant: "a" }, status: "copy"
        });

        expect(await rowOf(777)).toMatchObject({ title: "copied", created_by: "bob" });
    });

    it("status 'existing' with an id is still the update", async () => {
        await driverOver(db, BOB_A).save({
            path: "docs", id: String(visible), values: { title: "edited" }, status: "existing"
        });

        expect(await rowOf(visible)).toMatchObject({ title: "edited", active: false, created_by: "alice" });
    });
});
