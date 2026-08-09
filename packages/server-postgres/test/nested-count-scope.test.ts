import { describe, expect, it, jest } from "@jest/globals";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * `total` for a nested listing counts the parent's rows, not the table's.
 *
 * `GET /authors/:id/posts` narrows the rows to that author, and the count
 * beside them has to be narrowed the same way — `count()` pushes the relation
 * scope for exactly that reason ("the same `filter` and `searchString` too, so
 * `total` describes the rows that were actually served").
 *
 * Nothing covered it. Found by mutation: dropping
 * `if (hop) allConditions.push(this.buildRelationScope(hop))` left the whole
 * package suite green, while every subcollection listing would have reported
 * the count of the entire table — an author with three posts paging through
 * "20", and `hasMore` sending the reader into empty pages.
 *
 * The db is a recorder: `count()` composes a `where` and this asserts that a
 * condition was composed at all, and that it is the scope rather than nothing.
 */

const postsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    authorId: integer("author_id")
});

// Declared lazily so the two collections can name each other.
const authorsCollection = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    idField: "id",
    properties: {
        id: { type: "number", isId: "increment" },
        posts: { type: "relation", relationName: "posts" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            target: () => postsCollection,
            foreignKeyOnTarget: "author_id"
        }
    ]
} as unknown as CollectionConfig;

const postsCollection = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    idField: "id",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        author: { type: "relation", relationName: "author" }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => authorsCollection, localKey: "author_id" }
    ]
} as unknown as CollectionConfig;

/** A db that records the `where` a count composed, and answers 0 rows. */
function recordingDb() {
    const seen: { where: unknown } = { where: undefined };
    const chain: Record<string, unknown> = {};
    chain.from = jest.fn(() => chain);
    chain.$dynamic = jest.fn(() => chain);
    chain.where = jest.fn((cond: unknown) => { seen.where = cond; return chain; });
    // Awaiting the builder resolves to the count rows.
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve([{ count: 0 }]);
    return { db: { select: jest.fn(() => chain) }, seen, chain };
}

function serviceFor() {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([authorsCollection, postsCollection]);
    registry.registerTable(postsTable, "posts");
    return registry;
}

describe("a nested listing's count is scoped to its parent", () => {
    it("composes a WHERE for `authors/1/posts`", async () => {
        const registry = serviceFor();
        const { db, seen } = recordingDb();
        const service = new FetchService(db as never, registry);

        await service.count("authors/1/posts");

        expect(seen.where).toBeDefined();
    });

    it("composes no WHERE for the unscoped listing, so the two differ", async () => {
        // The contrast is the point: if `posts` and `authors/1/posts` counted
        // the same way, the scope was not applied.
        const registry = serviceFor();
        const { db, seen } = recordingDb();
        const service = new FetchService(db as never, registry);

        await service.count("posts");

        expect(seen.where).toBeUndefined();
    });

    it("adds the scope on top of a filter rather than in place of it", async () => {
        // Asserting "a WHERE exists" would not discriminate here — the filter
        // alone produces one. The scoped and unscoped counts of the *same*
        // filter have to differ, which is only true if the scope was added.
        const filter = { filter: { title: ["==", "Hello"] } } as never;

        const scoped = recordingDb();
        await new FetchService(scoped.db as never, serviceFor()).count("authors/1/posts", filter);

        const unscoped = recordingDb();
        await new FetchService(unscoped.db as never, serviceFor()).count("posts", filter);

        const sql = (c: unknown) => JSON.stringify((c as { queryChunks?: unknown[] })?.queryChunks?.length ?? 0);
        expect(scoped.seen.where).toBeDefined();
        expect(unscoped.seen.where).toBeDefined();
        expect(sql(scoped.seen.where)).not.toEqual(sql(unscoped.seen.where));
    });
});
