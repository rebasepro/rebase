/**
 * Boot gives a uuid key the default it is missing.
 *
 * A collection whose key is `isId: "uuid"` writes no key: the database fills
 * it with `gen_random_uuid()`. A table adopted by introspection, or created by
 * hand, can carry the key column with no default, and boot never touched a
 * declared key's default (keys are excluded from the per-column pass), so the
 * first create failed on a NULL primary key. Only the implicit key of a
 * collection that declares none was converged.
 *
 * `SET DEFAULT` binds future writes only, so it cannot fail on data. The uuid
 * generator is built into Postgres, so it cannot fail at boot either. A SQL
 * strategy (``isId: "sql`my_id()`"``) is left alone: its function may not
 * exist yet, and setting it would turn an insert-time failure into a boot
 * failure.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";

import { ensureCollectionTables } from "../src/schema/ensure-collection-tables";

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(sql: string) => ({ rows: (await db.query<T>(sql)).rows })
});

const collectionWithKey = (isId: string): CollectionConfig => ({
    slug: "tickets",
    table: "tickets",
    name: "Tickets",
    properties: {
        id: { type: "string", isId },
        title: { type: "string" }
    }
}) as CollectionConfig;

async function keyDefault(db: PGlite): Promise<string | null> {
    const result = await db.query<{ column_default: string | null }>(
        "SELECT column_default FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'id'"
    );
    return result.rows[0]?.column_default ?? null;
}

describe("boot on a table whose declared key has no default", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterEach(async () => {
        await db.close();
    });

    it("gives an `isId: \"uuid\"` key its default, so a row with no key can be created", async () => {
        await db.exec('CREATE TABLE "public"."tickets" ("id" UUID PRIMARY KEY, "title" TEXT);');
        const outcome = await ensureCollectionTables(queryable(db), [collectionWithKey("uuid")]);
        expect(outcome.failures).toEqual([]);
        expect(await keyDefault(db)).toBe("gen_random_uuid()");
        await db.exec("INSERT INTO \"public\".\"tickets\" (\"title\") VALUES ('first');");
        const rows = await db.query<{ id: string }>('SELECT id FROM "public"."tickets"');
        expect(rows.rows).toHaveLength(1);
    });

    it("leaves a SQL strategy's key alone: its function may not exist yet", async () => {
        await db.exec('CREATE TABLE "public"."tickets" ("id" TEXT PRIMARY KEY, "title" TEXT);');
        const outcome = await ensureCollectionTables(queryable(db), [collectionWithKey("sql`make_ticket_id()`")]);
        expect(outcome.failures).toEqual([]);
        expect(await keyDefault(db)).toBeNull();
    });

    it("leaves a manual key alone: the caller sends it", async () => {
        await db.exec('CREATE TABLE "public"."tickets" ("id" TEXT PRIMARY KEY, "title" TEXT);');
        const outcome = await ensureCollectionTables(queryable(db), [collectionWithKey("manual")]);
        expect(outcome.failures).toEqual([]);
        expect(await keyDefault(db)).toBeNull();
    });
});
