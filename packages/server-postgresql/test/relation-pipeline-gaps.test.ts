/**
 * Relation pipeline gap-analysis tests
 *
 * Covers the remaining risk areas identified by gap analysis:
 *
 * 1. 🔴 ID type coercion in batchFetchRelatedEntities (single-cardinality)
 *    — parsedParentIds.includes(parentId) used strict ===, silently dropping
 *    all inverse results when Drizzle returned string IDs for numeric PKs.
 *    Fixed by using Set<string> + String() normalization.
 *
 * 2. 🟡 Inverse M2M `through` write-path warning
 *    — updateRelationsUsingJoins had no explicit handler for inverse M2M
 *    through relations; they fell to a generic warning. Now emits a
 *    specific, actionable message.
 *
 * 3. 🟢 sanitizeRelation junction table naming convention
 *    — Verifies that auto-inferred junction table names from sorted slugs
 *    match expectations for various collection name patterns.
 */
import { RelationService } from "../src/services/RelationService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { EntityCollection, Relation } from "@rebasepro/types";
import { sanitizeRelation } from "@rebasepro/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

// ─── Mock Tables ──────────────────────────────────────────────────────
const mockPostsTable = {
    id: { name: "id", dataType: "number" },
    title: { name: "title" },
    author_id: { name: "author_id", dataType: "number" },
    _def: { tableName: "posts" }
};

const mockTagsTable = {
    id: { name: "id", dataType: "number" },
    name: { name: "name" },
    _def: { tableName: "tags" }
};

const mockPostsTagsTable = {
    post_id: { name: "post_id", dataType: "number" },
    tag_id: { name: "tag_id", dataType: "number" },
    _def: { tableName: "posts_tags" }
};

const mockAuthorsTable = {
    id: { name: "id", dataType: "number" },
    name: { name: "name" },
    _def: { tableName: "authors" }
};

// ─── Mock Collections ─────────────────────────────────────────────────

const tagsCollection: EntityCollection = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: {
        id: { type: "number" },
        name: { type: "string" }
    },
    idField: "id"
};

const postsCollection: EntityCollection = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" },
        tags: { type: "relation", relationName: "tags" }
    },
    relations: [
        {
            relationName: "tags",
            target: () => tagsCollection,
            cardinality: "many",
            direction: "owning",
            through: {
                table: "posts_tags",
                sourceColumn: "post_id",
                targetColumn: "tag_id"
            }
        }
    ],
    idField: "id"
};

const authorsCollection: EntityCollection = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        posts: { type: "relation", relationName: "posts" }
    },
    relations: [
        {
            relationName: "posts",
            target: () => postsCollection,
            cardinality: "many",
            direction: "inverse",
            foreignKeyOnTarget: "author_id"
        }
    ],
    idField: "id"
};

// Inverse M2M: tags → posts (from tag's perspective)
const tagsWithInversePosts: EntityCollection = {
    slug: "tags_inv",
    name: "Tags (inverse)",
    table: "tags",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        posts: { type: "relation", relationName: "posts" }
    },
    relations: [
        {
            relationName: "posts",
            target: () => postsCollection,
            cardinality: "many",
            direction: "inverse",
            through: {
                table: "posts_tags",
                sourceColumn: "post_id",
                targetColumn: "tag_id"
            }
        }
    ],
    idField: "id"
};

// ─── Mock DB Factory ──────────────────────────────────────────────────

function createMockDb(resolveResults: () => unknown[]) {
    const recorder = {
        selectCount: 0,
        innerJoinCount: 0,
        fromTable: undefined as string | undefined,
        deleteCalls: [] as unknown[],
        insertCalls: [] as unknown[],
    };

    function makeChainable(): Record<string, unknown> {
        const chain: Record<string, unknown> = {
            select: jest.fn(() => {
                recorder.selectCount++;
                return chain;
            }),
            from: jest.fn((table: Record<string, unknown>) => {
                const tableDef = table._def as { tableName: string } | undefined;
                recorder.fromTable = tableDef?.tableName ?? "unknown";
                return chain;
            }),
            where: jest.fn(() => chain),
            $dynamic: jest.fn(() => chain),
            limit: jest.fn(() => chain),
            offset: jest.fn(() => chain),
            orderBy: jest.fn(() => chain),
            innerJoin: jest.fn(() => {
                recorder.innerJoinCount++;
                return chain;
            }),
            delete: jest.fn((table: unknown) => {
                recorder.deleteCalls.push(table);
                return chain;
            }),
            insert: jest.fn((table: unknown) => {
                recorder.insertCalls.push(table);
                return { values: jest.fn(() => chain) };
            }),
            set: jest.fn(() => chain),
            values: jest.fn(() => chain),
            then: (resolve: (val: unknown[]) => void) => {
                resolve(resolveResults());
            }
        };
        return chain;
    }

    return {
        db: makeChainable() as unknown as jest.Mocked<NodePgDatabase>,
        recorder,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. ID type coercion in batchFetchRelatedEntities (single cardinality)
// ═══════════════════════════════════════════════════════════════════════

describe("batchFetchRelatedEntities: ID type coercion (single cardinality)", () => {
    let registry: PostgresCollectionRegistry;

    beforeEach(() => {
        registry = new PostgresCollectionRegistry();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("posts")) return postsCollection;
            if (path?.startsWith("tags_inv")) return tagsWithInversePosts;
            if (path?.startsWith("tags")) return tagsCollection;
            if (path?.startsWith("authors")) return authorsCollection;
            return undefined;
        });

        jest.spyOn(registry, "getTable").mockImplementation(tableName => {
            if (tableName === "posts") return mockPostsTable as any;
            if (tableName === "tags") return mockTagsTable as any;
            if (tableName === "posts_tags") return mockPostsTagsTable as any;
            if (tableName === "authors") return mockAuthorsTable as any;
            return undefined;
        });

        jest.spyOn(registry, "getCollections").mockReturnValue([
            postsCollection, tagsCollection, authorsCollection
        ]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should match results when Drizzle returns string IDs but parsedParentIds are numbers (FK inverse)", async () => {
        // Simulate Drizzle returning author_id as a string even though it's a numeric column
        const resultRows = [
            { id: 10, title: "Post A", author_id: "1" },
            { id: 20, title: "Post B", author_id: "2" },
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);
        const relation = authorsCollection.relations![0] as Relation;

        // Pass numeric parent IDs — parseIdValues will return numbers
        const results = await service.batchFetchRelatedEntities(
            "authors", [1, 2], "posts", relation
        );

        // Before fix: both results would be silently dropped because
        // parsedParentIds.includes("1") returns false when parsedParentIds contains 1
        expect(results.get("1")).toBeDefined();
        expect(results.get("1")!.values.title).toBe("Post A");
        expect(results.get("2")).toBeDefined();
        expect(results.get("2")!.values.title).toBe("Post B");
    });

    it("should match results when Drizzle returns number IDs but parsedParentIds contain strings", async () => {
        // Simulate the reverse: Drizzle returns numbers, but parsed IDs might be strings
        const resultRows = [
            { id: 10, title: "Post A", author_id: 1 },
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);
        const relation = authorsCollection.relations![0] as Relation;

        const results = await service.batchFetchRelatedEntities(
            "authors", [1], "posts", relation
        );

        expect(results.get("1")).toBeDefined();
        expect(results.get("1")!.values.title).toBe("Post A");
    });

    it("should handle mixed string and number IDs across result rows", async () => {
        const resultRows = [
            { id: 10, title: "Post A", author_id: 1 },       // number
            { id: 20, title: "Post B", author_id: "2" },      // string
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);
        const relation = authorsCollection.relations![0] as Relation;

        const results = await service.batchFetchRelatedEntities(
            "authors", [1, 2], "posts", relation
        );

        expect(results.get("1")).toBeDefined();
        expect(results.get("2")).toBeDefined();
    });

    it("should not match results for IDs not in the parent set", async () => {
        const resultRows = [
            { id: 10, title: "Post A", author_id: "999" },
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);
        const relation = authorsCollection.relations![0] as Relation;

        const results = await service.batchFetchRelatedEntities(
            "authors", [1, 2], "posts", relation
        );

        // 999 is not in the parent set
        expect(results.size).toBe(0);
    });

    it("should handle inferredForeignKeyName path with string IDs", async () => {
        // Test the `inverseRelationName`-based FK inference path
        const authorsWithInverseNameOnly: EntityCollection = {
            slug: "authors_inr",
            name: "Authors (inverseRelationName)",
            table: "authors",
            properties: {
                id: { type: "number" },
                name: { type: "string" }
            },
            idField: "id"
        };

        const postsWithFK: EntityCollection = {
            slug: "posts_fk",
            name: "Posts (FK)",
            table: "posts",
            properties: {
                id: { type: "number" },
                title: { type: "string" }
            },
            idField: "id"
        };

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("authors_inr")) return authorsWithInverseNameOnly;
            if (path?.startsWith("posts_fk")) return postsWithFK;
            return undefined;
        });

        const relation: Relation = {
            relationName: "posts",
            target: () => postsWithFK,
            cardinality: "one",
            direction: "inverse",
            inverseRelationName: "author"
        };

        // Drizzle returns author_id as string
        const resultRows = [
            { id: 10, title: "Post A", author_id: "1" },
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);

        const results = await service.batchFetchRelatedEntities(
            "authors_inr", [1], "posts", relation
        );

        expect(results.get("1")).toBeDefined();
        expect(results.get("1")!.values.title).toBe("Post A");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Inverse M2M write-path warning
// ═══════════════════════════════════════════════════════════════════════

describe("updateRelationsUsingJoins: inverse M2M through warning", () => {
    let registry: PostgresCollectionRegistry;

    beforeEach(() => {
        registry = new PostgresCollectionRegistry();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("tags_inv")) return tagsWithInversePosts;
            if (path?.startsWith("tags")) return tagsCollection;
            if (path?.startsWith("posts")) return postsCollection;
            return undefined;
        });

        jest.spyOn(registry, "getTable").mockImplementation(tableName => {
            if (tableName === "posts") return mockPostsTable as any;
            if (tableName === "tags") return mockTagsTable as any;
            if (tableName === "posts_tags") return mockPostsTagsTable as any;
            return undefined;
        });

        jest.spyOn(registry, "getCollections").mockReturnValue([
            postsCollection, tagsCollection
        ]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should emit a specific warning when attempting to save an inverse M2M through relation", async () => {
        const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

        const { db } = createMockDb(() => []);
        const service = new RelationService(db, registry);

        // Try to save posts from the tags (inverse) side
        await service.updateRelationsUsingJoins(
            db as any,
            tagsWithInversePosts,
            1,
            { posts: [{ id: 10 }, { id: 20 }] }
        );

        // Should warn about inverse M2M
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("Inverse M2M relation")
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("should be saved from the owning side")
        );

        consoleSpy.mockRestore();
    });

    it("should NOT warn for owning M2M through relations (normal save path)", async () => {
        const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

        const { db } = createMockDb(() => []);
        const service = new RelationService(db, registry);

        // Owning side save should work normally (or at least not trigger the inverse warning)
        await service.updateRelationsUsingJoins(
            db as any,
            postsCollection,
            1,
            { tags: [{ id: 1 }, { id: 2 }] }
        );

        // Should NOT have the inverse M2M warning
        const inverseCalls = consoleSpy.mock.calls.filter(
            call => typeof call[0] === "string" && call[0].includes("Inverse M2M")
        );
        expect(inverseCalls).toHaveLength(0);

        consoleSpy.mockRestore();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. sanitizeRelation junction table naming convention
// ═══════════════════════════════════════════════════════════════════════

describe("sanitizeRelation: auto-inferred junction table naming", () => {
    it("should produce sorted junction table name: posts + tags → posts_tags", () => {
        const source: EntityCollection = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: EntityCollection = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: Partial<Relation> = {
            relationName: "tags",
            target: () => target,
            cardinality: "many",
            direction: "owning"
        };

        const normalized = sanitizeRelation(relation, source as any);

        expect(normalized.through).toBeDefined();
        expect(normalized.through!.table).toBe("posts_tags"); // ["posts", "tags"].sort().join("_")
    });

    it("should sort alphabetically: articles + tags → articles_tags (not tags_articles)", () => {
        const source: EntityCollection = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };
        const target: EntityCollection = {
            slug: "articles",
            name: "Articles",
            table: "articles",
            properties: {}
        };

        const relation: Partial<Relation> = {
            relationName: "articles",
            target: () => target,
            cardinality: "many",
            direction: "owning"
        };

        const normalized = sanitizeRelation(relation, source as any);

        expect(normalized.through!.table).toBe("articles_tags"); // sorted
    });

    it("should handle underscore-containing slugs: blog_posts + labels → blog_posts_labels", () => {
        const source: EntityCollection = {
            slug: "blog-posts",
            name: "Blog Posts",
            table: "blog_posts",
            properties: {}
        };
        const target: EntityCollection = {
            slug: "labels",
            name: "Labels",
            table: "labels",
            properties: {}
        };

        const relation: Partial<Relation> = {
            relationName: "labels",
            target: () => target,
            cardinality: "many",
            direction: "owning"
        };

        const normalized = sanitizeRelation(relation, source as any);

        expect(normalized.through!.table).toBe("blog_posts_labels"); // sorted: blog_posts < labels
    });

    it("should generate correct source and target columns", () => {
        const source: EntityCollection = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: EntityCollection = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: Partial<Relation> = {
            relationName: "tags",
            target: () => target,
            cardinality: "many",
            direction: "owning"
        };

        const normalized = sanitizeRelation(relation, source as any);

        // sourceColumn derives from source slug (singularized), targetColumn from relationName (singularized)
        // generateForeignKeyName("posts") → "post_id", generateForeignKeyName("tags") → "tag_id"
        expect(normalized.through!.sourceColumn).toBe("post_id");
        expect(normalized.through!.targetColumn).toBe("tag_id");
    });

    it("should preserve explicit through config and not overwrite it", () => {
        const source: EntityCollection = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: EntityCollection = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: Partial<Relation> = {
            relationName: "tags",
            target: () => target,
            cardinality: "many",
            direction: "owning",
            through: {
                table: "custom_junction",
                sourceColumn: "src_id",
                targetColumn: "tgt_id"
            }
        };

        const normalized = sanitizeRelation(relation, source as any);

        expect(normalized.through!.table).toBe("custom_junction");
        expect(normalized.through!.sourceColumn).toBe("src_id");
        expect(normalized.through!.targetColumn).toBe("tgt_id");
    });

    it("should handle self-referencing M2M: users + users → users_users", () => {
        const usersCollection: EntityCollection = {
            slug: "users",
            name: "Users",
            table: "users",
            properties: {}
        };

        const relation: Partial<Relation> = {
            relationName: "friends",
            target: () => usersCollection,
            cardinality: "many",
            direction: "owning"
        };

        const normalized = sanitizeRelation(relation, usersCollection as any);

        // Both tables are "users", sorted = ["users", "users"], joined = "users_users"
        expect(normalized.through!.table).toBe("users_users");
    });

    it("should NOT add through config for joinPath-based relations", () => {
        const source: EntityCollection = {
            slug: "users",
            name: "Users",
            table: "users",
            properties: {}
        };
        const target: EntityCollection = {
            slug: "permissions",
            name: "Permissions",
            table: "permissions",
            properties: {}
        };

        const relation: Partial<Relation> = {
            relationName: "permissions",
            target: () => target,
            cardinality: "many",
            direction: "owning",
            joinPath: [
                { table: "user_roles", on: { from: "id", to: "user_id" } },
                { table: "permissions", on: { from: "permission_id", to: "id" } }
            ]
        };

        const normalized = sanitizeRelation(relation, source as any);

        // joinPath takes precedence — no through should be auto-generated
        expect(normalized.through).toBeUndefined();
    });
});
