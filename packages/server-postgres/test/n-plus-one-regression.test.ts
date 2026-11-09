/**
 * N+1 Query Regression Test
 *
 * Validates that batch-loading of owning relations (e.g. posts → author)
 * uses O(1) SQL queries instead of one query per entity.
 *
 * Root cause of the original bug:
 *   `batchFetchRelatedEntities` for owning relations was passing parent
 *   entity IDs (post IDs) to the query instead of the FK values (author IDs).
 *   This meant `WHERE authors.id IN (1,2,3,...50)` used post IDs — completely
 *   wrong. The fix reads FK values from the parent table first, then queries
 *   the target table with correct FK values.
 */
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import type { CollectionConfig, ResolvedRelation } from "@rebasepro/types";
import { resolveCollectionRelations } from "@rebasepro/common";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { arrayRowsFor, recordingDb, type RecordedQuery } from "./helpers/spg-b-recording-db";

// ─── Tables ───────────────────────────────────────────────────────
const authorsTable = pgTable("authors", { id: integer("id").primaryKey(), name: text("name") });
const postsTable = pgTable("posts", { id: integer("id").primaryKey(), title: text("title"), authorId: integer("author_id") });

// ─── Collections ──────────────────────────────────────────────────
const authorsCollection: CollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number" },
        name: { type: "string" }
    }
};

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" },
        author: { type: "relation" }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => authorsCollection,
            localKey: "author_id"
        }
    ]
};

const authorRelation = (): ResolvedRelation => {
    const relation = resolveCollectionRelations(postsCollection).author;
    if (!relation) throw new Error("posts.author did not resolve");
    return relation;
};

// ─── Data generators ─────────────────────────────────────────────
const NUM_POSTS = 50;
const NUM_AUTHORS = 5;

function generateMockPosts(count: number): Array<{ id: number; title: string; authorId: number | null }> {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        title: `Post ${i + 1}`,
        authorId: (i % NUM_AUTHORS) + 1
    }));
}

function generateMockAuthors(count: number): Array<{ id: number; name: string }> {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Author ${i + 1}`
    }));
}

// ─── Tests ────────────────────────────────────────────────────────
describe("N+1 Query Regression: batchFetchRelatedEntities (owning relations)", () => {
    let registry: PostgresCollectionRegistry;
    let selects: () => RecordedQuery[];

    /**
     * A database that answers the FK lookup on `posts` and the target fetch on
     * `authors`, and records every select it was sent.
     */
    function createSpiedDb(
        mockPosts: ReturnType<typeof generateMockPosts>,
        mockAuthors: ReturnType<typeof generateMockAuthors>
    ) {
        const recording = recordingDb(({ text }) => {
            if (/\sfrom "posts"/i.test(text)) return arrayRowsFor(text, mockPosts.map(p => ({ id: p.id, title: p.title, author_id: p.authorId })));
            if (/\sfrom "authors"/i.test(text)) return arrayRowsFor(text, mockAuthors);
            return [];
        });
        selects = () => recording.statements().filter(q => /^\s*select\b/i.test(q.text));
        return recording.db;
    }

    beforeEach(() => {
        registry = new PostgresCollectionRegistry([postsCollection, authorsCollection]);
        registry.registerTable(postsTable, "posts");
        registry.registerTable(authorsTable, "authors");
    });

    it("should use exactly 2 SQL queries for owning relation batch fetch (not N+1)", async () => {
        const mockPosts = generateMockPosts(NUM_POSTS);
        const mockAuthors = generateMockAuthors(NUM_AUTHORS);
        const db = createSpiedDb(mockPosts, mockAuthors);

        const relationService = new RelationService(db, registry);

        const postIds = mockPosts.map(p => p.id);
        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            postIds,
            "author",
            authorRelation()
        );

        // Exactly 2 queries:
        //   1. SELECT id, author_id FROM posts WHERE id IN (...)  — FK lookup
        //   2. SELECT * FROM authors WHERE id IN (...)             — target fetch
        //
        // The old broken code would have done either:
        //   - 1 wrong query (WHERE authors.id IN (post_ids) — wrong IDs)
        //   - Or N queries (one per entity)
        expect(selects()).toHaveLength(2);

        console.log(`[N+1 Regression] ${NUM_POSTS} posts: batchFetchRelatedEntities used ${selects().length} queries`);
    });

    it("should correctly map each post to its author via FK values", async () => {
        const mockPosts = generateMockPosts(NUM_POSTS);
        const mockAuthors = generateMockAuthors(NUM_AUTHORS);
        const db = createSpiedDb(mockPosts, mockAuthors);

        const relationService = new RelationService(db, registry);

        const postIds = mockPosts.map(p => p.id);
        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            postIds,
            "author",
            authorRelation()
        );

        // Every post should have a resolved author
        for (const post of mockPosts) {
            const authorEntity = results.get(String(post.id));
            expect(authorEntity).toBeDefined();
            expect(authorEntity!.path).toBe("authors");
            // The author ID should match the FK value, not the post ID
            expect(authorEntity!.id).toBe(String(post.authorId));
        }
    });

    it("should handle null FK values gracefully (only 1 query for FK lookup)", async () => {
        const nullFkPosts = Array.from({ length: 5 }, (_, i) => ({
            id: i + 1,
            title: `Orphan Post ${i + 1}`,
            authorId: null
        }));

        const db = createSpiedDb(nullFkPosts, []);
        const relationService = new RelationService(db, registry);

        const postIds = nullFkPosts.map(p => p.id);
        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            postIds,
            "author",
            authorRelation()
        );

        // Only 1 query (FK lookup) then early-return since all FKs are null
        expect(selects()).toHaveLength(1);
        expect(results.size).toBe(0);
    });

    it("should deduplicate FK values when multiple entities share the same relation target", async () => {
        // All 50 posts point to author 1
        const sameAuthorPosts = Array.from({ length: NUM_POSTS }, (_, i) => ({
            id: i + 1,
            title: `Post ${i + 1}`,
            authorId: 1
        }));
        const singleAuthor = [{ id: 1,
name: "Shared Author" }];

        const db = createSpiedDb(sameAuthorPosts, singleAuthor);
        const relationService = new RelationService(db, registry);

        const postIds = sameAuthorPosts.map(p => p.id);
        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            postIds,
            "author",
            authorRelation()
        );

        // Still exactly 2 queries
        expect(selects()).toHaveLength(2);

        // The FK lookup still asks for every parent…
        expect(selects()[0].values).toHaveLength(NUM_POSTS);
        // …but the target fetch must collapse the 50 identical FK values to one.
        // A query count of 2 alone does not prove this: `IN (1,1,1,…)` is also
        // one query, and it is what ships to Postgres if the dedup set is lost.
        expect(selects()[1].values).toEqual([1]);

        // All 50 posts should resolve to the same author
        for (const post of sameAuthorPosts) {
            const authorEntity = results.get(String(post.id));
            expect(authorEntity).toBeDefined();
            expect(authorEntity!.id).toBe("1");
            expect(authorEntity!.path).toBe("authors");
        }
    });

    it("should handle empty parent IDs array without any queries", async () => {
        const db = createSpiedDb([], []);
        const relationService = new RelationService(db, registry);

        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            [],
            "author",
            authorRelation()
        );

        expect(selects()).toHaveLength(0);
        expect(results.size).toBe(0);
    });
});
