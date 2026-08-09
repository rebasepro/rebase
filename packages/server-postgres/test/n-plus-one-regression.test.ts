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
import type { CollectionConfig, Relation } from "@rebasepro/types";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";

// The `where()` mock below is a no-op that returns the chain, so nothing about
// the emitted predicate is otherwise observable: sending 50 duplicate FK values
// instead of 1 looks exactly like sending 1. Spying on the real `inArray` (which
// still runs) is what lets the dedup assertions see the id list.
jest.mock("drizzle-orm", () => {
    const actual = jest.requireActual("drizzle-orm");
    return { ...actual,
        inArray: jest.fn((...args: unknown[]) => (actual.inArray as (...a: unknown[]) => unknown)(...args)) };
});

const inArrayMock = inArray as unknown as jest.Mock;

/** Values the Nth `inArray(column, values)` call was given. */
function inArrayValues(callIndex: number): unknown[] {
    expect(inArrayMock.mock.calls.length).toBeGreaterThan(callIndex);
    return inArrayMock.mock.calls[callIndex][1] as unknown[];
}

// ─── Mock Tables ──────────────────────────────────────────────────
const mockAuthorsTable = {
    id: { name: "id",
dataType: "number" },
    name: { name: "name" },
    _def: { tableName: "authors" }
};

const mockPostsTable = {
    id: { name: "id",
dataType: "number" },
    title: { name: "title" },
    authorId: { name: "author_id",
dataType: "number" },
    _def: { tableName: "posts" }
};

// ─── Mock Collections ─────────────────────────────────────────────
let authorsCollection: CollectionConfig;

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" },
        author: {
            type: "relation",
            relationName: "author"
        }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => authorsCollection,
            localKey: "author_id"
        }
    ],
    idField: "id"
};

authorsCollection = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number" },
        name: { type: "string" }
    },
    idField: "id"
};

// ─── Data generators ─────────────────────────────────────────────
const NUM_POSTS = 50;
const NUM_AUTHORS = 5;

function generateMockPosts(count: number): Array<{ id: number; title: string; authorId: number }> {
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
    let selectCallCount: number;

    /**
     * Creates a mock Drizzle database that counts `select()` calls.
     * Routes responses based on the table being queried.
     */
    function createSpiedDb(
        mockPosts: ReturnType<typeof generateMockPosts>,
        mockAuthors: ReturnType<typeof generateMockAuthors>
    ) {
        selectCallCount = 0;
        let currentFromTable: string | undefined;
        let currentSelectColumns: Record<string, unknown> | undefined;

        function resolveResults(): unknown[] {
            if (currentFromTable === "posts") {
                // If selecting specific columns (parentId, fkValue shape from the FK lookup)
                if (currentSelectColumns && Object.keys(currentSelectColumns).some(k => k === "parentId" || k === "fkValue")) {
                    return mockPosts.map(p => ({
                        parentId: p.id,
                        fkValue: p.authorId
                    }));
                }
                return mockPosts;
            }
            if (currentFromTable === "authors") {
                return mockAuthors;
            }
            return [];
        }

        function makeChainable(): Record<string, unknown> {
            const chain: Record<string, unknown> = {
                select: jest.fn((columns?: Record<string, unknown>) => {
                    selectCallCount++;
                    currentSelectColumns = columns;
                    return chain;
                }),
                from: jest.fn((table: Record<string, unknown>) => {
                    const tableDef = table._def as { tableName: string } | undefined;
                    currentFromTable = tableDef?.tableName ?? "unknown";
                    return chain;
                }),
                where: jest.fn(() => chain),
                $dynamic: jest.fn(() => chain),
                limit: jest.fn(() => chain),
                offset: jest.fn(() => chain),
                orderBy: jest.fn(() => chain),
                innerJoin: jest.fn(() => chain),
                // Make it thenable so `await query` resolves to results
                then: (resolve: (val: unknown[]) => void) => {
                    resolve(resolveResults());
                }
            };
            return chain;
        }

        return makeChainable() as unknown as jest.Mocked<NodePgDatabase>;
    }

    beforeEach(() => {
        inArrayMock.mockClear();
        registry = new PostgresCollectionRegistry();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("posts")) return postsCollection;
            if (path?.startsWith("authors")) return authorsCollection;
            return undefined;
        });

        jest.spyOn(registry, "getTable").mockImplementation(tableName => {
            if (tableName === "posts") return mockPostsTable as unknown as ReturnType<typeof registry.getTable>;
            if (tableName === "authors") return mockAuthorsTable as unknown as ReturnType<typeof registry.getTable>;
            return undefined;
        });

        jest.spyOn(registry, "getCollections").mockReturnValue([postsCollection, authorsCollection]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should use exactly 2 SQL queries for owning relation batch fetch (not N+1)", async () => {
        const mockPosts = generateMockPosts(NUM_POSTS);
        const mockAuthors = generateMockAuthors(NUM_AUTHORS);
        const db = createSpiedDb(mockPosts, mockAuthors);

        const relationService = new RelationService(db, registry);
        selectCallCount = 0;

        const postIds = mockPosts.map(p => p.id);
        const authorRelation = postsCollection.relations![0] as Relation;

        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            postIds,
            "author",
            authorRelation
        );

        // Exactly 2 queries:
        //   1. SELECT id, author_id FROM posts WHERE id IN (...)  — FK lookup
        //   2. SELECT * FROM authors WHERE id IN (...)             — target fetch
        //
        // The old broken code would have done either:
        //   - 1 wrong query (WHERE authors.id IN (post_ids) — wrong IDs)
        //   - Or N queries (one per entity)
        expect(selectCallCount).toBe(2);

        console.log(`[N+1 Regression] ${NUM_POSTS} posts: batchFetchRelatedEntities used ${selectCallCount} queries`);
    });

    it("should correctly map each post to its author via FK values", async () => {
        const mockPosts = generateMockPosts(NUM_POSTS);
        const mockAuthors = generateMockAuthors(NUM_AUTHORS);
        const db = createSpiedDb(mockPosts, mockAuthors);

        const relationService = new RelationService(db, registry);

        const postIds = mockPosts.map(p => p.id);
        const authorRelation = postsCollection.relations![0] as Relation;

        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            postIds,
            "author",
            authorRelation
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
            authorId: null as unknown as number
        }));

        const db = createSpiedDb(nullFkPosts as ReturnType<typeof generateMockPosts>, []);
        const relationService = new RelationService(db, registry);
        selectCallCount = 0;

        const postIds = nullFkPosts.map(p => p.id);
        const authorRelation = postsCollection.relations![0] as Relation;

        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            postIds,
            "author",
            authorRelation
        );

        // Only 1 query (FK lookup) then early-return since all FKs are null
        expect(selectCallCount).toBe(1);
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
        selectCallCount = 0;

        const postIds = sameAuthorPosts.map(p => p.id);
        const authorRelation = postsCollection.relations![0] as Relation;

        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            postIds,
            "author",
            authorRelation
        );

        // Still exactly 2 queries
        expect(selectCallCount).toBe(2);

        // The FK lookup still asks for every parent…
        expect(inArrayValues(0)).toHaveLength(NUM_POSTS);
        // …but the target fetch must collapse the 50 identical FK values to one.
        // A query count of 2 alone does not prove this: `IN (1,1,1,…)` is also
        // one query, and it is what ships to Postgres if the dedup set is lost.
        expect(inArrayValues(1)).toEqual([1]);

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
        selectCallCount = 0;

        const authorRelation = postsCollection.relations![0] as Relation;

        const results = await relationService.batchFetchRelatedEntities(
            "posts",
            [],
            "author",
            authorRelation
        );

        expect(selectCallCount).toBe(0);
        expect(results.size).toBe(0);
    });
});
