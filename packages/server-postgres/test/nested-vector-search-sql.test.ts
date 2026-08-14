import { describe, expect, it, jest } from "@jest/globals";
import { integer, pgTable, serial, varchar, vector } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A nested listing's vector search reaches the SQL, scope and all.
 *
 * `GET /authors/1/posts?vector_search=…` has two narrowings to apply and no
 * route of its own to apply them: the relation scope, and the distance
 * ordering. `fetchCollectionForRest` resolves the nested path and hands both to
 * the same builder the root read uses — but only if the parameter is passed in
 * the first place, which the subcollection route did not do.
 *
 * Forwarding is asserted over HTTP in `packages/server/test/
 * rest-vector-search-nested.test.ts`. What that cannot see is whether the two
 * narrowings survive together once they arrive: a query ordered by distance but
 * unscoped would return another author's posts, and a scoped query ordered by
 * `id DESC` is the silent downgrade with extra steps.
 */

const postsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    authorId: integer("author_id"),
    embedding: vector("embedding", { dimensions: 3 })
});

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
        embedding: { type: "vector", dimensions: 3 },
        author: { type: "relation", relationName: "author" }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => authorsCollection, localKey: "author_id" }
    ]
} as unknown as CollectionConfig;

/** A db that records the query a read composed, and answers no rows. */
function recordingDb() {
    const seen: { select?: unknown; where?: unknown; orderBy?: unknown[] } = {};
    const chain: Record<string, unknown> = {};
    chain.from = jest.fn(() => chain);
    chain.$dynamic = jest.fn(() => chain);
    chain.where = jest.fn((cond: unknown) => { seen.where = cond; return chain; });
    chain.orderBy = jest.fn((...order: unknown[]) => { seen.orderBy = order; return chain; });
    chain.limit = jest.fn(() => chain);
    chain.offset = jest.fn(() => chain);
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve([]);
    return { db: { select: jest.fn((projection?: unknown) => { seen.select = projection; return chain; }) }, seen };
}

function registryFor() {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([authorsCollection, postsCollection]);
    registry.registerTable(postsTable, "posts");
    return registry;
}

const vectorSearch = { property: "embedding", vector: [0.1, 0.2, 0.3], threshold: 0.2 };

/** The rendered SQL text of a composed node, chunks and all. */
function sqlText(node: unknown): string {
    if (node === null || node === undefined) return "";
    if (typeof node !== "object") return String(node);
    if (Array.isArray(node)) return node.map(sqlText).join(" ");
    const anyNode = node as { value?: unknown; queryChunks?: unknown[]; name?: unknown };
    if (Array.isArray(anyNode.queryChunks)) return anyNode.queryChunks.map(sqlText).join("");
    if (Array.isArray(anyNode.value)) return anyNode.value.join("");
    if (typeof anyNode.name === "string") return anyNode.name;
    return "";
}

describe("a nested listing with a vector search", () => {
    it("orders by distance rather than by id", async () => {
        const { db, seen } = recordingDb();

        await new FetchService(db as never, registryFor())
            .fetchCollectionForRest("authors/1/posts", { vectorSearch });

        expect(sqlText(seen.orderBy)).toContain("<=>");
    });

    it("selects the distance alongside the row, so `_distance` has a value to carry", async () => {
        const { db, seen } = recordingDb();

        await new FetchService(db as never, registryFor())
            .fetchCollectionForRest("authors/1/posts", { vectorSearch });

        expect(sqlText((seen.select as { _distance?: unknown })?._distance)).toContain("<=>");
    });

    it("keeps the parent scope while it does so", async () => {
        // The failure this guards is not "no rows": it is another author's
        // posts, ordered impeccably by distance.
        const { db, seen } = recordingDb();

        await new FetchService(db as never, registryFor())
            .fetchCollectionForRest("authors/1/posts", { vectorSearch });

        expect(sqlText(seen.where)).toContain("author_id");
    });

    it("applies the threshold to the same WHERE", async () => {
        const { db, seen } = recordingDb();

        await new FetchService(db as never, registryFor())
            .fetchCollectionForRest("authors/1/posts", { vectorSearch });

        expect(sqlText(seen.where)).toContain(") < ");
    });
});
