import { EntityCollection, Relation } from "@rebasepro/types";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { sanitizeRelation } from "@rebasepro/common";
import { describe, it, expect } from "vitest";

const mockAuthorCollection: EntityCollection = {
    name: "Author",
    slug: "author",
    table: "authors",
    properties: {
        id: {
            type: "number"
        },
        name: {
            type: "string"
        }
    },
    idField: "id"
};

const mockPostCollection: EntityCollection = {
    name: "Post",
    slug: "posts",
    table: "posts",
    properties: {
        id: {
            type: "number"
        },
        title: {
            type: "string"
        },
        author_id: {
            type: "number"
        }
    },
    idField: "id"
};

const mockTagCollection: EntityCollection = {
    name: "Tag",
    slug: "tags",
    table: "tags",
    properties: {
        id: {
            type: "string"
        },
        name: {
            type: "string"
        }
    },
    idField: "id"
};

describe("sanitizeRelation", () => {

    it("should generate a default relationName if not provided", () => {
        const relation: Partial<Relation> = {
            target: () => mockPostCollection,
            cardinality: "one"
        };
        const normalized = sanitizeRelation(relation, mockAuthorCollection);
        expect(normalized.relationName).toBe("posts");
    });

    // --- Belongs-To (cardinality: 'one', direction: 'owning') ---
    describe("Belongs-To (one-to-one/many-to-one)", () => {
        it("should generate default localKey for a simple belongs-to relation", () => {
            const relation: Partial<Relation> = {
                relationName: "post",
                target: () => mockPostCollection,
                cardinality: "one"
            };
            const normalized = sanitizeRelation(relation, mockAuthorCollection);
            expect(normalized.localKey).toEqual("post_id");
            expect(normalized.direction).toEqual("owning");
        });

        it("should use provided `localKey` for a belongs-to relation", () => {
            const relation: Partial<Relation> = {
                relationName: "post",
                target: () => mockPostCollection,
                cardinality: "one",
                localKey: "custom_post_fk"
            };
            const normalized = sanitizeRelation(relation, mockAuthorCollection);
            expect(normalized.localKey).toEqual("custom_post_fk");
            expect(normalized.direction).toEqual("owning");
        });
    });

    // --- Inverse One-to-One (cardinality: 'one', direction: 'inverse') ---
    describe("Inverse One-to-One", () => {
        it("should generate default foreignKeyOnTarget for an inverse one-to-one relation", () => {
            const relation: Partial<Relation> = {
                relationName: "profile",
                target: () => mockPostCollection,
                cardinality: "one",
                direction: "inverse"
            };
            const normalized = sanitizeRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("author_id");
            expect(normalized.direction).toEqual("inverse");
        });

        it("should use provided `foreignKeyOnTarget` for an inverse one-to-one relation", () => {
            const relation: Partial<Relation> = {
                relationName: "profile",
                target: () => mockPostCollection,
                cardinality: "one",
                direction: "inverse",
                foreignKeyOnTarget: "custom_author_fk"
            };
            const normalized = sanitizeRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("custom_author_fk");
            expect(normalized.direction).toEqual("inverse");
        });

        it("should work with inverseRelationName property", () => {
            const relation: Partial<Relation> = {
                relationName: "profile",
                target: () => mockPostCollection,
                cardinality: "one",
                direction: "inverse",
                inverseRelationName: "author"
            };
            const normalized = sanitizeRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("author_id");
            expect(normalized.inverseRelationName).toEqual("author");
            expect(normalized.direction).toEqual("inverse");
        });
    });

    // --- Has-Many (cardinality: 'many', direction: 'inverse') ---
    describe("Has-Many (one-to-many)", () => {
        it("should generate default foreignKeyOnTarget for a simple has-many relation", () => {
            const relation: Partial<Relation> = {
                relationName: "posts",
                target: () => mockPostCollection,
                cardinality: "many",
                direction: "inverse"
            };
            const normalized = sanitizeRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("author_id");
        });

        it("should use provided `foreignKeyOnTarget` for a has-many relation", () => {
            const relation: Partial<Relation> = {
                relationName: "posts",
                target: () => mockPostCollection,
                cardinality: "many",
                direction: "inverse",
                foreignKeyOnTarget: "writer_id"
            };
            const normalized = sanitizeRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("writer_id");
        });
    });

    // --- Many-To-Many (cardinality: 'many', through) ---
    describe("Many-To-Many", () => {
        it("should use provided `through` for a many-to-many relation", () => {
            const relation: Partial<Relation> = {
                relationName: "tags",
                target: () => mockTagCollection,
                cardinality: "many",
                through: {
                    table: "posts_tags",
                    sourceColumn: "post_id",
                    targetColumn: "tag_id"
                }
            };
            const normalized = sanitizeRelation(relation, mockPostCollection);
            expect(normalized.through).toEqual({
                table: "posts_tags",
                sourceColumn: "post_id",
                targetColumn: "tag_id"
            });
            expect(normalized.direction).toEqual("owning");
        });
    });

    // --- Fallback/Default Behavior ---
    describe("Fallback Behavior", () => {
        it("should fallback to has-many for ambiguous 'many' without direction or through", () => {
            const relation: Partial<Relation> = {
                relationName: "posts",
                target: () => mockPostCollection,
                cardinality: "many"
            };
            const normalized = sanitizeRelation(relation, mockAuthorCollection);
            // Should default to has-many (inverse) behavior
            expect(normalized.direction).toEqual("inverse");
            expect(normalized.foreignKeyOnTarget).toEqual("author_id");
        });

        it("should handle 'one' with 'owning' direction", () => {
            const relation: Partial<Relation> = {
                relationName: "author",
                target: () => mockAuthorCollection,
                cardinality: "one",
                direction: "owning" // Changed from "inverse"
            };
            const normalized = sanitizeRelation(relation, mockPostCollection);
            expect(normalized.localKey).toEqual("author_id");
        });
    });
});
/**
 * Comprehensive test suite for complex relation scenarios
 * This tests all the production use cases developers might implement
 */
describe("Comprehensive Relations Test Suite", () => {

    const cleanSchema = (schema: string) => {
        return schema
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\n{2,}/g, '\n')
            .replace(/\s+/g, " ")
            .trim();
    };

    describe("Many-to-Many Relations", () => {
        it("should handle many-to-many with a through table", async () => {
            const authorsCollection: EntityCollection = {
                slug: "authors",
                table: "authors",
                name: "Authors",
                properties: {
                    name: { type: "string" },
                    books: { type: "relation", relationName: "books" }
                },
                relations: [
                    {
                        relationName: "books",
                        target: () => booksCollection,
                        cardinality: "many",
                        direction: "owning",
                        through: {
                            table: "author_books",
                            sourceColumn: "author_id",
                            targetColumn: "book_id"
                        }
                    }
                ]
            };

            const booksCollection: EntityCollection = {
                slug: "books",
                table: "books",
                name: "Books",
                properties: {
                    title: { type: "string" }
                }
            };

            const result = await generateSchema([authorsCollection, booksCollection]);
            const cleanResult = cleanSchema(result);

            // Should create junction table
            expect(cleanResult).toContain(`export const authorBooks = pgTable("author_books"`);
            expect(cleanResult).toContain(`author_id: varchar("author_id").notNull().references(() => authors.id, { onDelete: "cascade" })`);
            expect(cleanResult).toContain(`book_id: varchar("book_id").notNull().references(() => books.id, { onDelete: "cascade" })`);
            expect(cleanResult).toContain(`export const authorsRelations = drizzleRelations(authors, ({ one, many }) => ({ "books": many(authorBooks, { relationName: "books" }) }));`);
        });

        it("should handle a 4-table many-to-many chain with joinPath", async () => {
            const usersCollection: EntityCollection = {
                slug: "users",
                table: "users",
                name: "Users",
                properties: {
                    name: { type: "string" },
                    permissions: { type: "relation", relationName: "permissions" }
                },
                relations: [
                    {
                        relationName: "permissions",
                        target: () => permissionsCollection,
                        cardinality: "many",
                        joinPath: [
                            { table: "user_roles", on: { from: "id", to: "user_id" } },
                            { table: "roles", on: { from: "role_id", to: "id" } },
                            { table: "role_permissions", on: { from: "id", to: "role_id" } },
                            { table: "permissions", on: { from: "permission_id", to: "id" } }
                        ]
                    }
                ]
            };

            const rolesCollection: EntityCollection = {
                slug: "roles",
                table: "roles",
                name: "Roles",
                properties: { name: { type: "string" } }
            };

            const permissionsCollection: EntityCollection = {
                slug: "permissions",
                table: "permissions",
                name: "Permissions",
                properties: { name: { type: "string" } }
            };

            const result = await generateSchema([usersCollection, rolesCollection, permissionsCollection]);
            const cleanResult = cleanSchema(result);

            // joinPath relations use existing user-controlled tables - no views or Drizzle relations generated
            expect(cleanResult).not.toContain("view_users_to_permissions");
            expect(cleanResult).not.toContain("viewUsersToPermissions");

            // Should generate basic table definitions for users, roles, and permissions
            expect(cleanResult).toContain("export const users = pgTable(\"users\"");
            expect(cleanResult).toContain("export const roles = pgTable(\"roles\"");
            expect(cleanResult).toContain("export const permissions = pgTable(\"permissions\"");

            // No Drizzle relations generated for joinPath relations
            expect(cleanResult).not.toContain("usersRelations");

            // No SQL view generation comments
            expect(result).not.toContain("CREATE OR REPLACE VIEW");
            expect(result).not.toContain("SQL VIEWS FOR COMPLEX RELATIONS");
        });
    });

    describe("Owning Relations", () => {
        it("should generate owning one-to-one relations", async () => {
            const authorsCollection: EntityCollection = {
                slug: "authors",
                table: "authors",
                name: "Authors",
                properties: {
                    name: { type: "string" },
                    profile: { type: "relation", relationName: "profile" }
                },
                relations: [
                    {
                        relationName: "profile",
                        target: () => profilesCollection,
                        cardinality: "one",
                        direction: "inverse",
                        inverseRelationName: "author"
                    }
                ]
            };

            const profilesCollection: EntityCollection = {
                slug: "profiles",
                table: "profiles",
                name: "Profiles",
                properties: {
                    bio: { type: "string" },
                    author: { type: "relation", relationName: "author" }
                },
                relations: [
                    {
                        relationName: "author",
                        target: () => authorsCollection,
                        cardinality: "one",
                        localKey: "author_id"
                    }
                ]
            };

            const result = await generateSchema([authorsCollection, profilesCollection]);
            const cleanResult = cleanSchema(result);

            // Should create FK on profiles table
            expect(cleanResult).toContain(`author_id: varchar("author_id").references(() => authors.id, { onDelete: "set null" })`);

            // Should create owning relation on profiles
            expect(cleanResult).toContain(`export const profilesRelations = drizzleRelations(profiles, ({ one, many }) => ({ "author": one(authors, { fields: [profiles.author_id], references: [authors.id], relationName: "profiles_author_id" }) }));`);

            // Should create inverse relation on authors (this was previously missing)
            expect(cleanResult).toContain(`export const authorsRelations = drizzleRelations(authors, ({ one, many }) => ({ "profile": one(profiles, { fields: [authors.id], references: [profiles.author_id], relationName: "profiles_author_id" }) }));`);
        });

        it("should generate owning one-to-many relations", async () => {
            const categoriesCollection: EntityCollection = {
                slug: "categories",
                table: "categories",
                name: "Categories",
                properties: {
                    name: { type: "string" },
                }
            };

            const postsCollection: EntityCollection = {
                slug: "posts",
                table: "posts",
                name: "Posts",
                properties: {
                    title: { type: "string" },
                    category: { type: "relation", relationName: "category" }
                },
                relations: [
                    {
                        relationName: "category",
                        target: () => categoriesCollection,
                        cardinality: "one",
                        localKey: "category_id"
                    }
                ]
            };

            const result = await generateSchema([categoriesCollection, postsCollection]);
            const cleanResult = cleanSchema(result);

            // Should create FK on posts table
            expect(cleanResult).toContain(`category_id: varchar("category_id").references(() => categories.id, { onDelete: "set null" })`);
            // Should create owning relation on posts
            expect(cleanResult).toContain(`export const postsRelations = drizzleRelations(posts, ({ one, many }) => ({ "category": one(categories, { fields: [posts.category_id], references: [categories.id], relationName: "posts_category_id" }) }));`);
        });
    });

    describe("Mixed Relation Types", () => {
        it("should handle collections with multiple relations", async () => {
            const authorsCollection: EntityCollection = {
                slug: "authors",
                table: "authors",
                name: "Authors",
                properties: {
                    name: { type: "string" },
                    publisher: { type: "relation", relationName: "publisher" },
                },
                relations: [
                    {
                        relationName: "publisher",
                        target: () => publishersCollection,
                        cardinality: "one",
                        localKey: "publisher_id"
                    }
                ]
            };

            const publishersCollection: EntityCollection = {
                slug: "publishers",
                table: "publishers",
                name: "Publishers",
                properties: {
                    name: { type: "string" }
                }
            };

            const booksCollection: EntityCollection = {
                slug: "books",
                table: "books",
                name: "Books",
                properties: {
                    title: { type: "string" },
                    author: { type: "relation", relationName: "author" }
                },
                relations: [{
                    relationName: "author",
                    target: () => authorsCollection,
                    cardinality: "one",
                    localKey: "author_id"
                }]
            };

            const result = await generateSchema([authorsCollection, publishersCollection, booksCollection]);
            const cleanResult = cleanSchema(result);

            // Check owning relation from author to publisher
            expect(cleanResult).toContain(`publisher_id: varchar("publisher_id").references(() => publishers.id, { onDelete: "set null" })`);
            expect(cleanResult).toContain(`"publisher": one(publishers, { fields: [authors.publisher_id], references: [publishers.id], relationName: "authors_publisher_id" })`);

            // Check owning relation from book to author
            expect(cleanResult).toContain(`author_id: varchar("author_id").references(() => authors.id, { onDelete: "set null" })`);
            expect(cleanResult).toContain(`"author": one(authors, { fields: [books.author_id], references: [authors.id], relationName: "books_author_id" })`);
        });
    });

    describe("Complex Multi-Column Relations", () => {
        it("should handle multi-column foreign keys", async () => {
            const ordersCollection: EntityCollection = {
                slug: "orders",
                table: "orders",
                name: "Orders",
                properties: {
                    customer_code: { type: "string" },
                    region_id: { type: "number", validation: { integer: true } },
                    customer: { type: "relation", relationName: "customer" }
                },
                relations: [
                    {
                        relationName: "customer",
                        target: () => customersCollection,
                        cardinality: "many",
                        joinPath: [
                            { table: "customers", on: { from: ["customer_code", "region_id"], to: ["code", "region_id"] } }
                        ]
                    }
                ]
            };

            const customersCollection: EntityCollection = {
                slug: "customers",
                table: "customers",
                name: "Customers",
                properties: {
                    code: { type: "string" },
                    region_id: { type: "number", validation: { integer: true } },
                    name: { type: "string" }
                }
            };

            const result = await generateSchema([ordersCollection, customersCollection]);
            const cleanResult = cleanSchema(result);

            // joinPath relations use existing user-controlled tables - no views generated
            expect(cleanResult).not.toContain("view_orders_to_customers");
            expect(cleanResult).not.toContain("viewOrdersToCustomers");

            // Should generate basic table definitions
            expect(cleanResult).toContain("export const orders = pgTable(\"orders\"");
            expect(cleanResult).toContain("export const customers = pgTable(\"customers\"");

            // Should include the multi-column properties in the tables
            expect(cleanResult).toContain("customer_code: varchar(\"customer_code\")");
            expect(cleanResult).toContain("region_id: integer(\"region_id\")");
            expect(cleanResult).toContain("code: varchar(\"code\")");

            // No Drizzle relations generated for joinPath relations
            expect(cleanResult).not.toContain("ordersRelations");

            // No SQL view generation
            expect(result).not.toContain("CREATE OR REPLACE VIEW");
            expect(result).not.toContain("SQL VIEWS FOR COMPLEX RELATIONS");
        });
    });

    describe("Edge Cases and Production Scenarios", () => {
        it("should handle self-referencing many-to-many", async () => {
            const usersCollection: EntityCollection = {
                slug: "users",
                table: "users",
                name: "Users",
                properties: {
                    name: { type: "string" },
                    friends: { type: "relation", relationName: "friends" }
                },
                relations: [
                    {
                        relationName: "friends",
                        target: () => usersCollection,
                        cardinality: "many",
                        direction: "owning",
                        through: {
                            table: "user_friends",
                            sourceColumn: "user_id",
                            targetColumn: "friend_id"
                        }
                    }
                ]
            };

            const result = await generateSchema([usersCollection]);
            const cleanResult = cleanSchema(result);

            // Should handle self-referencing relations
            expect(cleanResult).toContain("export const userFriends = pgTable(\"user_friends\"");
            expect(cleanResult).toContain("user_id: varchar(\"user_id\").notNull().references(() => users.id, { onDelete: \"cascade\" })");
            expect(cleanResult).toContain("friend_id: varchar(\"friend_id\").notNull().references(() => users.id, { onDelete: \"cascade\" })");
        });

        it("should handle mixed ID types in relations", async () => {
            const productsCollection: EntityCollection = {
                slug: "products",
                table: "products",
                name: "Products",
                properties: {
                    sku: { type: "string", isId: true },
                    name: { type: "string" },
                    categories: { type: "relation", relationName: "categories" }
                },
                relations: [
                    {
                        relationName: "categories",
                        target: () => categoriesCollection,
                        cardinality: "many",
                        direction: "owning",
                        through: {
                            table: "product_categories",
                            sourceColumn: "product_sku",
                            targetColumn: "category_id"
                        }
                    }
                ]
            };

            const categoriesCollection: EntityCollection = {
                slug: "categories",
                table: "categories",
                name: "Categories",
                properties: {
                    name: { type: "string" }
                }
            };

            const result = await generateSchema([productsCollection, categoriesCollection]);
            const cleanResult = cleanSchema(result);

            // The primary key should be sku
            expect(cleanResult).toContain("sku: varchar(\"sku\").primaryKey()");
            expect(cleanResult).not.toContain("id: serial(\"id\").primaryKey()");
            expect(cleanResult).toContain("product_sku: varchar(\"product_sku\").notNull().references(() => products.sku, { onDelete: \"cascade\" })");
            expect(cleanResult).toContain("category_id: varchar(\"category_id\").notNull().references(() => categories.id, { onDelete: \"cascade\" })");
        });

        it("should handle circular references", async () => {
            const aCollection: EntityCollection = {
                slug: "a_entities",
                table: "a_entities",
                name: "A Entities",
                properties: {
                    name: { type: "string" },
                    b_entities: { type: "relation", relationName: "b_entities" }
                },
                relations: [
                    {
                        relationName: "b_entities",
                        target: () => bCollection,
                        cardinality: "many",
                        direction: "inverse",
                        foreignKeyOnTarget: "a_entity_id"
                    }
                ]
            };

            const bCollection: EntityCollection = {
                slug: "b_entities",
                table: "b_entities",
                name: "B Entities",
                properties: {
                    name: { type: "string" },
                    a_entity: { type: "relation", relationName: "a_entity" }
                },
                relations: [
                    {
                        relationName: "a_entity",
                        target: () => aCollection,
                        cardinality: "one",
                        direction: "owning",
                        localKey: "a_entity_id"
                    }
                ]
            };

            const result = await generateSchema([aCollection, bCollection]);
            const cleanResult = cleanSchema(result);

            // Should handle circular references without infinite loops
            // The 'owning' relation on bCollection should correctly generate the FK
            expect(cleanResult).toContain("export const aEntities = pgTable(\"a_entities\"");
            expect(cleanResult).toContain("export const bEntities = pgTable(\"b_entities\"");
            expect(cleanResult).toContain("a_entity_id: varchar(\"a_entity_id\").references(() => aEntities.id, { onDelete: \"set null\" })");
            // Check that both drizzle relations are generated
            expect(cleanResult).toContain("\"b_entities\": many(bEntities, { relationName: \"b_entities_a_entity_id\" })");
            expect(cleanResult).toContain("\"a_entity\": one(aEntities, { fields: [bEntities.a_entity_id], references: [aEntities.id], relationName: \"b_entities_a_entity_id\" })");
        });
    });
});

/**
 * Regression tests for https://github.com/rebasepro/rebase/issues/XXX
 * Ensures both sides of an owning/inverse relation emit the same `relationName`.
 */
describe("Shared relationName regression", () => {
    const cleanSchema = (schema: string) => {
        return schema
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\n{2,}/g, "\n")
            .replace(/\s+/g, " ")
            .trim();
    };

    /**
     * Helper that extracts all `relationName: "..."` values from generated schema output.
     */
    const extractRelationNames = (schema: string): string[] => {
        const matches = schema.match(/relationName:\s*"([^"]+)"/g) ?? [];
        return matches.map(m => m.replace(/relationName:\s*"/, "").replace(/"$/, ""));
    };

    it("should emit identical relationName for one-to-many owning + inverse pair", async () => {
        const companiesCollection: EntityCollection = {
            slug: "companies",
            table: "companies",
            name: "Companies",
            properties: {
                name: { type: "string" },
            },
            relations: [
                {
                    relationName: "jobs",
                    target: () => jobsCollection,
                    cardinality: "many",
                    direction: "inverse",
                    foreignKeyOnTarget: "company_id",
                },
            ],
        };

        const jobsCollection: EntityCollection = {
            slug: "jobs",
            table: "jobs",
            name: "Jobs",
            properties: {
                title: { type: "string" },
                company: { type: "relation", relationName: "company" },
            },
            relations: [
                {
                    relationName: "company",
                    target: () => companiesCollection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "company_id",
                },
            ],
        };

        const result = await generateSchema([companiesCollection, jobsCollection]);
        const cleanResult = cleanSchema(result);

        // Both sides must use the same deterministic name: jobs_company_id
        const expectedSharedName = "jobs_company_id";

        // Owning side (jobs → companies)
        expect(cleanResult).toContain(
            `"company": one(companies, { fields: [jobs.company_id], references: [companies.id], relationName: \"${expectedSharedName}\" })`
        );

        // Inverse side (companies → jobs)
        expect(cleanResult).toContain(
            `"jobs": many(jobs, { relationName: \"${expectedSharedName}\" })`
        );

        // Verify there are exactly 2 occurrences of the shared name
        const allNames = extractRelationNames(result);
        const matchingNames = allNames.filter(n => n === expectedSharedName);
        expect(matchingNames).toHaveLength(2);
    });

    it("should emit identical relationName for one-to-one owning + inverse pair", async () => {
        const usersCollection: EntityCollection = {
            slug: "users",
            table: "users",
            name: "Users",
            properties: {
                name: { type: "string" },
            },
            relations: [
                {
                    relationName: "profile",
                    target: () => profilesCollection,
                    cardinality: "one",
                    direction: "inverse",
                    foreignKeyOnTarget: "user_id",
                },
            ],
        };

        const profilesCollection: EntityCollection = {
            slug: "profiles",
            table: "profiles",
            name: "Profiles",
            properties: {
                bio: { type: "string" },
                user: { type: "relation", relationName: "user" },
            },
            relations: [
                {
                    relationName: "user",
                    target: () => usersCollection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "user_id",
                },
            ],
        };

        const result = await generateSchema([usersCollection, profilesCollection]);
        const cleanResult = cleanSchema(result);

        const expectedSharedName = "profiles_user_id";

        // Owning side (profiles → users)
        expect(cleanResult).toContain(
            `"user": one(users, { fields: [profiles.user_id], references: [users.id], relationName: \"${expectedSharedName}\" })`
        );

        // Inverse side (users → profiles)
        expect(cleanResult).toContain(
            `"profile": one(profiles, { fields: [users.id], references: [profiles.user_id], relationName: \"${expectedSharedName}\" })`
        );

        // Both must match
        const allNames = extractRelationNames(result);
        const matchingNames = allNames.filter(n => n === expectedSharedName);
        expect(matchingNames).toHaveLength(2);
    });

    it("should emit different shared names for multiple relations between same tables", async () => {
        const companiesCollection: EntityCollection = {
            slug: "companies",
            table: "companies",
            name: "Companies",
            properties: { name: { type: "string" } },
            relations: [
                {
                    relationName: "employees",
                    target: () => peopleCollection,
                    cardinality: "many",
                    direction: "inverse",
                    foreignKeyOnTarget: "employer_id",
                },
                {
                    relationName: "founders",
                    target: () => peopleCollection,
                    cardinality: "many",
                    direction: "inverse",
                    foreignKeyOnTarget: "startup_id",
                },
            ],
        };

        const peopleCollection: EntityCollection = {
            slug: "people",
            table: "people",
            name: "People",
            properties: {
                name: { type: "string" },
                employer: { type: "relation", relationName: "employer" },
                startup: { type: "relation", relationName: "startup" },
            },
            relations: [
                {
                    relationName: "employer",
                    target: () => companiesCollection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "employer_id",
                },
                {
                    relationName: "startup",
                    target: () => companiesCollection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "startup_id",
                },
            ],
        };

        const result = await generateSchema([companiesCollection, peopleCollection]);
        const allNames = extractRelationNames(result);

        // Each pair should have a distinct shared name
        const employerNames = allNames.filter(n => n === "people_employer_id");
        const startupNames = allNames.filter(n => n === "people_startup_id");
        expect(employerNames).toHaveLength(2);
        expect(startupNames).toHaveLength(2);
    });
});

/**
 * Regression tests for duplicate relation emission.
 *
 * Bug: resolveCollectionRelations used to add slug/snake_case alias entries
 * for every relation. When the schema generator iterated the dictionary, it
 * emitted multiple one() definitions with the same `relationName`, causing
 * Drizzle ORM to throw:
 *   "There are multiple relations with name 'jobs_company_id' in table 'jobs'"
 *
 * Also, property-based entries (e.g. `company_id: { type: "relation", relationName: "company" }`)
 * duplicated explicit relation entries because the deduplication only compared
 * property key vs relation key — not the underlying relationName.
 *
 * This suite covers both scenarios.
 */
describe("Duplicate relation deduplication regression", () => {
    const cleanSchema = (schema: string) => {
        return schema
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\n{2,}/g, "\n")
            .replace(/\s+/g, " ")
            .trim();
    };

    const extractRelationNames = (schema: string): string[] => {
        const matches = schema.match(/relationName:\s*"([^"]+)"/g) ?? [];
        return matches.map(m => m.replace(/relationName:\s*"/, "").replace(/"$/, ""));
    };

    /**
     * Count how many one() definitions exist for a specific relation key pattern.
     * This matches `"<key>": one(` in the generated schema.
     */
    const countOneEntries = (schema: string, keyPattern: string): number => {
        const regex = new RegExp(`"${keyPattern}":\\s*one\\(`, "g");
        return (schema.match(regex) ?? []).length;
    };

    it("should emit exactly one one() per FK when explicit relation + property share the same FK", async () => {
        // This models the exact Sustentalent scenario:
        //   - Explicit relation: { relationName: "company", localKey: "company_id", ... }
        //   - Property:          { company_id: { type: "relation", relationName: "company" } }
        // Both reference the same FK `company_id`, but under different keys.
        const companiesCollection: EntityCollection = {
            slug: "companies",
            table: "companies",
            name: "Companies",
            properties: {
                name: { type: "string" },
            },
            relations: [
                {
                    relationName: "jobs",
                    target: () => jobsCollection,
                    cardinality: "many",
                    direction: "inverse",
                    foreignKeyOnTarget: "company_id",
                },
            ],
        };

        const jobsCollection: EntityCollection = {
            slug: "jobs",
            table: "jobs",
            name: "Jobs",
            properties: {
                title: { type: "string" },
                // Property referencing the same FK as the explicit relation
                company: {
                    type: "relation",
                    relationName: "company",
                },
            },
            relations: [
                {
                    relationName: "company",
                    target: () => companiesCollection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "company_id",
                },
            ],
        };

        const result = await generateSchema([companiesCollection, jobsCollection]);
        const cleanResult = cleanSchema(result);

        // The jobs table should have exactly ONE one() entry for company_id
        const jobsRelationNames = extractRelationNames(result);
        const companyIdRelNames = jobsRelationNames.filter(n => n === "jobs_company_id");

        // Exactly 2: one on the owning side (jobs), one on the inverse side (companies)
        expect(companyIdRelNames).toHaveLength(2);

        // There must be no duplicate one() definitions within jobsRelations
        const jobsRelationsBlock = result.match(/export const jobsRelations[\s\S]*?\}\)\);/)?.[0] ?? "";
        const oneEntriesInJobs = (jobsRelationsBlock.match(/:\s*one\(/g) ?? []).length;
        expect(oneEntriesInJobs).toBe(1);

        // The companies table should have exactly ONE many() entry for jobs
        const companiesRelationsBlock = result.match(/export const companiesRelations[\s\S]*?\}\)\);/)?.[0] ?? "";
        const manyEntriesInCompanies = (companiesRelationsBlock.match(/:\s*many\(/g) ?? []).length;
        expect(manyEntriesInCompanies).toBe(1);
    });

    it("should not create aliases when relation key contains underscores", async () => {
        // Verify that resolving a collection with a snake_case relation name
        // does NOT produce slug-variant alias entries in the generated schema
        const parentCollection: EntityCollection = {
            slug: "departments",
            table: "departments",
            name: "Departments",
            properties: {
                name: { type: "string" },
            },
            relations: [
                {
                    relationName: "team_members",
                    target: () => memberCollection,
                    cardinality: "many",
                    direction: "inverse",
                    foreignKeyOnTarget: "department_id",
                },
            ],
        };

        const memberCollection: EntityCollection = {
            slug: "team-members",
            table: "team_members",
            name: "Team Members",
            properties: {
                name: { type: "string" },
                department: {
                    type: "relation",
                    relationName: "department",
                },
            },
            relations: [
                {
                    relationName: "department",
                    target: () => parentCollection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "department_id",
                },
            ],
        };

        const result = await generateSchema([parentCollection, memberCollection]);

        // team_members table should have exactly one one() definition
        const teamMembersRelBlock = result.match(/export const teamMembersRelations[\s\S]*?\}\)\);/)?.[0] ?? "";
        const oneEntries = (teamMembersRelBlock.match(/:\s*one\(/g) ?? []).length;
        expect(oneEntries).toBe(1);

        // No duplicate relation names anywhere
        const allNames = extractRelationNames(result);
        const nameCountMap = new Map<string, number>();
        for (const name of allNames) {
            nameCountMap.set(name, (nameCountMap.get(name) ?? 0) + 1);
        }
        // Every relation name should appear exactly twice (once per side)
        for (const [name, count] of nameCountMap) {
            expect(count).toBeLessThanOrEqual(2);
        }
    });

    it("should handle multiple different relations to the same target without duplicates", async () => {
        // Two separate FKs from one table to the same target table
        const usersCollection: EntityCollection = {
            slug: "users",
            table: "users",
            name: "Users",
            properties: { name: { type: "string" } },
            relations: [],
        };

        const messagesCollection: EntityCollection = {
            slug: "messages",
            table: "messages",
            name: "Messages",
            properties: {
                content: { type: "string" },
                sender: { type: "relation", relationName: "sender" },
                recipient: { type: "relation", relationName: "recipient" },
            },
            relations: [
                {
                    relationName: "sender",
                    target: () => usersCollection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "sender_id",
                },
                {
                    relationName: "recipient",
                    target: () => usersCollection,
                    cardinality: "one",
                    direction: "owning",
                    localKey: "recipient_id",
                },
            ],
        };

        const result = await generateSchema([usersCollection, messagesCollection]);

        // messages table should have exactly TWO one() entries (one per FK)
        const messagesRelBlock = result.match(/export const messagesRelations[\s\S]*?\}\)\);/)?.[0] ?? "";
        const oneEntries = (messagesRelBlock.match(/:\s*one\(/g) ?? []).length;
        expect(oneEntries).toBe(2);

        // The two must have DIFFERENT relationName values
        const namesInMessages = extractRelationNames(messagesRelBlock);
        expect(namesInMessages).toHaveLength(2);
        expect(namesInMessages[0]).not.toBe(namesInMessages[1]);
    });
});
