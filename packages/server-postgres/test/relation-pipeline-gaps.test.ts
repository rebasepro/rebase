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
 * 2. 🟡 M2M `through` write path
 *    — updateRelationsUsingJoins brings a row's junction links in line with
 *    the ids a save carried: insert the ones that arrived, delete the ones
 *    that left, leave the rest alone. See junction-diff-write for why it is a
 *    diff rather than a replacement.
 *
 * 3. 🟢 resolveRelation junction table naming convention
 *    — Verifies that auto-inferred junction table names from sorted slugs
 *    match expectations for various collection name patterns.
 */
import { RelationService } from "../src/services/RelationService";
import { RelationWriteService } from "../src/services/RelationWriteService";
import { FixtureTableRegistry } from "./helpers/tables";
import { relationOfTable } from "./helpers/relation-descriptors";
import { LegacyCollectionConfig, LegacyRelation, LegacyRelationProperty, resolveLegacyCollectionRelations, resolveLegacyRelation } from "@rebasepro/common/migrate";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

// ─── Tables ───────────────────────────────────────────────────────────
const mockPostsTable = pgTable("posts", { id: integer("id"), title: text("title"), authorId: integer("author_id") });
const mockTagsTable = pgTable("tags", { id: integer("id"), name: text("name") });
const mockPostsTagsTable = pgTable("posts_tags", { post_id: integer("post_id"), tag_id: integer("tag_id") });
const mockAuthorsTable = pgTable("authors", { id: integer("id"), name: text("name") });

/** A relation as the services read it: resolved from the collection. */
/** A relation as the services read it: the descriptor the collection's table compiles to. */
const link = (collection: LegacyCollectionConfig, key: string) =>
    relationOfTable(new FixtureTableRegistry([collection]), collection.slug, key);

// ─── Mock Collections ─────────────────────────────────────────────────

const tagsCollection: LegacyCollectionConfig = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: {
        id: { type: "number" },
        name: { type: "string" }
    }
};

const postsCollection: LegacyCollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" },
        tags: { type: "relation", relation: { kind: "manyToMany", relationName: "tags", target: () => tagsCollection, through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } } }
    }
};

const authorsCollection: LegacyCollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        posts: { type: "relation", relation: { kind: "hasMany", relationName: "posts", target: () => postsCollection, foreignKeyOnTarget: "author_id" } }
    }
};

// Inverse M2M: tags → posts (from tag's perspective)
const tagsWithInversePosts: LegacyCollectionConfig = {
    slug: "tags_inv",
    name: "Tags (inverse)",
    table: "tags",
    properties: {
        id: { type: "number" },
        name: { type: "string" },
        posts: { type: "relation", relation: { kind: "manyToMany", relationName: "posts", target: () => postsCollection, through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } } }
    }
};

// ─── Mock DB Factory ──────────────────────────────────────────────────

function createMockDb(resolveResults: () => unknown[]) {
    const recorder = {
        selectCount: 0,
        innerJoinCount: 0,
        fromTable: undefined as string | undefined,
        deleteCalls: [] as unknown[],
        insertCalls: [] as unknown[],
        // The junction rows themselves. `insertCalls` records only WHICH table
        // was written, so without this a save that inserts nothing at all is
        // indistinguishable from one that writes the right links.
        insertedValues: [] as unknown[]
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
                return {
                    values: jest.fn((rows: unknown) => {
                        recorder.insertedValues.push(rows);
                        // The junction writer diffs and inserts what arrived
                        // with ON CONFLICT DO NOTHING, so this has to be the
                        // builder and not the awaited result.
                        return Object.assign({}, chain, {
                            onConflictDoNothing: jest.fn(() => chain)
                        });
                    })
                };
            }),
            set: jest.fn(() => chain),
            values: jest.fn(() => chain),
            then: (resolve: (val: unknown[]) => void) => {
                // A write's result carries `rowCount`, and the junction writer
                // reads it: a delete that reports nothing removed is treated as
                // a policy refusal, not as a no-op. Reporting the row count the
                // same select answered with models a database that did as asked.
                const rows = resolveResults();
                resolve(Object.assign(rows, { rowCount: rows.length }));
            }
        };
        return chain;
    }

    return {
        // A chainable stand-in for drizzle's builder: it answers the rows the
        // test names exactly as given — a driver's mistyped ids included —
        // which drizzle's own column mapping would correct before the code
        // under test saw them. No typed seam injects raw driver rows.
        db: makeChainable() as unknown as NodePgDatabase,
        recorder
    };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. ID type coercion in batchFetchRelatedEntities (single cardinality)
// ═══════════════════════════════════════════════════════════════════════

describe("batchFetchRelatedEntities: ID type coercion (single cardinality)", () => {
    let registry: FixtureTableRegistry;

    beforeEach(() => {
        registry = new FixtureTableRegistry();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("posts")) return postsCollection;
            if (path?.startsWith("tags_inv")) return tagsWithInversePosts;
            if (path?.startsWith("tags")) return tagsCollection;
            if (path?.startsWith("authors")) return authorsCollection;
            return undefined;
        });

        jest.spyOn(registry, "getPgTable").mockImplementation(tableName => {
            if (tableName === "posts") return mockPostsTable;
            if (tableName === "tags") return mockTagsTable;
            if (tableName === "posts_tags") return mockPostsTagsTable;
            if (tableName === "authors") return mockAuthorsTable;
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
            { id: 10,
title: "Post A",
authorId: "1" },
            { id: 20,
title: "Post B",
authorId: "2" }
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);
        const relation = link(authorsCollection, "posts");

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
            { id: 10,
title: "Post A",
authorId: 1 }
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);
        const relation = link(authorsCollection, "posts");

        const results = await service.batchFetchRelatedEntities(
            "authors", [1], "posts", relation
        );

        expect(results.get("1")).toBeDefined();
        expect(results.get("1")!.values.title).toBe("Post A");
    });

    it("should handle mixed string and number IDs across result rows", async () => {
        const resultRows = [
            { id: 10,
title: "Post A",
authorId: 1 }, // number
            { id: 20,
title: "Post B",
authorId: "2" } // string
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);
        const relation = link(authorsCollection, "posts");

        const results = await service.batchFetchRelatedEntities(
            "authors", [1, 2], "posts", relation
        );

        expect(results.get("1")).toBeDefined();
        expect(results.get("2")).toBeDefined();
    });

    it("should not match results for IDs not in the parent set", async () => {
        const resultRows = [
            { id: 10,
title: "Post A",
authorId: "999" }
        ];

        const { db } = createMockDb(() => resultRows);
        const service = new RelationService(db, registry);
        const relation = link(authorsCollection, "posts");

        const results = await service.batchFetchRelatedEntities(
            "authors", [1, 2], "posts", relation
        );

        // 999 is not in the parent set
        expect(results.size).toBe(0);
    });


    // Removed with the behaviour it covered — the inferred-column path is gone: a hasOne/hasMany always resolves a foreignKeyOnTarget.

});

// ═══════════════════════════════════════════════════════════════════════
// 2. M2M `through` write path
// ═══════════════════════════════════════════════════════════════════════

describe("updateRelationsUsingJoins: M2M through junction writes", () => {
    let registry: FixtureTableRegistry;

    beforeEach(() => {
        registry = new FixtureTableRegistry();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("tags_inv")) return tagsWithInversePosts;
            if (path?.startsWith("tags")) return tagsCollection;
            if (path?.startsWith("posts")) return postsCollection;
            return undefined;
        });

        jest.spyOn(registry, "getPgTable").mockImplementation(tableName => {
            if (tableName === "posts") return mockPostsTable;
            if (tableName === "tags") return mockTagsTable;
            if (tableName === "posts_tags") return mockPostsTagsTable;
            return undefined;
        });

        jest.spyOn(registry, "getCollections").mockReturnValue([
            postsCollection, tagsCollection
        ]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });


    // Removed with the behaviour it covered — there is no inverse M2M to warn about: both sides are manyToMany and both may be saved.


    // This used to grep console.warn for "Inverse M2M", a string that no longer
    // exists anywhere in src — so the filter always came back empty and the
    // test could not fail. It now asserts what the save is actually for: the
    // junction rows.
    it("writes the junction rows for an owning M2M save", async () => {
        // Nothing linked yet, so the whole list is an insert. The write goes
        // to the junction and not the target table: an insert aimed at `tags`
        // would create tag rows instead of links, which is the failure mode
        // this shape guards.
        const { db, recorder } = createMockDb(() => []);
        const service = new RelationWriteService(db, registry);

        await service.updateRelationsUsingJoins(
            db,
            registry.requireTable(postsCollection.slug),
            1,
            { tags: [{ id: 1 }, { id: 2 }] }
        );

        expect(recorder.insertCalls).toEqual([mockPostsTagsTable]);
        expect(recorder.insertedValues).toEqual([[
            { post_id: 1, tag_id: 1 },
            { post_id: 1, tag_id: 2 }
        ]]);
        // Nothing was linked, so nothing is deleted. The writer diffs; it no
        // longer clears the parent's links before writing.
        expect(recorder.deleteCalls).toEqual([]);
    });

    it("clears the junction rows without reinserting when the relation is emptied", async () => {
        // Two links exist and the save asks for none.
        const { db, recorder } = createMockDb(() => [{ targetId: 1 }, { targetId: 2 }]);
        const service = new RelationWriteService(db, registry);

        await service.updateRelationsUsingJoins(
            db,
            registry.requireTable(postsCollection.slug),
            1,
            { tags: [] }
        );

        // The delete still has to run — otherwise "remove all tags" silently
        // leaves every existing link in place.
        expect(recorder.deleteCalls).toEqual([mockPostsTagsTable]);
        expect(recorder.insertCalls).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. resolveRelation junction table naming convention
// ═══════════════════════════════════════════════════════════════════════

describe("resolveRelation: auto-inferred junction table naming", () => {
    it("should produce sorted junction table name: posts + tags → posts_tags", () => {
        const source: LegacyCollectionConfig = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: LegacyCollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: LegacyRelation = {
            kind: "manyToMany",
            relationName: "tags",
            target: () => target,
            };

        const normalized = resolveLegacyRelation(relation, source);

        if (normalized.kind !== "manyToMany") throw new Error("expected a manyToMany");

        expect(normalized.through).toBeDefined();
        expect(normalized.through!.table).toBe("posts_tags"); // ["posts", "tags"].sort().join("_")
    });

    it("should sort alphabetically: articles + tags → articles_tags (not tags_articles)", () => {
        const source: LegacyCollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };
        const target: LegacyCollectionConfig = {
            slug: "articles",
            name: "Articles",
            table: "articles",
            properties: {}
        };

        const relation: LegacyRelation = {
            kind: "manyToMany",
            relationName: "articles",
            target: () => target,
            };

        const normalized = resolveLegacyRelation(relation, source);

        if (normalized.kind !== "manyToMany") throw new Error("expected a manyToMany");

        expect(normalized.through!.table).toBe("articles_tags"); // sorted
    });

    it("should handle underscore-containing slugs: blog_posts + labels → blog_posts_labels", () => {
        const source: LegacyCollectionConfig = {
            slug: "blog-posts",
            name: "Blog Posts",
            table: "blog_posts",
            properties: {}
        };
        const target: LegacyCollectionConfig = {
            slug: "labels",
            name: "Labels",
            table: "labels",
            properties: {}
        };

        const relation: LegacyRelation = {
            kind: "manyToMany",
            relationName: "labels",
            target: () => target,
            };

        const normalized = resolveLegacyRelation(relation, source);

        if (normalized.kind !== "manyToMany") throw new Error("expected a manyToMany");

        expect(normalized.through!.table).toBe("blog_posts_labels"); // sorted: blog_posts < labels
    });

    it("should generate correct source and target columns", () => {
        const source: LegacyCollectionConfig = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: LegacyCollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: LegacyRelation = {
            kind: "manyToMany",
            relationName: "tags",
            target: () => target,
            };

        const normalized = resolveLegacyRelation(relation, source);

        if (normalized.kind !== "manyToMany") throw new Error("expected a manyToMany");

        // sourceColumn derives from source slug (singularized), targetColumn from relationName (singularized)
        // generateForeignKeyName("posts") → "post_id", generateForeignKeyName("tags") → "tag_id"
        expect(normalized.through!.sourceColumn).toBe("post_id");
        expect(normalized.through!.targetColumn).toBe("tag_id");
    });

    it("should preserve explicit through config and not overwrite it", () => {
        const source: LegacyCollectionConfig = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: LegacyCollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: LegacyRelation = {
            kind: "manyToMany",
            relationName: "tags",
            target: () => target,
            through: {
                table: "custom_junction",
                sourceColumn: "src_id",
                targetColumn: "tgt_id"
            }
        };

        const normalized = resolveLegacyRelation(relation, source);

        if (normalized.kind !== "manyToMany") throw new Error("expected a manyToMany");

        expect(normalized.through!.table).toBe("custom_junction");
        expect(normalized.through!.sourceColumn).toBe("src_id");
        expect(normalized.through!.targetColumn).toBe("tgt_id");
    });

    it("should handle self-referencing M2M: users + users → users_users", () => {
        const usersCollection: LegacyCollectionConfig = {
            slug: "users",
            name: "Users",
            table: "users",
            properties: {}
        };

        const relation: LegacyRelation = {
            kind: "manyToMany",
            relationName: "friends",
            target: () => usersCollection,
            };

        const normalized = resolveLegacyRelation(relation, usersCollection);

        if (normalized.kind !== "manyToMany") throw new Error("expected a manyToMany");

        // Both tables are "users", sorted = ["users", "users"], joined = "users_users"
        expect(normalized.through!.table).toBe("users_users");
    });

    it("should NOT add through config for joinPath-based relations", () => {
        const source: LegacyCollectionConfig = {
            slug: "users",
            name: "Users",
            table: "users",
            properties: {}
        };
        const target: LegacyCollectionConfig = {
            slug: "permissions",
            name: "Permissions",
            table: "permissions",
            properties: {}
        };

        const relation: LegacyRelation = {
            kind: "via",
            relationName: "permissions",
            target: () => target,
            cardinality: "many",
            joinPath: [
                { table: "user_roles",
on: { from: "id",
to: "user_id" } },
                { table: "permissions",
on: { from: "permission_id",
to: "id" } }
            ]
        };

        const normalized = resolveLegacyRelation(relation, source);

        // joinPath takes precedence — no through should be auto-generated
        expect("through" in normalized ? normalized.through : undefined).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Owning direction batch relation loading (tasks → client pattern)
// ═══════════════════════════════════════════════════════════════════════

describe("batchFetchRelatedEntities: owning direction (FK-based)", () => {
    let registry: FixtureTableRegistry;

    // Mock collections simulating tasks → clients owning relation
    const mockClientsTable = pgTable("clients", { id: text("id"), name: text("name"), email: text("email") });
    const mockTasksTable = pgTable("tasks", { id: text("id"), clientId: text("client_id"), title: text("title") });

    const clientsCollection: LegacyCollectionConfig = {
        slug: "clients",
        name: "Clients",
        table: "clients",
        properties: {
            id: { type: "string",
isId: "uuid" },
            name: { type: "string" },
            email: { type: "string" }
        }
    };

    const tasksCollection: LegacyCollectionConfig = {
        slug: "tasks",
        name: "Tasks",
        table: "tasks",
        properties: {
            id: { type: "string",
isId: "uuid" },
            clientId: { type: "string",
columnName: "client_id",
columnType: "uuid" },
            title: { type: "string" },
            client: {
                type: "relation",
                relation: {
                    kind: "belongsTo",
                    target: () => clientsCollection,
                    relationName: "client",
                    localKey: "client_id",
                }
            }
        }
    };

    /**
     * Mock DB that returns different results for sequential queries.
     * The owning-direction path issues 2 queries:
     * 1. SELECT parentId, fkValue FROM tasks WHERE id IN (...)
     * 2. SELECT * FROM clients WHERE id IN (...)
     */
    function createSequencedMockDb(resultSequence: (() => unknown[])[]) {
        let queryIndex = 0;

        function makeChainable(): Record<string, unknown> {
            const chain: Record<string, unknown> = {
                select: jest.fn(() => chain),
                from: jest.fn(() => chain),
                where: jest.fn(() => chain),
                $dynamic: jest.fn(() => chain),
                limit: jest.fn(() => chain),
                offset: jest.fn(() => chain),
                orderBy: jest.fn(() => chain),
                innerJoin: jest.fn(() => chain),
                then: (resolve: (val: unknown[]) => void) => {
                    const idx = queryIndex++;
                    resolve(resultSequence[idx] ? resultSequence[idx]() : []);
                }
            };
            return chain;
        }

        // The same chainable stand-in as above, answering one result per query in turn.
        return makeChainable() as unknown as NodePgDatabase;
    }

    beforeEach(() => {
        registry = new FixtureTableRegistry();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("tasks")) return tasksCollection;
            if (path?.startsWith("clients")) return clientsCollection;
            return undefined;
        });

        jest.spyOn(registry, "getPgTable").mockImplementation(tableName => {
            if (tableName === "tasks") return mockTasksTable;
            if (tableName === "clients") return mockClientsTable;
            return undefined;
        });

        jest.spyOn(registry, "getCollections").mockReturnValue([
            tasksCollection, clientsCollection
        ]);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should batch-load owning relation data with correct FK mapping", async () => {
        const clientUuid = "77e340ca-c6f1-4559-a360-a853a87c066c";
        const taskUuid = "46737ae3-a3f3-4663-92d4-17aecdabbd38";

        const db = createSequencedMockDb([
            // Query 1: FK lookup from tasks table
            () => [{ parentId: taskUuid,
fkValue: clientUuid }],
            // Query 2: Target entity from clients table
            () => [{ id: clientUuid,
name: "Francesco",
email: "f@test.com" }]
        ]);

        const service = new RelationService(db, registry);
        const relation = link(tasksCollection, "client");

        const results = await service.batchFetchRelatedEntities(
            "tasks", [taskUuid], "client", relation
        );

        expect(results.size).toBe(1);

        const clientEntity = results.get(taskUuid);
        expect(clientEntity).toBeDefined();
        expect(clientEntity!.id).toBe(clientUuid);
        expect(clientEntity!.path).toBe("clients");
        expect(clientEntity!.values).toBeDefined();
        expect(clientEntity!.values.name).toBe("Francesco");
        expect(clientEntity!.values.email).toBe("f@test.com");
    });

    it("should handle multiple tasks pointing to the same client", async () => {
        const clientUuid = "77e340ca-c6f1-4559-a360-a853a87c066c";
        const task1 = "task-1-uuid";
        const task2 = "task-2-uuid";

        const db = createSequencedMockDb([
            // Both tasks have the same clientId
            () => [
                { parentId: task1,
fkValue: clientUuid },
                { parentId: task2,
fkValue: clientUuid }
            ],
            // Only one client row
            () => [{ id: clientUuid,
name: "Francesco",
email: "f@test.com" }]
        ]);

        const service = new RelationService(db, registry);
        const relation = link(tasksCollection, "client");

        const results = await service.batchFetchRelatedEntities(
            "tasks", [task1, task2], "client", relation
        );

        expect(results.size).toBe(2);
        expect(results.get(task1)!.values.name).toBe("Francesco");
        expect(results.get(task2)!.values.name).toBe("Francesco");
    });

    it("should handle tasks with null FK values gracefully", async () => {
        const task1 = "task-1-uuid";

        const db = createSequencedMockDb([
            // FK is null
            () => [{ parentId: task1,
fkValue: null }]
        ]);

        const service = new RelationService(db, registry);
        const relation = link(tasksCollection, "client");

        const results = await service.batchFetchRelatedEntities(
            "tasks", [task1], "client", relation
        );

        // No results because FK is null
        expect(results.size).toBe(0);
    });
});
