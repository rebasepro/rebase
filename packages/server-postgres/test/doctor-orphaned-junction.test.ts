/**
 * `rebase doctor` names a junction table no collection declares.
 *
 * Renaming a many-to-many, or removing one, leaves its junction behind: push
 * and boot only create, so the old table stays with every link row in it and
 * nothing points at it. The `orphaned_junction` category existed, with a
 * label, and nothing ever produced it.
 *
 * The database is PGlite, provisioned by the boot ensure itself, behind the
 * `pg.Pool` the doctor opens.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionTables } from "../src/schema/ensure-collection-tables";
import { checkCollectionsVsDatabase } from "../src/schema/doctor";

let mockDb: PGlite | undefined;
jest.mock("pg", () => {
    class Pool {
        async query(text: string, values?: unknown[]) {
            if (!mockDb) throw new Error("no database");
            const result = await mockDb.query(text, values);
            return { rows: result.rows };
        }
        async end() { /* the test owns the database */ }
    }
    return { Pool };
});

const tags = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: {
        id: { type: "string", isId: "uuid" },
        name: { type: "string" }
    }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string" },
        tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
} as unknown as CollectionConfig;

const URL = "postgres://doctor.test/db";

async function provision(collections: CollectionConfig[]): Promise<PGlite> {
    const db = mockDb!;
    const outcome = await ensureCollectionTables({
        query: async <T = unknown>(sql: string) => ({ rows: (await db.query<T>(sql)).rows })
    }, collections);
    expect(outcome.failures).toEqual([]);
    return db;
}

/** A junction shaped exactly as the planner shapes one, under a name nothing declares. */
const HAND_MADE_JUNCTION = `CREATE TABLE "public"."old_post_tags" (
    "post_id" uuid NOT NULL REFERENCES "public"."posts"("id") ON DELETE CASCADE,
    "tag_id" uuid NOT NULL REFERENCES "public"."tags"("id") ON DELETE CASCADE,
    PRIMARY KEY ("post_id", "tag_id"))`;

describe("the doctor's orphaned-junction check", () => {
    beforeEach(async () => {
        mockDb = new PGlite();
        await mockDb.waitReady;
        await mockDb.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
    });

    afterEach(async () => {
        await mockDb?.close();
        mockDb = undefined;
    });

    const orphans = async (collections: CollectionConfig[]) =>
        (await checkCollectionsVsDatabase(collections, URL)).issues
            .filter(issue => issue.category === "orphaned_junction");

    it("names a hand-made junction between two collection tables, as info, with the DROP shown", async () => {
        const db = await provision([posts, tags]);
        await db.exec(HAND_MADE_JUNCTION);

        const phase = await checkCollectionsVsDatabase([posts, tags], URL);
        const found = phase.issues.filter(issue => issue.category === "orphaned_junction");
        expect(found).toEqual([expect.objectContaining({
            severity: "info",
            category: "orphaned_junction",
            table: "old_post_tags",
            fix: 'DROP TABLE "public"."old_post_tags";'
        })]);
        expect(found[0].message).toContain("posts");
        expect(found[0].message).toContain("tags");
        // A note, not drift: the phase still passes.
        expect(phase.passed).toBe(true);
    });

    it("says nothing about the junction a collection declares", async () => {
        await provision([posts, tags]);
        expect(await orphans([posts, tags])).toEqual([]);
    });

    it("leaves a table with other columns alone — that is a table, not a junction", async () => {
        const db = await provision([posts, tags]);
        await db.exec(`CREATE TABLE "public"."post_tag_votes" (
            "post_id" uuid NOT NULL REFERENCES "public"."posts"("id"),
            "tag_id" uuid NOT NULL REFERENCES "public"."tags"("id"),
            "votes" integer NOT NULL DEFAULT 0,
            PRIMARY KEY ("post_id", "tag_id"))`);
        expect(await orphans([posts, tags])).toEqual([]);
    });

    it("leaves a pair of links with no composite key alone", async () => {
        const db = await provision([posts, tags]);
        await db.exec(`CREATE TABLE "public"."post_tag_log" (
            "post_id" uuid NOT NULL REFERENCES "public"."posts"("id"),
            "tag_id" uuid NOT NULL REFERENCES "public"."tags"("id"))`);
        expect(await orphans([posts, tags])).toEqual([]);
    });

    it("leaves a link to a table no collection declares alone", async () => {
        const db = await provision([posts, tags]);
        await db.exec('CREATE TABLE "public"."legacy" ("id" uuid PRIMARY KEY)');
        await db.exec(`CREATE TABLE "public"."post_legacy" (
            "post_id" uuid NOT NULL REFERENCES "public"."posts"("id"),
            "legacy_id" uuid NOT NULL REFERENCES "public"."legacy"("id"),
            PRIMARY KEY ("post_id", "legacy_id"))`);
        expect(await orphans([posts, tags])).toEqual([]);
    });
});
