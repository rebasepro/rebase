import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { eq } from "drizzle-orm";
import { integer, pgTable, PgDialect, primaryKey, serial, varchar, text } from "drizzle-orm/pg-core";
import { CollectionConfig, EntityRelation, Relation } from "@rebasepro/types";
import { resolveRelation } from "@rebasepro/common";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";
import { getColumnMeta } from "../src/services/collection-helpers";

// Mock tables for testing
const mockAuthorsTable = pgTable("authors", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    email: varchar("email").notNull()
});

const mockPostsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title").notNull(),
    content: varchar("content"),
    author_id: integer("author_id")
});

const mockTagsTable = pgTable("tags", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull()
});

const mockPostsTagsTable = pgTable("posts_tags", {
    post_id: integer("post_id").notNull(),
    tag_id: integer("tag_id").notNull()
}, (table) => ({
    pk: primaryKey({ columns: [table.post_id, table.tag_id] })
}));

// Mock registry
const createMockRegistry = () => {
    const registry = {
        getTable: jest.fn()
    } as unknown as PostgresCollectionRegistry;

    (registry.getTable as jest.Mock).mockImplementation((tableName: string) => {
        switch (tableName) {
            case "authors": return mockAuthorsTable;
            case "posts": return mockPostsTable;
            case "tags": return mockTagsTable;
            case "posts_tags": return mockPostsTagsTable;
            default: return undefined;
        }
    });

    return registry;
};

describe("DrizzleConditionBuilder - Many-to-Many Relations", () => {
    let mockRegistry: PostgresCollectionRegistry;

    beforeEach(() => {
        mockRegistry = createMockRegistry();
        jest.clearAllMocks();
    });

    describe("buildRelationConditions - Owning Many-to-Many", () => {
        it("should build correct conditions for owning many-to-many relation", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "tags",
                target: () => ({ slug: "tags" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "post_id",
                    targetColumn: "tag_id"
                }
            };

            const result = DrizzleConditionBuilder.buildRelationConditions(
                relation,
                1, // parentEntityId (post ID)
                mockTagsTable, // targetTable
                mockPostsTable, // parentTable
                mockPostsTable.id, // parentIdColumn
                mockTagsTable.id, // targetIdColumn
                mockRegistry
            );

            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);
            expect(mockRegistry.getTable).toHaveBeenCalledWith("posts_tags");
        });

        it("should handle array of parent entity IDs for owning relation", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "tags",
                target: () => ({ slug: "tags" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "post_id",
                    targetColumn: "tag_id"
                }
            };

            const result = DrizzleConditionBuilder.buildRelationConditions(
                relation,
                [1, 2, 3], // multiple post IDs
                mockTagsTable,
                mockPostsTable,
                mockPostsTable.id,
                mockTagsTable.id,
                mockRegistry
            );

            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);
        });
    });

    describe("buildRelationConditions - Inverse Many-to-Many", () => {
        it("should build correct conditions for inverse many-to-many relation", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "posts",
                target: () => ({ slug: "posts" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "tag_id",
                    targetColumn: "post_id"
                }
            };

            const result = DrizzleConditionBuilder.buildRelationConditions(
                relation,
                20, // parentEntityId (tag ID)
                mockPostsTable, // targetTable
                mockTagsTable, // parentTable
                mockTagsTable.id, // parentIdColumn
                mockPostsTable.id, // targetIdColumn
                mockRegistry
            );

            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);
            expect(mockRegistry.getTable).toHaveBeenCalledWith("posts_tags");
        });

        it("should handle array of parent entity IDs for inverse relation", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "posts",
                target: () => ({ slug: "posts" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "tag_id",
                    targetColumn: "post_id"
                }
            };

            const result = DrizzleConditionBuilder.buildRelationConditions(
                relation,
                [20, 21, 22], // multiple tag IDs
                mockPostsTable,
                mockTagsTable,
                mockTagsTable.id,
                mockPostsTable.id,
                mockRegistry
            );

            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);
        });
    });

    describe("Join Path Relations with Junction Tables", () => {
        it("should handle join paths that include many-to-many relationships", () => {
            // Create a special mock registry that simulates missing direct foreign keys
            const mockRegistryForJunction = {
                getTable: jest.fn()
            } as unknown as PostgresCollectionRegistry;

            // Create tables without the direct foreign key relationship
            const mockPostsTableNoDirect = pgTable("posts", {
                id: serial("id").primaryKey(),
                title: varchar("title").notNull(),
                content: varchar("content")
                // Note: NO tag_id foreign key column
            });

            const mockTagsTableNoDirect = pgTable("tags", {
                id: serial("id").primaryKey(),
                name: varchar("name").notNull()
                // Note: NO post_id foreign key column
            });

            (mockRegistryForJunction.getTable as jest.Mock).mockImplementation((tableName: string) => {
                switch (tableName) {
                    case "posts": return mockPostsTableNoDirect;
                    case "tags": return mockTagsTableNoDirect;
                    case "posts_tags": return mockPostsTagsTable;
                    default: return undefined;
                }
            });

            // Simulate a join path like: Post -> Tags (where posts would need tag_id but doesn't have it)
            const joinPathWithJunction = [
                {
                    table: "tags",
                    on: {
                        from: "posts.tag_id", // This column doesn't exist - should trigger junction table discovery
                        to: "tags.id"
                    }
                }
            ];

            const relation: Relation = {
                kind: "via",
                relationName: "tags_via_join",
                target: () => ({ slug: "tags" } as unknown as CollectionConfig),
                cardinality: "many",
                joinPath: joinPathWithJunction
            };

            // Should automatically detect and use the posts_tags junction table
            const result = DrizzleConditionBuilder.buildRelationConditions(
                relation,
                1, // post ID
                mockTagsTableNoDirect, // target table (tags)
                mockPostsTableNoDirect, // parent table (posts)
                mockPostsTableNoDirect.id, // parent ID column
                mockTagsTableNoDirect.id, // target ID column
                mockRegistryForJunction
            );

            expect(result.joinConditions.length).toBeGreaterThan(0);
            expect(result.whereConditions).toHaveLength(1);
            expect(mockRegistryForJunction.getTable).toHaveBeenCalledWith("posts_tags");
        });

        it("should fallback to error when no junction table is found for missing foreign keys", () => {
            const joinPathWithMissingRelation = [
                {
                    table: "nonexistent_table",
                    on: {
                        from: "posts.nonexistent_column",
                        to: "nonexistent_table.id"
                    }
                }
            ];

            const relation: Relation = {
                kind: "via",
                relationName: "missing_relation",
                target: () => ({ slug: "nonexistent" } as unknown as CollectionConfig),
                cardinality: "one",
                joinPath: joinPathWithMissingRelation
            };

            expect(() => {
                DrizzleConditionBuilder.buildRelationConditions(
                    relation,
                    1,
                    mockTagsTable,
                    mockPostsTable,
                    mockPostsTable.id,
                    mockTagsTable.id,
                    mockRegistry
                );
            }).toThrow("Join tables not found");
        });

        it("should handle complex multi-hop join paths with junction tables", () => {
            // Simulate: Author -> Posts -> Tags (where Posts-Tags uses junction table)
            const complexJoinPath = [
                {
                    table: "posts",
                    on: {
                        from: "authors.id",
                        to: "posts.author_id"
                    }
                },
                {
                    table: "tags",
                    on: {
                        from: "posts.id", // This will require posts_tags junction
                        to: "tags.id"
                    }
                }
            ];

            const relation: Relation = {
                kind: "via",
                relationName: "author_tags",
                target: () => ({ slug: "tags" } as unknown as CollectionConfig),
                cardinality: "many",
                joinPath: complexJoinPath
            };

            const result = DrizzleConditionBuilder.buildRelationConditions(
                relation,
                1, // author ID
                mockTagsTable, // target (tags)
                mockAuthorsTable, // parent (authors)
                mockAuthorsTable.id,
                mockTagsTable.id,
                mockRegistry
            );

            expect(result.joinConditions.length).toBeGreaterThan(1); // Should have multiple joins
            expect(result.whereConditions).toHaveLength(1);
        });
    });

    describe("Junction Table Discovery", () => {
        it("should try multiple naming patterns for junction tables", () => {
            const relation: Relation = {
                kind: "via",
                relationName: "test_junction",
                target: () => ({ slug: "tags" } as unknown as CollectionConfig),
                cardinality: "many",
                joinPath: [
                    {
                        table: "tags",
                        on: {
                            from: "posts.id",
                            to: "tags.id"
                        }
                    }
                ]
            };

            // Mock the registry to return undefined for first attempts, then return junction table
            const mockRegistryWithPatterns = {
                getTable: jest.fn()
            } as unknown as PostgresCollectionRegistry;

            (mockRegistryWithPatterns.getTable as jest.Mock)
                .mockReturnValueOnce(mockPostsTable) // posts table
                .mockReturnValueOnce(mockTagsTable) // tags table
                .mockReturnValueOnce(undefined) // posts_tags (first attempt)
                .mockReturnValueOnce(undefined) // tags_posts (second attempt)
                .mockReturnValueOnce(mockPostsTagsTable); // Found it!

            expect(() => {
                DrizzleConditionBuilder.buildRelationConditions(
                    relation,
                    1,
                    mockTagsTable,
                    mockPostsTable,
                    mockPostsTable.id,
                    mockTagsTable.id,
                    mockRegistryWithPatterns
                );
            }).not.toThrow();
        });
    });

    describe("Error handling", () => {
        it("should throw error when junction table is not found", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "posts",
                target: () => ({ slug: "posts" } as unknown as CollectionConfig),
                through: {
                    table: "nonexistent_table",
                    sourceColumn: "tag_id",
                    targetColumn: "post_id"
                }
            };

            expect(() => {
                DrizzleConditionBuilder.buildRelationConditions(
                    relation,
                    20,
                    mockPostsTable,
                    mockTagsTable,
                    mockTagsTable.id,
                    mockPostsTable.id,
                    mockRegistry
                );
            }).toThrow("Junction table not found: nonexistent_table");
        });

        it("should throw error when source column is not found in junction table", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "posts",
                target: () => ({ slug: "posts" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "nonexistent_column",
                    targetColumn: "post_id"
                }
            };

            expect(() => {
                DrizzleConditionBuilder.buildRelationConditions(
                    relation,
                    20,
                    mockPostsTable,
                    mockTagsTable,
                    mockTagsTable.id,
                    mockPostsTable.id,
                    mockRegistry
                );
            }).toThrow("Source column 'nonexistent_column' not found in junction table 'posts_tags'");
        });

        it("should throw error when target column is not found in junction table", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "posts",
                target: () => ({ slug: "posts" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "tag_id",
                    targetColumn: "nonexistent_column"
                }
            };

            expect(() => {
                DrizzleConditionBuilder.buildRelationConditions(
                    relation,
                    20,
                    mockPostsTable,
                    mockTagsTable,
                    mockTagsTable.id,
                    mockPostsTable.id,
                    mockRegistry
                );
            }).toThrow("Target column 'nonexistent_column' not found in junction table 'posts_tags'");
        });
    });

    describe("buildRelationCountQuery - Many-to-Many", () => {
        it("should build correct count query for owning many-to-many relation", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "tags",
                target: () => ({ slug: "tags" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "post_id",
                    targetColumn: "tag_id"
                }
            };

            const mockBaseQuery = {
                innerJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                $dynamic: jest.fn().mockReturnThis()
            };

            const result = DrizzleConditionBuilder.buildRelationCountQuery(
                mockBaseQuery,
                relation,
                1, // parentEntityId
                mockTagsTable,
                mockPostsTable,
                mockPostsTable.id,
                mockTagsTable.id,
                mockRegistry
            );

            expect(mockBaseQuery.innerJoin).toHaveBeenCalled();
            expect(mockBaseQuery.where).toHaveBeenCalled();
        });

        it("should build correct count query for inverse many-to-many relation", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "posts",
                target: () => ({ slug: "posts" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "tag_id",
                    targetColumn: "post_id"
                }
            };

            const mockBaseQuery = {
                innerJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                $dynamic: jest.fn().mockReturnThis()
            };

            const result = DrizzleConditionBuilder.buildRelationCountQuery(
                mockBaseQuery,
                relation,
                20, // parentEntityId (tag ID)
                mockPostsTable,
                mockTagsTable,
                mockTagsTable.id,
                mockPostsTable.id,
                mockRegistry
            );

            expect(mockBaseQuery.innerJoin).toHaveBeenCalled();
            expect(mockBaseQuery.where).toHaveBeenCalled();
        });
    });

    describe("buildRelationQuery - Many-to-Many", () => {
        it("should build correct query for owning many-to-many relation with additional filters", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "tags",
                target: () => ({ slug: "tags" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "post_id",
                    targetColumn: "tag_id"
                }
            };

            const mockBaseQuery = {
                innerJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                $dynamic: jest.fn().mockReturnThis()
            };

            const additionalFilters = [eq(mockTagsTable.name, "javascript")];

            const result = DrizzleConditionBuilder.buildRelationQuery(
                mockBaseQuery,
                relation,
                1, // parentEntityId
                mockTagsTable,
                mockPostsTable,
                mockPostsTable.id,
                mockTagsTable.id,
                mockRegistry,
                additionalFilters
            );

            expect(mockBaseQuery.innerJoin).toHaveBeenCalled();
            expect(mockBaseQuery.where).toHaveBeenCalled();
        });

        it("should build correct query for inverse many-to-many relation with additional filters", () => {
            const relation: Relation = {
                kind: "manyToMany",
                relationName: "posts",
                target: () => ({ slug: "posts" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "tag_id",
                    targetColumn: "post_id"
                }
            };

            const mockBaseQuery = {
                innerJoin: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                $dynamic: jest.fn().mockReturnThis()
            };

            const additionalFilters = [eq(mockPostsTable.title, "Test Post")];

            const result = DrizzleConditionBuilder.buildRelationQuery(
                mockBaseQuery,
                relation,
                20, // parentEntityId (tag ID)
                mockPostsTable,
                mockTagsTable,
                mockTagsTable.id,
                mockPostsTable.id,
                mockRegistry,
                additionalFilters
            );

            expect(mockBaseQuery.innerJoin).toHaveBeenCalled();
            expect(mockBaseQuery.where).toHaveBeenCalled();
        });
    });

    describe("Real-world scenario: tags/20/posts", () => {
        it("should correctly handle the tags/20/posts scenario that was failing", () => {
            // This is the exact scenario from the user's error
            const tagsToPostsRelation: Relation = {
                kind: "manyToMany",
                relationName: "posts",
                target: () => ({ slug: "posts" } as unknown as CollectionConfig),
                through: {
                    table: "posts_tags",
                    sourceColumn: "tag_id", // FK to this collection's PK in junction table
                    targetColumn: "post_id" // FK to the target collection's PK in junction table
                }
            };

            const result = DrizzleConditionBuilder.buildRelationConditions(
                tagsToPostsRelation,
                20, // tag ID from URL: tags/20/posts
                mockPostsTable, // we want to get posts
                mockTagsTable, // from the tags collection
                mockTagsTable.id, // tag ID column
                mockPostsTable.id, // post ID column
                mockRegistry
            );

            // Should not throw an error and should return proper conditions
            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);

            // Verify the registry was called correctly
            expect(mockRegistry.getTable).toHaveBeenCalledWith("posts_tags");

            // This should no longer throw "Foreign key column 'tags_id' not found in target table"
            expect(() => result).not.toThrow();
        });


        it("cannot reach the state that lookup existed to repair", () => {


            // `sanitizeRelation` used to add a `foreignKeyOnTarget` to what was


            // really a many-to-many, and the builder had to notice and go hunting


            // for a junction. Declaring the kind makes that unrepresentable.


            const posts = { slug: "posts", name: "Posts", table: "posts", properties: {} } as unknown as CollectionConfig;


            const tags = { slug: "tags", name: "Tags", table: "tags", properties: {} } as unknown as CollectionConfig;



            const m2m = resolveRelation({ kind: "manyToMany", relationName: "posts", target: () => posts }, tags);


            expect(m2m).not.toHaveProperty("foreignKeyOnTarget");



            const oneToMany = resolveRelation({ kind: "hasMany", relationName: "posts", target: () => posts }, tags);


            expect(oneToMany).not.toHaveProperty("through");


        });

    });

    // Test the specific fix for findCorrespondingJunctionTable method

    describe("a many-to-many names its own junction", () => {

        // Replaces a suite for `findCorrespondingJunctionTable` — a search

        // through the *target's* relations for an owning many-to-many whose

        // name matched, to borrow its junction and swap the columns. Each

        // side declares its own now, so there is nothing to look up.

        const posts = { slug: "posts", name: "Posts", table: "posts", properties: {} } as unknown as CollectionConfig;

        const tags = { slug: "tags", name: "Tags", table: "tags", properties: {} } as unknown as CollectionConfig;


        it("uses the junction the relation declares", () => {

            const rel = resolveRelation({

                kind: "manyToMany", relationName: "posts", target: () => posts,

                through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" }

            }, tags);

            expect(rel.kind === "manyToMany" && rel.through).toEqual({

                table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id"

            });

        });


        it("derives one when the relation names none", () => {

            const rel = resolveRelation({ kind: "manyToMany", relationName: "posts", target: () => posts }, tags);

            expect(rel.kind === "manyToMany" && rel.through.sourceColumn).toBe("tag_id");

        });

    });

});

describe("DrizzleConditionBuilder - Filter Operators", () => {
    // Mock table for filter tests
    const mockUsersTable = pgTable("users", {
        id: serial("id").primaryKey(),
        name: varchar("name").notNull(),
        email: varchar("email").notNull(),
        age: integer("age"),
        tags: text("tags").array()
    });

    describe("buildSingleFilterCondition - array-contains", () => {
        const { PgDialect } = require("drizzle-orm/pg-core");
        const pgDialect = new PgDialect();

        it("should generate a native array condition for native array columns", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.tags,
                "array-contains",
                "featured"
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."tags" @> ARRAY[$1]');
            expect(query.params).toEqual(["featured"]);
        });

        it("should generate a JSONB condition for non-native array columns", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.name,
                "array-contains",
                "featured"
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."name" @> $1');
            expect(query.params).toEqual(['["featured"]']);
        });
    });

    describe("buildSingleFilterCondition - array-contains-any", () => {
        const { PgDialect } = require("drizzle-orm/pg-core");
        const pgDialect = new PgDialect();

        it("should generate a native array overlap condition for native array columns", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.tags,
                "array-contains-any",
                ["featured", "popular", "trending"]
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."tags" && ARRAY[$1, $2, $3]');
            expect(query.params).toEqual(["featured", "popular", "trending"]);
        });

        it("should generate a JSONB overlap (?|) condition for non-native array columns", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.name,
                "array-contains-any",
                ["featured", "popular", "trending"]
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."name" ?| array[$1, $2, $3]');
            expect(query.params).toEqual(["featured", "popular", "trending"]);
        });

        it("should fallback to native array-contains for native array columns with single value", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.tags,
                "array-contains-any",
                "featured"
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."tags" @> ARRAY[$1]');
            expect(query.params).toEqual(["featured"]);
        });

        it("should fallback to JSONB array-contains for non-native array columns with single value", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.name,
                "array-contains-any",
                "featured"
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."name" @> $1');
            expect(query.params).toEqual(['["featured"]']);
        });
    });

    describe("buildSingleFilterCondition - not-in", () => {
        it("should generate a non-null condition for an array of values", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "not-in",
                [1, 2, 3]
            );
            expect(condition).not.toBeNull();
        });

        it("matches every row for an empty array, rather than dropping", () => {
            // Excluding nothing excludes nothing. Returning no condition said
            // the same thing by accident and said the *opposite* for `in`, so
            // both now state it.
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "not-in",
                []
            );
            expect(new PgDialect().sqlToQuery(condition!).sql).toBe("TRUE");
        });

        it("reads a scalar as the one-element list", () => {
            // `?filter=age.not-in.42` parses to the string, not to a list —
            // the REST dialect only builds an array for a parenthesised value.
            // Dropping it left the read unfiltered.
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "not-in",
                42
            );
            const query = new PgDialect().sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."age" NOT IN ($1)');
            expect(query.params).toEqual([42]);
        });
    });

    describe("buildSingleFilterCondition - existing operators", () => {
        it("should generate a condition for equality", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.name,
                "==",
                "alice"
            );
            expect(condition).not.toBeNull();
        });

        it("should generate IS NULL for equality with null", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.name,
                "==",
                null
            );
            expect(condition).not.toBeNull();
        });

        it("should generate IS NOT NULL for inequality with null", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.name,
                "!=",
                null
            );
            expect(condition).not.toBeNull();
        });

        it("should handle in operator with array", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "in",
                [18, 21, 25]
            );
            expect(condition).not.toBeNull();
        });

        it("matches no row for `in` with an empty array, rather than dropping", () => {
            // The inversion this whole path exists to prevent: `in []` selects
            // nothing, and no condition at all selects everything.
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "in",
                []
            );
            expect(new PgDialect().sqlToQuery(condition!).sql).toBe("FALSE");
        });

        it("should warn and return null for unsupported operators", () => {
            const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "unknown-op" as any,
                42
            );
            expect(condition).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unsupported filter operation: unknown-op"));
            warnSpy.mockRestore();
        });
    });

    describe("buildSingleFilterCondition - pattern matching and null operators", () => {
        const { PgDialect } = require("drizzle-orm/pg-core");
        const pgDialect = new PgDialect();

        it("should generate LIKE", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.name, "like", "post-%"
            );
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."name" LIKE $1');
            expect(query.params).toEqual(["post-%"]);
        });

        it("should generate ILIKE", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.name, "ilike", "%john%"
            );
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"users"."name" ILIKE $1');
            expect(query.params).toEqual(["%john%"]);
        });

        it("should generate NOT LIKE and NOT ILIKE", () => {
            const notLike = pgDialect.sqlToQuery(
                DrizzleConditionBuilder.buildSingleFilterCondition(mockUsersTable.name, "not-like", "tmp-%")!
            );
            expect(notLike.sql).toBe('"users"."name" NOT LIKE $1');

            const notIlike = pgDialect.sqlToQuery(
                DrizzleConditionBuilder.buildSingleFilterCondition(mockUsersTable.name, "not-ilike", "%draft%")!
            );
            expect(notIlike.sql).toBe('"users"."name" NOT ILIKE $1');
        });

        it("should generate IS NULL / IS NOT NULL ignoring the value", () => {
            const isNull = pgDialect.sqlToQuery(
                DrizzleConditionBuilder.buildSingleFilterCondition(mockUsersTable.age, "is-null", null)!
            );
            expect(isNull.sql).toBe('"users"."age" IS NULL');
            expect(isNull.params).toEqual([]);

            const isNotNull = pgDialect.sqlToQuery(
                DrizzleConditionBuilder.buildSingleFilterCondition(mockUsersTable.age, "is-not-null", null)!
            );
            expect(isNotNull.sql).toBe('"users"."age" IS NOT NULL');
            expect(isNotNull.params).toEqual([]);
        });
    });

    describe("buildFilterConditions - integration with array operators", () => {
        it("should build filter with array-contains operator", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { name: ["array-contains", "featured"] },
                mockUsersTable,
                "users"
            );
            expect(conditions).toHaveLength(1);
        });

        it("should build filter with array-contains-any operator", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { name: ["array-contains-any", ["featured", "popular"]] },
                mockUsersTable,
                "users"
            );
            expect(conditions).toHaveLength(1);
        });

        it("should build filter with not-in operator", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { age: ["not-in", [1, 2, 3]] },
                mockUsersTable,
                "users"
            );
            expect(conditions).toHaveLength(1);
        });

        it("keeps a not-in filter with an empty array instead of skipping it", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { age: ["not-in", []] },
                mockUsersTable,
                "users"
            );
            expect(conditions).toHaveLength(1);
            expect(new PgDialect().sqlToQuery(conditions[0]).sql).toBe("TRUE");
        });
    });

    describe("buildFilterConditions - relation wire objects (regression)", () => {
        const { PgDialect } = require("drizzle-orm/pg-core");
        const pgDialect = new PgDialect();

        it("should unwrap a serialized relation object to its id when filtering an FK column", () => {
            // Admin relation filter arrives over the wire as a plain JSON object
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { author: ["==", { __type: "relation", id: "167", path: "authors" }] },
                mockPostsTable,
                "posts"
            );
            expect(conditions).toHaveLength(1);
            const query = pgDialect.sqlToQuery(conditions[0]);
            expect(query.sql).toBe('"posts"."author_id" = $1');
            expect(query.params).toEqual(["167"]);
        });

        it("should unwrap an EntityRelation instance to its id", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockPostsTable.author_id,
                "==",
                new EntityRelation(42, "authors")
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.sql).toBe('"posts"."author_id" = $1');
            expect(query.params).toEqual([42]);
        });

        it("should unwrap relation objects element-wise for list operators", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockPostsTable.author_id,
                "in",
                [
                    { __type: "relation", id: "1", path: "authors" },
                    new EntityRelation("2", "authors")
                ]
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.params).toEqual(["1", "2"]);
        });

        it("should leave non-relation values untouched", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockPostsTable.author_id,
                "==",
                167
            );
            expect(condition).not.toBeNull();
            const query = pgDialect.sqlToQuery(condition!);
            expect(query.params).toEqual([167]);
        });
    });
});


describe("DrizzleConditionBuilder - manyToMany scope SQL", () => {
    const { PgDialect } = require("drizzle-orm/pg-core");
    const pgDialect = new PgDialect();

    const relation: Relation = {
        kind: "manyToMany",
        relationName: "tags",
        target: () => ({ slug: "tags" } as unknown as CollectionConfig),
        through: {
            table: "posts_tags",
            sourceColumn: "post_id",
            targetColumn: "tag_id"
        }
    };

    const build = () =>
        DrizzleConditionBuilder.buildRelationScopeCondition(
            resolveRelation(relation, { slug: "posts" } as unknown as CollectionConfig),
            () => ({ table: mockPostsTable, idColumn: mockPostsTable.id }),
            1,
            mockTagsTable,
            mockTagsTable.id,
            createMockRegistry()
        );

    // The junction's columns must not be rendered as bare Drizzle columns. A column
    // object carries no table qualifier, so inside `db.query.findMany` — which
    // aliases the root table — they came out qualified with the *target's* alias
    // (`"tags"."tag_id"`), a column that does not exist. Postgres then aborts the
    // transaction and the fallback read dies on 25P02, three steps from the cause.
    it("qualifies junction columns with the junction, never the target table", () => {
        const { sql: text } = pgDialect.sqlToQuery(build());

        expect(text).toContain('"posts_tags" AS "__rel_m2m"');
        expect(text).toContain('"__rel_m2m"."tag_id"');
        expect(text).toContain('"__rel_m2m"."post_id"');
        // The precise regression: a junction column wearing the target's name.
        expect(text).not.toContain('"tags"."tag_id"');
        expect(text).not.toContain('"tags"."post_id"');
    });

    // The other half: the correlation has to stay bound to the outer row, so the
    // target's key is the one thing that must remain a Drizzle column.
    it("correlates on the outer target row", () => {
        const { sql: text, params } = pgDialect.sqlToQuery(build());

        expect(text).toContain('"__rel_m2m"."tag_id" = "tags"."id"');
        expect(params).toEqual([1]);
    });
});
