import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { eq } from "drizzle-orm";
import { integer, pgTable, primaryKey, serial, varchar, text } from "drizzle-orm/pg-core";
import { CollectionConfig, EntityRelation, Relation } from "@rebasepro/types";
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

        it("should handle inverse many-to-many without explicit through property (real user scenario)", () => {
            // Create a more realistic mock that simulates the actual scenario
            const mockPostsCollection = {
                slug: "posts",
                table: "posts",
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "tags",
                        through: {
                            table: "posts_tags",
                            sourceColumn: "post_id",
                            targetColumn: "tag_id"
                        },
                        target: () => ({ slug: "tags" })
                    }
                ]
            };

            // This is the ACTUAL scenario: inverse relation without through property
            // but with foreignKeyOnTarget incorrectly added by sanitizeRelation
            const tagsToPostsRelation: Relation = {
                kind: "hasMany",
                relationName: "posts",
                target: () => mockPostsCollection as unknown as CollectionConfig,
                foreignKeyOnTarget: "tag_id" // This gets added by sanitizeRelation at runtime
                // NO through property - this is the key difference
            };

            // The fix should handle this case correctly by ignoring the foreignKeyOnTarget
            // and finding the junction table from the corresponding owning relation
            const result = DrizzleConditionBuilder.buildRelationConditions(
                tagsToPostsRelation,
                23, // tag ID from URL: tags/23/posts (matching the user's log)
                mockPostsTable, // we want to get posts
                mockTagsTable, // from the tags collection
                mockTagsTable.id, // tag ID column
                mockPostsTable.id, // post ID column
                mockRegistry
            );

            // Should successfully find junction table and build conditions
            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);

            // Verify it used the junction table approach, not the simple relation approach
            expect(mockRegistry.getTable).toHaveBeenCalledWith("posts_tags");

            // Should not throw the "Foreign key column 'tag_id' not found in target table" error
            expect(() => result).not.toThrow();
        });
    });

    // Test the specific fix for findCorrespondingJunctionTable method
    describe("findCorrespondingJunctionTable - Junction Table Lookup Fix", () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it("should find corresponding junction table for inverse many-to-many relation", () => {
            // Create real test collections with proper relation configurations
            const mockTagsCollection = {
                slug: "tags",
                table: "tags"
            };

            const mockPostsCollection = {
                slug: "posts",
                table: "posts",
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "tags",
                        through: {
                            table: "posts_tags",
                            sourceColumn: "post_id",
                            targetColumn: "tag_id"
                        },
                        target: () => mockTagsCollection
                    }
                ]
            };

            // Create the inverse relation (tags -> posts)
            const inverseRelation: Relation = {
                // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                // Was: cardinality=many direction=inverse
                kind: "AMBIGUOUS",
                relationName: "posts",
                target: () => mockPostsCollection as unknown as CollectionConfig,
                };

            // Test the buildRelationConditions with the inverse relation (without explicit through)
            const result = DrizzleConditionBuilder.buildRelationConditions(
                inverseRelation,
                5, // tag ID
                mockPostsTable, // targetTable (posts)
                mockTagsTable, // parentTable (tags)
                mockTagsTable.id, // parentIdColumn (tag.id)
                mockPostsTable.id, // targetIdColumn (post.id)
                mockRegistry
            );

            // Should successfully build conditions using the found junction table
            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);

            // Should have looked up the junction table
            expect(mockRegistry.getTable).toHaveBeenCalledWith("posts_tags");
        });

        it("should handle the exact user scenario that was failing", () => {
            // This is the exact scenario from the user's collection configuration
            const mockTagsCollection = {
                slug: "tags",
                table: "tags"
            };

            const mockPostsCollection = {
                slug: "posts",
                table: "posts",
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "tags",
                        through: {
                            table: "posts_tags",
                            sourceColumn: "post_id",
                            targetColumn: "tag_id"
                        },
                        target: () => mockTagsCollection
                    }
                ]
            };

            // The inverse relation from tags collection (this was failing before the fix)
            const tagsToPostsRelation: Relation = {
                // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                // Was: cardinality=many direction=inverse
                kind: "AMBIGUOUS",
                relationName: "posts",
                target: () => mockPostsCollection as unknown as CollectionConfig,
                };

            // This should NOT throw "Foreign key column 'tag_id' not found in target table"
            const result = DrizzleConditionBuilder.buildRelationConditions(
                tagsToPostsRelation,
                42, // tag ID
                mockPostsTable,
                mockTagsTable,
                mockTagsTable.id,
                mockPostsTable.id,
                mockRegistry
            );

            // Should successfully find the junction table and build conditions
            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);

            // Verify it found the junction table correctly
            expect(mockRegistry.getTable).toHaveBeenCalledWith("posts_tags");
        });

        it("should return appropriate error when no corresponding junction table is found", () => {
            const mockPostsCollection = {
                slug: "posts",
                table: "posts",
                relations: [] // No relations - should fail to find junction table
            };

            const inverseRelation: Relation = {
                // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                // Was: cardinality=many direction=inverse
                kind: "AMBIGUOUS",
                relationName: "posts",
                target: () => mockPostsCollection as unknown as CollectionConfig,
                };

            // Should fall back to checking foreignKeyOnTarget or throw appropriate error
            expect(() => {
                DrizzleConditionBuilder.buildRelationConditions(
                    inverseRelation,
                    5,
                    mockPostsTable,
                    mockTagsTable,
                    mockTagsTable.id,
                    mockPostsTable.id,
                    mockRegistry
                );
            }).toThrow(/Cannot resolve inverse many relation/);
        });

        it("should swap source and target columns correctly for inverse relations", () => {
            const mockTagsCollection = {
                slug: "tags",
                table: "tags"
            };

            const mockPostsCollection = {
                slug: "posts",
                table: "posts",
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "tags",
                        through: {
                            table: "posts_tags",
                            sourceColumn: "post_id", // From posts perspective
                            targetColumn: "tag_id" // To tags perspective
                        },
                        target: () => mockTagsCollection
                    }
                ]
            };

            const inverseRelation: Relation = {
                // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                // Was: cardinality=many direction=inverse
                kind: "AMBIGUOUS",
                relationName: "posts",
                target: () => mockPostsCollection as unknown as CollectionConfig,
                };

            const result = DrizzleConditionBuilder.buildRelationConditions(
                inverseRelation,
                7, // tag ID
                mockPostsTable,
                mockTagsTable,
                mockTagsTable.id,
                mockPostsTable.id,
                mockRegistry
            );

            // The junction table lookup should swap the columns for inverse direction
            // From tags perspective: sourceColumn becomes "tag_id", targetColumn becomes "post_id"
            expect(result.joinConditions).toHaveLength(1);
            expect(result.whereConditions).toHaveLength(1);
            expect(mockRegistry.getTable).toHaveBeenCalledWith("posts_tags");
        });

        it("should handle missing inverseRelationName gracefully", () => {
            const mockPostsCollection = {
                slug: "posts",
                table: "posts",
                relations: []
            };

            const inverseRelationWithoutInverseName: Relation = {
                // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                // Was: cardinality=many direction=?
                kind: "AMBIGUOUS",
                relationName: "posts",
                target: () => mockPostsCollection as unknown as CollectionConfig,
                };

            // Should throw an appropriate error since it can't find the junction table
            expect(() => {
                DrizzleConditionBuilder.buildRelationConditions(
                    inverseRelationWithoutInverseName,
                    5,
                    mockPostsTable,
                    mockTagsTable,
                    mockTagsTable.id,
                    mockPostsTable.id,
                    mockRegistry
                );
            }).toThrow(/Cannot resolve inverse many relation/);
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

        it("should return null for empty array", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "not-in",
                []
            );
            expect(condition).toBeNull();
        });

        it("should return null for non-array value", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "not-in",
                42
            );
            expect(condition).toBeNull();
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

        it("should return null for in operator with empty array", () => {
            const condition = DrizzleConditionBuilder.buildSingleFilterCondition(
                mockUsersTable.age,
                "in",
                []
            );
            expect(condition).toBeNull();
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

        it("should skip not-in filter with empty array", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { age: ["not-in", []] },
                mockUsersTable,
                "users"
            );
            expect(conditions).toHaveLength(0);
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

