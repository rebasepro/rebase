/**
 * Regression tests for batchFetchRelatedEntitiesMany
 *
 * Root cause of the original bug:
 *   `batchFetchRelatedEntitiesMany` only had two code paths:
 *     1. `relation.joinPath` — custom multi-hop join path
 *     2. FK-based fallback — delegated to `buildRelationQuery`, then extracted
 *        parentId from `foreignKeyOnTarget` / `inverseRelationName`
 *
 *   Many-to-many owning relations (e.g. posts→tags via posts_tags junction)
 *   use `relation.through` — NOT `joinPath`, and NOT an inverse FK.
 *   The FK fallback would:
 *     - Correctly JOIN through the junction table (via buildRelationQuery)
 *     - But FAIL to extract parentId from the result rows because
 *       `relation.direction === "owning"`, so lines checking
 *       `direction === "inverse"` were skipped
 *     - parentId stayed `undefined`, all results were silently dropped
 *
 *   The same gap existed for inverse M2M with `through`.
 *
 *   Fix: Added a dedicated `through` handler before the FK fallback that
 *   queries junction→target directly and extracts parentId from the junction
 *   table's sourceColumn/targetColumn.
 */
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { CollectionConfig, Relation } from "@rebasepro/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

// ─── Mock Tables ──────────────────────────────────────────────────────
const mockPostsTable = {
    id: { name: "id",
dataType: "number" },
    title: { name: "title" },
    _def: { tableName: "posts" }
};

const mockTagsTable = {
    id: { name: "id",
dataType: "number" },
    name: { name: "name" },
    _def: { tableName: "tags" }
};

const mockPostsTagsTable = {
    post_id: { name: "post_id",
dataType: "number" },
    tag_id: { name: "tag_id",
dataType: "number" },
    _def: { tableName: "posts_tags" }
};

const mockAuthorsTable = {
    id: { name: "id",
dataType: "number" },
    name: { name: "name" },
    _def: { tableName: "authors" }
};

const mockAuthorPostsTable = {
    author_id: { name: "author_id",
dataType: "number" },
    post_id: { name: "post_id",
dataType: "number" },
    _def: { tableName: "author_posts" }
};

// ─── Mock Collections ─────────────────────────────────────────────────

const tagsCollection: CollectionConfig = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: {
        id: { type: "number" },
        name: { type: "string" }
    },
    idField: "id"
};

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" },
        tags: { type: "relation",
relationName: "tags" }
    },
    relations: [
        {
            kind: "manyToMany",
            relationName: "tags",
            target: () => tagsCollection,
            through: {
                table: "posts_tags",
                sourceColumn: "post_id",
                targetColumn: "tag_id"
            }
        }
    ],
    idField: "id"
};

const authorsCollection: CollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number" },
        name: { type: "string" }
    },
    idField: "id"
};

// Inverse M2M: tags → posts (from tag's perspective, "which posts use this tag?")
const tagsWithInversePosts: CollectionConfig = {
    slug: "tags_inv",
    name: "Tags (inverse)",
    table: "tags",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        posts: { type: "relation",
relationName: "posts" }
    },
    relations: [
        {
            kind: "manyToMany",
            relationName: "posts",
            target: () => postsCollection,
            // Written from the tags side: `source` names *this* collection.
            // The old model copied the other side's columns and left the
            // reader to swap them.
            through: {
                table: "posts_tags",
                sourceColumn: "tag_id",
                targetColumn: "post_id"
            }
        }
    ],
    idField: "id"
};

// JoinPath-based M2M: authors → posts via author_posts
const authorsWithJoinPath: CollectionConfig = {
    slug: "authors_jp",
    name: "Authors (joinPath)",
    table: "authors",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        posts: { type: "relation",
relationName: "posts" }
    },
    relations: [
        {
            kind: "via",
            relationName: "posts",
            target: () => postsCollection,
            cardinality: "many",
            joinPath: [
                { table: "author_posts",
on: { from: "id",
to: "author_id" } },
                { table: "posts",
on: { from: "post_id",
to: "id" } }
            ]
        }
    ],
    idField: "id"
};

// ─── Test Data Generators ─────────────────────────────────────────────

function generateJunctionRows(
    postIds: number[],
    tagIds: number[],
    junctionTableName: string,
    targetTableName: string,
    sourceCol: string,
    targetCol: string,
    targetData: Record<string, unknown>[]
) {
    // Create junction results that look like what Drizzle returns from
    // FROM junction INNER JOIN target
    const rows: Record<string, unknown>[] = [];
    for (const postId of postIds) {
        for (const tagId of tagIds) {
            const targetRow = targetData.find(t => t.id === tagId);
            if (targetRow) {
                rows.push({
                    [junctionTableName]: {
                        [sourceCol]: postId,
                        [targetCol]: tagId
                    },
                    [targetTableName]: { ...targetRow }
                });
            }
        }
    }
    return rows;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("batchFetchRelatedEntitiesMany: M2M through junction table regression", () => {
    let registry: PostgresCollectionRegistry;

    function createMockDb(resolveResults: () => unknown[]) {
        let queryRecorder = {
            selectCount: 0,
            innerJoinCount: 0,
            fromTable: undefined as string | undefined
        };

        function makeChainable(): Record<string, unknown> {
            const chain: Record<string, unknown> = {
                select: jest.fn(() => {
                    queryRecorder.selectCount++;
                    return chain;
                }),
                from: jest.fn((table: Record<string, unknown>) => {
                    const tableDef = table._def as { tableName: string } | undefined;
                    queryRecorder.fromTable = tableDef?.tableName ?? "unknown";
                    return chain;
                }),
                where: jest.fn(() => chain),
                $dynamic: jest.fn(() => chain),
                limit: jest.fn(() => chain),
                offset: jest.fn(() => chain),
                orderBy: jest.fn(() => chain),
                innerJoin: jest.fn(() => {
                    queryRecorder.innerJoinCount++;
                    return chain;
                }),
                then: (resolve: (val: unknown[]) => void) => {
                    resolve(resolveResults());
                }
            };
            return chain;
        }

        return {
            db: makeChainable() as unknown as jest.Mocked<NodePgDatabase>,
            recorder: queryRecorder
        };
    }

    beforeEach(() => {
        registry = new PostgresCollectionRegistry();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("posts")) return postsCollection;
            if (path?.startsWith("tags_inv")) return tagsWithInversePosts;
            if (path?.startsWith("tags")) return tagsCollection;
            if (path?.startsWith("authors_jp")) return authorsWithJoinPath;
            if (path?.startsWith("authors")) return authorsCollection;
            return undefined;
        });

        jest.spyOn(registry, "getTable").mockImplementation(tableName => {
            if (tableName === "posts") return mockPostsTable as any;
            if (tableName === "tags") return mockTagsTable as any;
            if (tableName === "posts_tags") return mockPostsTagsTable as any;
            if (tableName === "authors") return mockAuthorsTable as any;
            if (tableName === "author_posts") return mockAuthorPostsTable as any;
            return undefined;
        });

        jest.spyOn(registry, "getCollections").mockReturnValue([
            postsCollection, tagsCollection, authorsCollection
        ]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ━━━ Owning M2M with `through` ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("Owning M2M with `through` (posts → tags)", () => {
        const mockTags = [
            { id: 1,
name: "TypeScript" },
            { id: 2,
name: "React" },
            { id: 3,
name: "Node.js" }
        ];

        it("should return tags for each post via junction table", async () => {
            // Post 1 → tags 1,2; Post 2 → tags 2,3; Post 3 → tag 1
            const junctionRows = [
                { posts_tags: { post_id: 1,
tag_id: 1 },
tags: { id: 1,
name: "TypeScript" } },
                { posts_tags: { post_id: 1,
tag_id: 2 },
tags: { id: 2,
name: "React" } },
                { posts_tags: { post_id: 2,
tag_id: 2 },
tags: { id: 2,
name: "React" } },
                { posts_tags: { post_id: 2,
tag_id: 3 },
tags: { id: 3,
name: "Node.js" } },
                { posts_tags: { post_id: 3,
tag_id: 1 },
tags: { id: 1,
name: "TypeScript" } }
            ];

            const { db } = createMockDb(() => junctionRows);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "posts", [1, 2, 3], "tags", relation
            );

            // Post 1 should have 2 tags
            expect(results.get("1")).toHaveLength(2);
            expect(results.get("1")!.map(e => e.values.name)).toEqual(
                expect.arrayContaining(["TypeScript", "React"])
            );

            // Post 2 should have 2 tags
            expect(results.get("2")).toHaveLength(2);
            expect(results.get("2")!.map(e => e.values.name)).toEqual(
                expect.arrayContaining(["React", "Node.js"])
            );

            // Post 3 should have 1 tag
            expect(results.get("3")).toHaveLength(1);
            expect(results.get("3")![0].values.name).toBe("TypeScript");
        });

        it("should set correct entity id and path on each relation result", async () => {
            const junctionRows = [
                { posts_tags: { post_id: 1,
tag_id: 42 },
tags: { id: 42,
name: "GraphQL" } }
            ];

            const { db } = createMockDb(() => junctionRows);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "posts", [1], "tags", relation
            );

            const tags = results.get("1")!;
            expect(tags).toHaveLength(1);
            expect(tags[0].id).toBe("42");
            expect(tags[0].path).toBe("tags");
        });

        it("should use exactly 1 SQL query (junction JOIN target)", async () => {
            const junctionRows = [
                { posts_tags: { post_id: 1,
tag_id: 1 },
tags: { id: 1,
name: "TypeScript" } }
            ];

            const { db, recorder } = createMockDb(() => junctionRows);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            await service.batchFetchRelatedEntitiesMany(
                "posts", [1, 2, 3], "tags", relation
            );

            // Single SELECT from junction with innerJoin to target
            expect(recorder.selectCount).toBe(1);
            expect(recorder.innerJoinCount).toBe(1);
        });

        it("should return empty map when no junction rows exist", async () => {
            const { db } = createMockDb(() => []);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "posts", [1, 2, 3], "tags", relation
            );

            expect(results.size).toBe(0);
        });

        it("should return empty map for empty parent IDs", async () => {
            const { db, recorder } = createMockDb(() => []);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "posts", [], "tags", relation
            );

            expect(results.size).toBe(0);
            // No queries should fire
            expect(recorder.selectCount).toBe(0);
        });

        it("should handle posts where some have tags and some don't", async () => {
            const junctionRows = [
                { posts_tags: { post_id: 1,
tag_id: 1 },
tags: { id: 1,
name: "TypeScript" } },
                // Post 2 has no junction rows
                { posts_tags: { post_id: 3,
tag_id: 2 },
tags: { id: 2,
name: "React" } }
            ];

            const { db } = createMockDb(() => junctionRows);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "posts", [1, 2, 3], "tags", relation
            );

            expect(results.get("1")).toHaveLength(1);
            expect(results.has("2")).toBe(false); // No tags for post 2
            expect(results.get("3")).toHaveLength(1);
        });
    });

    // ━━━ Inverse M2M with `through` ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("Inverse M2M with `through` (tags → posts, inverse perspective)", () => {
        it("should return posts for each tag via junction table", async () => {
            // For the inverse direction, buildRelationQuery JOINs through the junction.
            // Result rows contain junction + target data.
            // The parentId (tag) is in the junction's targetColumn.
            const joinedRows = [
                { posts_tags: { post_id: 10,
tag_id: 1 },
posts: { id: 10,
title: "Post A" } },
                { posts_tags: { post_id: 20,
tag_id: 1 },
posts: { id: 20,
title: "Post B" } },
                { posts_tags: { post_id: 30,
tag_id: 2 },
posts: { id: 30,
title: "Post C" } }
            ];

            const { db } = createMockDb(() => joinedRows);
            const service = new RelationService(db, registry);
            const relation = tagsWithInversePosts.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "tags_inv", [1, 2], "posts", relation
            );

            // Tag 1 should have 2 posts
            expect(results.get("1")).toHaveLength(2);
            expect(results.get("1")!.map(e => e.values.title)).toEqual(
                expect.arrayContaining(["Post A", "Post B"])
            );

            // Tag 2 should have 1 post
            expect(results.get("2")).toHaveLength(1);
            expect(results.get("2")![0].values.title).toBe("Post C");
        });

        it("should return empty map when no junction rows exist for inverse", async () => {
            const { db } = createMockDb(() => []);
            const service = new RelationService(db, registry);
            const relation = tagsWithInversePosts.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "tags_inv", [1, 2], "posts", relation
            );

            expect(results.size).toBe(0);
        });
    });

    // ━━━ JoinPath (existing path, ensure no regression) ━━━━━━━━━━━━━━

    describe("JoinPath M2M (authors → posts via author_posts)", () => {
        it("should return posts for each author via joinPath", async () => {
            // joinPath results are namespaced differently — parent data under parent table name
            const joinedRows = [
                { authors: { id: 1,
name: "Alice" },
posts: { id: 10,
title: "Post X" } },
                { authors: { id: 1,
name: "Alice" },
posts: { id: 20,
title: "Post Y" } },
                { authors: { id: 2,
name: "Bob" },
posts: { id: 30,
title: "Post Z" } }
            ];

            const { db } = createMockDb(() => joinedRows);
            const service = new RelationService(db, registry);
            const relation = authorsWithJoinPath.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "authors_jp", [1, 2], "posts", relation
            );

            // Author 1 should have 2 posts
            expect(results.get("1")).toHaveLength(2);
            expect(results.get("1")!.map(e => e.values.title)).toEqual(
                expect.arrayContaining(["Post X", "Post Y"])
            );

            // Author 2 should have 1 post
            expect(results.get("2")).toHaveLength(1);
            expect(results.get("2")![0].values.title).toBe("Post Z");
        });
    });

    // ━━━ Error handling ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    describe("Error handling", () => {
        it("refuses a junction it cannot resolve instead of answering with no rows", async () => {
            // It used to warn and return an empty map, and an empty map is what
            // a post with no tags looks like — so a relation pointing at a table
            // that does not exist was indistinguishable from a correct answer.
            // `assertRelationsResolve` fails boot on this; if one gets past it,
            // saying so beats inventing an emptiness.
            jest.spyOn(registry, "getTable").mockImplementation(tableName => {
                if (tableName === "posts_tags") return undefined;
                if (tableName === "posts") return mockPostsTable as any;
                if (tableName === "tags") return mockTagsTable as any;
                return undefined;
            });

            const { db } = createMockDb(() => []);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            await expect(service.batchFetchRelatedEntitiesMany(
                "posts", [1], "tags", relation
            )).rejects.toMatchObject({ code: "RELATION_MISCONFIGURED" });
        });
    });

    // ━━━ ID type coercion (number vs string) ━━━━━━━━━━━━━━━━━━━━━━━━━
    // Drizzle may return junction column values as strings even when the
    // parent IDs are numeric.  The batch handler must not silently drop
    // results due to `===` mismatches (the original parsedParentIds.includes
    // bug).

    describe("ID type coercion", () => {
        it("owning M2M: should map results when junction returns string IDs but parent IDs are numbers", async () => {
            // Junction data returns post_id as STRING, but we passed numeric parent IDs
            const junctionRows = [
                { posts_tags: { post_id: "1",
tag_id: "5" },
tags: { id: 5,
name: "Rust" } },
                { posts_tags: { post_id: "2",
tag_id: "5" },
tags: { id: 5,
name: "Rust" } }
            ];

            const { db } = createMockDb(() => junctionRows);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            // Pass numeric parent IDs (parseIdValues will return numbers for numeric PKs)
            const results = await service.batchFetchRelatedEntitiesMany(
                "posts", [1, 2], "tags", relation
            );

            // Both posts should have their tag despite the string/number mismatch
            expect(results.get("1")).toHaveLength(1);
            expect(results.get("1")![0].values.name).toBe("Rust");
            expect(results.get("2")).toHaveLength(1);
        });

        it("inverse M2M: should map results when junction returns string IDs but parent IDs are numbers", async () => {
            // Junction data returns tag_id (the parentId for inverse) as STRING
            const joinedRows = [
                { posts_tags: { post_id: 10,
tag_id: "1" },
posts: { id: 10,
title: "Post A" } },
                { posts_tags: { post_id: 20,
tag_id: "2" },
posts: { id: 20,
title: "Post B" } }
            ];

            const { db } = createMockDb(() => joinedRows);
            const service = new RelationService(db, registry);
            const relation = tagsWithInversePosts.relations![0] as Relation;

            // Pass numeric parent IDs
            const results = await service.batchFetchRelatedEntitiesMany(
                "tags_inv", [1, 2], "posts", relation
            );

            // Both tags should have their post despite string/number mismatch
            expect(results.get("1")).toHaveLength(1);
            expect(results.get("1")![0].values.title).toBe("Post A");
            expect(results.get("2")).toHaveLength(1);
            expect(results.get("2")![0].values.title).toBe("Post B");
        });

        it("owning M2M: should handle mixed string and number IDs in same batch", async () => {
            // Some junction rows return numbers, others return strings
            const junctionRows = [
                { posts_tags: { post_id: 1,
tag_id: 1 },
tags: { id: 1,
name: "TypeScript" } },
                { posts_tags: { post_id: "2",
tag_id: "2" },
tags: { id: 2,
name: "React" } }
            ];

            const { db } = createMockDb(() => junctionRows);
            const service = new RelationService(db, registry);
            const relation = postsCollection.relations![0] as Relation;

            const results = await service.batchFetchRelatedEntitiesMany(
                "posts", [1, 2], "tags", relation
            );

            expect(results.get("1")).toHaveLength(1);
            expect(results.get("2")).toHaveLength(1);
        });
    });
});

