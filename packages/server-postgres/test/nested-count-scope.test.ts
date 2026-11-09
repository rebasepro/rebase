import { describe, expect, it } from "@jest/globals";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { recordingDb } from "./helpers/spg-b-recording-db";

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
const authorsCollection: CollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number", isId: "increment" },
        posts: { type: "relation" }
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
};

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        author: { type: "relation" }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => authorsCollection, localKey: "author_id" }
    ]
};

/** A database that records the count a read composed, and answers 0 rows. */
function countingDb() {
    const recording = recordingDb(() => [[0]]);
    /** The WHERE clause of the count statement, or `undefined` when it composed none. */
    const where = () => {
        const count = recording.statements().find(q => /^\s*select count/i.test(q.text));
        if (!count) throw new Error("no count was issued");
        return /\swhere\s([\s\S]*)$/i.exec(count.text)?.[1];
    };
    return { db: recording.db, where };
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
        const { db, where } = countingDb();
        const service = new FetchService(db, registry);

        await service.count("authors/1/posts");

        expect(where()).toBeDefined();
    });

    it("composes no WHERE for the unscoped listing, so the two differ", async () => {
        // The contrast is the point: if `posts` and `authors/1/posts` counted
        // the same way, the scope was not applied.
        const registry = serviceFor();
        const { db, where } = countingDb();
        const service = new FetchService(db, registry);

        await service.count("posts");

        expect(where()).toBeUndefined();
    });

    it("adds the scope on top of a filter rather than in place of it", async () => {
        // Asserting "a WHERE exists" would not discriminate here — the filter
        // alone produces one. The scoped and unscoped counts of the *same*
        // filter have to differ, which is only true if the scope was added.
        const filter = { filter: { title: ["==", "Hello"] as ["==", string] } };

        const scoped = countingDb();
        await new FetchService(scoped.db, serviceFor()).count("authors/1/posts", filter);

        const unscoped = countingDb();
        await new FetchService(unscoped.db, serviceFor()).count("posts", filter);

        expect(scoped.where()).toBeDefined();
        expect(unscoped.where()).toBeDefined();
        expect(scoped.where()).not.toEqual(unscoped.where());
        expect(scoped.where()).toContain("author_id");
    });
});
