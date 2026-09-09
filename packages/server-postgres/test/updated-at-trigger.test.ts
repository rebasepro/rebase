/**
 * `autoValue: "on_update"` against a real Postgres.
 *
 * The driver has always stamped `updated_at` on its own writes, and that has to
 * stay: a `beforeSave` hook reads the row it is about to persist, and a value
 * that only appears once Postgres has written it is a value the hook cannot
 * see. But the driver is not the only writer. A seed script, a migration
 * backfill, a `psql` session, one row fixed by hand — every one of those left
 * the column claiming the row had not changed since a date that was simply
 * wrong, and anything reading it to decide what to re-index, re-sync or re-send
 * skipped the row.
 *
 * So the test is the one thing a unit test cannot fake: a raw `UPDATE`, issued
 * by nothing that knows about Rebase, has to move the column. PGlite is a real
 * Postgres, which is what makes the answer mean something — `jsonb_populate_record`
 * on `NEW`, `TG_ARGV`, and the `BEFORE UPDATE` timing are all server behaviour.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import {
    generatePostgresDdl,
    generatePostgresTriggersDdl
} from "../src/schema/generate-postgres-ddl-logic";
import {
    ensureCollectionTables,
    readExistingSchema,
    planCollectionSchemaEnsure
} from "../src/schema/ensure-collection-tables";

const posts: CollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string" },
        createdAt: { type: "date", autoValue: "on_create" },
        updatedAt: { type: "date", autoValue: "on_update" }
    }
} as unknown as CollectionConfig;

/** PGlite's handle, as the ensure path's `Queryable`. */
const queryable = (db: PGlite) => ({
    query: async <T = unknown>(sql: string) => {
        const result = await db.query<T>(sql);
        return { rows: result.rows };
    }
});

describe("`autoValue: \"on_update\"` is a database trigger", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterEach(async () => {
        await db.close();
    });

    it("bumps the column on a raw UPDATE nothing in Rebase issued", async () => {
        await db.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
        await db.exec(generatePostgresDdl([posts], { includePolicies: false }));
        await db.exec(generatePostgresTriggersDdl([posts]));

        // An old timestamp written straight in, so the assertion cannot pass on
        // the insert's own `now()`.
        await db.exec(
            `INSERT INTO "public"."posts" ("title", "updated_at") ` +
            `VALUES ('first', '2000-01-01T00:00:00Z');`
        );
        const before = await db.query<{ updated_at: string }>(`SELECT "updated_at" FROM "public"."posts";`);
        expect(new Date(before.rows[0].updated_at).getUTCFullYear()).toBe(2000);

        await db.exec(`UPDATE "public"."posts" SET "title" = 'second';`);

        const after = await db.query<{ updated_at: string }>(`SELECT "updated_at" FROM "public"."posts";`);
        expect(new Date(after.rows[0].updated_at).getUTCFullYear())
            .toBeGreaterThan(2000);
    });

    it("leaves a column with no `on_update` alone", async () => {
        await db.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
        await db.exec(generatePostgresDdl([posts], { includePolicies: false }));
        await db.exec(generatePostgresTriggersDdl([posts]));

        await db.exec(
            `INSERT INTO "public"."posts" ("title", "created_at") ` +
            `VALUES ('first', '2000-01-01T00:00:00Z');`
        );
        await db.exec(`UPDATE "public"."posts" SET "title" = 'second';`);

        // `on_create` is a DEFAULT, not a trigger: it fills the column in on
        // insert and never touches it again.
        const rows = await db.query<{ created_at: string }>(`SELECT "created_at" FROM "public"."posts";`);
        expect(new Date(rows.rows[0].created_at).getUTCFullYear()).toBe(2000);
    });

    it("is installed by the boot-time ensure, and only once", async () => {
        const client = queryable(db);

        const first = await ensureCollectionTables(client, [posts]);
        expect(first.failures).toEqual([]);
        expect(first.actions.filter(a => a.kind === "create-trigger").length).toBeGreaterThan(0);

        await db.exec(
            `INSERT INTO "public"."posts" ("title", "updated_at") ` +
            `VALUES ('first', '2000-01-01T00:00:00Z');`
        );
        await db.exec(`UPDATE "public"."posts" SET "title" = 'second';`);
        const rows = await db.query<{ updated_at: string }>(`SELECT "updated_at" FROM "public"."posts";`);
        expect(new Date(rows.rows[0].updated_at).getUTCFullYear()).toBeGreaterThan(2000);

        // Re-running the ensure is a no-op — the whole reason it is safe on
        // every boot. A trigger re-issued each time would work and would report
        // a change on a database that has none.
        const existing = await readExistingSchema(client, ["public"]);
        const again = planCollectionSchemaEnsure([posts], existing);
        expect(again.actions.filter(a => a.kind === "create-trigger")).toEqual([]);
    });
});
