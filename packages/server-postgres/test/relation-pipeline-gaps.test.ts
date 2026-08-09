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
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { CollectionConfig, Relation, RelationProperty } from "@rebasepro/types";
import { resolveRelation } from "@rebasepro/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

// ─── Mock Tables ──────────────────────────────────────────────────────
const mockPostsTable = {
    id: { name: "id",
dataType: "number" },
    title: { name: "title" },
    authorId: { name: "author_id",
dataType: "number" },
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
        name: { type: "string" },
        posts: { type: "relation",
relationName: "posts" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection,
            foreignKeyOnTarget: "author_id"
        }
    ],
    idField: "id"
};

// Inverse M2M: tags → posts (from tag's perspective)
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
        db: makeChainable() as unknown as jest.Mocked<NodePgDatabase>,
        recorder
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
            { id: 10,
title: "Post A",
authorId: "1" },
            { id: 20,
title: "Post B",
authorId: "2" }
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
            { id: 10,
title: "Post A",
authorId: 1 }
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
            { id: 10,
title: "Post A",
authorId: 1 }, // number
            { id: 20,
title: "Post B",
authorId: "2" } // string
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
            { id: 10,
title: "Post A",
authorId: "999" }
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


    // Removed with the behaviour it covered — the inferred-column path is gone: a hasOne/hasMany always resolves a foreignKeyOnTarget.

});

// ═══════════════════════════════════════════════════════════════════════
// 2. M2M `through` write path
// ═══════════════════════════════════════════════════════════════════════

describe("updateRelationsUsingJoins: M2M through junction writes", () => {
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
            db as any,
            postsCollection,
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
            db as any,
            postsCollection,
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
        const source: CollectionConfig = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: CollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: Partial<Relation> = {
            kind: "manyToMany",
            relationName: "tags",
            target: () => target,
            };

        const normalized = resolveRelation(relation, source as any);

        expect(normalized.through).toBeDefined();
        expect(normalized.through!.table).toBe("posts_tags"); // ["posts", "tags"].sort().join("_")
    });

    it("should sort alphabetically: articles + tags → articles_tags (not tags_articles)", () => {
        const source: CollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };
        const target: CollectionConfig = {
            slug: "articles",
            name: "Articles",
            table: "articles",
            properties: {}
        };

        const relation: Partial<Relation> = {
            kind: "manyToMany",
            relationName: "articles",
            target: () => target,
            };

        const normalized = resolveRelation(relation, source as any);

        expect(normalized.through!.table).toBe("articles_tags"); // sorted
    });

    it("should handle underscore-containing slugs: blog_posts + labels → blog_posts_labels", () => {
        const source: CollectionConfig = {
            slug: "blog-posts",
            name: "Blog Posts",
            table: "blog_posts",
            properties: {}
        };
        const target: CollectionConfig = {
            slug: "labels",
            name: "Labels",
            table: "labels",
            properties: {}
        };

        const relation: Partial<Relation> = {
            kind: "manyToMany",
            relationName: "labels",
            target: () => target,
            };

        const normalized = resolveRelation(relation, source as any);

        expect(normalized.through!.table).toBe("blog_posts_labels"); // sorted: blog_posts < labels
    });

    it("should generate correct source and target columns", () => {
        const source: CollectionConfig = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: CollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: Partial<Relation> = {
            kind: "manyToMany",
            relationName: "tags",
            target: () => target,
            };

        const normalized = resolveRelation(relation, source as any);

        // sourceColumn derives from source slug (singularized), targetColumn from relationName (singularized)
        // generateForeignKeyName("posts") → "post_id", generateForeignKeyName("tags") → "tag_id"
        expect(normalized.through!.sourceColumn).toBe("post_id");
        expect(normalized.through!.targetColumn).toBe("tag_id");
    });

    it("should preserve explicit through config and not overwrite it", () => {
        const source: CollectionConfig = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {}
        };
        const target: CollectionConfig = {
            slug: "tags",
            name: "Tags",
            table: "tags",
            properties: {}
        };

        const relation: Partial<Relation> = {
            kind: "manyToMany",
            relationName: "tags",
            target: () => target,
            through: {
                table: "custom_junction",
                sourceColumn: "src_id",
                targetColumn: "tgt_id"
            }
        };

        const normalized = resolveRelation(relation, source as any);

        expect(normalized.through!.table).toBe("custom_junction");
        expect(normalized.through!.sourceColumn).toBe("src_id");
        expect(normalized.through!.targetColumn).toBe("tgt_id");
    });

    it("should handle self-referencing M2M: users + users → users_users", () => {
        const usersCollection: CollectionConfig = {
            slug: "users",
            name: "Users",
            table: "users",
            properties: {}
        };

        const relation: Partial<Relation> = {
            kind: "manyToMany",
            relationName: "friends",
            target: () => usersCollection,
            };

        const normalized = resolveRelation(relation, usersCollection as any);

        // Both tables are "users", sorted = ["users", "users"], joined = "users_users"
        expect(normalized.through!.table).toBe("users_users");
    });

    it("should NOT add through config for joinPath-based relations", () => {
        const source: CollectionConfig = {
            slug: "users",
            name: "Users",
            table: "users",
            properties: {}
        };
        const target: CollectionConfig = {
            slug: "permissions",
            name: "Permissions",
            table: "permissions",
            properties: {}
        };

        const relation: Partial<Relation> = {
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

        const normalized = resolveRelation(relation, source as any);

        // joinPath takes precedence — no through should be auto-generated
        expect(normalized.through).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Owning direction batch relation loading (tasks → client pattern)
// ═══════════════════════════════════════════════════════════════════════

describe("batchFetchRelatedEntities: owning direction (FK-based)", () => {
    let registry: PostgresCollectionRegistry;

    // Mock collections simulating tasks → clients owning relation
    const mockClientsTable = {
        id: { name: "id",
dataType: "string" },
        name: { name: "name" },
        email: { name: "email" },
        _def: { tableName: "clients" }
    };

    const mockTasksTable = {
        id: { name: "id",
dataType: "string" },
        clientId: { name: "client_id",
dataType: "string" },
        title: { name: "title" },
        _def: { tableName: "tasks" }
    };

    const clientsCollection: CollectionConfig = {
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

    const tasksCollection: CollectionConfig = {
        slug: "tasks",
        name: "Tasks",
        table: "tasks",
        properties: {
            id: { type: "string",
isId: "uuid" },
            clientId: { type: "string",
columnName: "client_id" },
            title: { type: "string" },
            client: {
                type: "relation",
                relation: {
                    kind: "belongsTo",
                    target: () => clientsCollection,
                    relationName: "client",
                    localKey: "clientId",
                }
            } as any
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

        return makeChainable() as unknown as jest.Mocked<NodePgDatabase>;
    }

    beforeEach(() => {
        registry = new PostgresCollectionRegistry();

        jest.spyOn(registry, "getCollectionByPath").mockImplementation(path => {
            if (path?.startsWith("tasks")) return tasksCollection;
            if (path?.startsWith("clients")) return clientsCollection;
            return undefined;
        });

        jest.spyOn(registry, "getTable").mockImplementation(tableName => {
            if (tableName === "tasks") return mockTasksTable as any;
            if (tableName === "clients") return mockClientsTable as any;
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
        const relation = resolveRelation(
            (tasksCollection.properties.client as RelationProperty).relation!,
            tasksCollection,
            "client"
        );

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
        const relation = resolveRelation(
            (tasksCollection.properties.client as RelationProperty).relation!,
            tasksCollection,
            "client"
        );

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
        const relation = resolveRelation(
            (tasksCollection.properties.client as RelationProperty).relation!,
            tasksCollection,
            "client"
        );

        const results = await service.batchFetchRelatedEntities(
            "tasks", [task1], "client", relation
        );

        // No results because FK is null
        expect(results.size).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Relation data round-trip: createRelationRefWithData → JSON → reviver
// ═══════════════════════════════════════════════════════════════════════

import { createRelationRefWithData } from "@rebasepro/common";
import { EntityRelation } from "@rebasepro/types";
// The real client-side reviver, not a copy. This suite exists to prove the
// server's wire format survives the trip to the client, so a local
// re-implementation would only ever agree with itself — the two halves could
// drift apart and this file would keep passing. Imported by path because the
// reviver is deliberately not on the `@rebasepro/client` public barrel.
import { rebaseReviver } from "../../client/src/reviver";

describe("Relation data JSON round-trip", () => {
    it("should preserve relation data through JSON.stringify → JSON.parse with reviver", () => {
        const clientEntity = {
            id: "client-uuid-123",
            path: "clients",
            values: {
                name: "Francesco",
                email: "f@test.com",
                status: "active"
            }
        };

        // Server creates this
        const ref = createRelationRefWithData(clientEntity.id, clientEntity.path, clientEntity as any);

        // Verify server-side structure
        expect(ref.__type).toBe("relation");
        expect(ref.id).toBe("client-uuid-123");
        expect(ref.path).toBe("clients");
        expect(ref.data).toBeDefined();
        expect(ref.data.values.name).toBe("Francesco");

        // Simulate full entity with relation in values
        const taskEntity = {
            id: "task-uuid-456",
            path: "tasks",
            values: {
                title: "Send intro email",
                client: ref,
                status: "pending"
            }
        };

        // Server JSON.stringify for WebSocket
        const json = JSON.stringify(taskEntity);

        // Client JSON.parse with reviver
        const parsed = JSON.parse(json, rebaseReviver);

        // The client relation should be a EntityRelation instance
        const clientRelation = parsed.values.client;
        expect(clientRelation).toBeInstanceOf(EntityRelation);
        expect(clientRelation.id).toBe("client-uuid-123");
        expect(clientRelation.path).toBe("clients");

        // The data field should be preserved
        expect(clientRelation.data).toBeDefined();
        expect(clientRelation.data.values).toBeDefined();
        expect(clientRelation.data.values.name).toBe("Francesco");
        expect(clientRelation.data.values.email).toBe("f@test.com");
    });

    it("should handle entity with no relation data (stub)", () => {
        const stubRef = { id: "client-uuid",
path: "clients",
__type: "relation" as const };

        const json = JSON.stringify({ values: { client: stubRef } });
        const parsed = JSON.parse(json, rebaseReviver);

        const clientRelation = parsed.values.client;
        expect(clientRelation).toBeInstanceOf(EntityRelation);
        expect(clientRelation.id).toBe("client-uuid");

        // data should be undefined for stubs
        expect(clientRelation.data).toBeUndefined();
    });

    it("should handle WebSocket collection_update message format", () => {
        const clientEntity = {
            id: "client-uuid",
            path: "clients",
            values: { name: "Acme Corp",
email: "acme@corp.com" }
        };

        const ref = createRelationRefWithData(clientEntity.id, clientEntity.path, clientEntity as any);

        // Simulate full WebSocket message
        const wsMessage = {
            type: "collection_update",
            subscriptionId: "sub-123",
            entities: [
                {
                    id: "task-1",
                    path: "tasks",
                    values: { title: "Task A",
client: ref,
status: "pending" }
                },
                {
                    id: "task-2",
                    path: "tasks",
                    values: { title: "Task B",
client: ref,
status: "completed" }
                }
            ]
        };

        const json = JSON.stringify(wsMessage);
        const parsed = JSON.parse(json, rebaseReviver);

        // Both tasks should have correctly hydrated client relations
        for (const entity of parsed.entities) {
            const clientRel = entity.values.client;
            expect(clientRel).toBeInstanceOf(EntityRelation);
            expect(clientRel.data).toBeDefined();
            expect(clientRel.data.values.name).toBe("Acme Corp");
        }
    });
});

