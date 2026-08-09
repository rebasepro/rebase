import { CollectionConfig, Relation } from "@rebasepro/types";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { resolveRelation } from "@rebasepro/common";

const mockAuthorCollection: CollectionConfig = {
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

const mockPostCollection: CollectionConfig = {
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

const mockTagCollection: CollectionConfig = {
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

describe("resolveRelation", () => {

    it("should generate a default relationName if not provided", () => {
        const relation: Partial<Relation> = {
            kind: "belongsTo",
            target: () => mockPostCollection,
            };
        const normalized = resolveRelation(relation, mockAuthorCollection);
        expect(normalized.relationName).toBe("posts");
    });

    // --- Belongs-To (cardinality: 'one', direction: 'owning') ---
    describe("Belongs-To (one-to-one/many-to-one)", () => {
        it("should generate default localKey for a simple belongs-to relation", () => {
            const relation: Partial<Relation> = {
                kind: "belongsTo",
                relationName: "post",
                target: () => mockPostCollection,
                };
            const normalized = resolveRelation(relation, mockAuthorCollection);
            expect(normalized.localKey).toEqual("post_id");
        });

        it("should use provided `localKey` for a belongs-to relation", () => {
            const relation: Partial<Relation> = {
                kind: "belongsTo",
                relationName: "post",
                target: () => mockPostCollection,
                localKey: "custom_post_fk"
            };
            const normalized = resolveRelation(relation, mockAuthorCollection);
            expect(normalized.localKey).toEqual("custom_post_fk");
        });
    });

    // --- Inverse One-to-One (cardinality: 'one', direction: 'inverse') ---
    describe("Inverse One-to-One", () => {
        it("should generate default foreignKeyOnTarget for an inverse one-to-one relation", () => {
            const relation: Partial<Relation> = {
                kind: "hasOne",
                relationName: "profile",
                target: () => mockPostCollection,
                };
            const normalized = resolveRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("author_id");
        });

        it("should use provided `foreignKeyOnTarget` for an inverse one-to-one relation", () => {
            const relation: Partial<Relation> = {
                kind: "hasOne",
                relationName: "profile",
                target: () => mockPostCollection,
                foreignKeyOnTarget: "custom_author_fk"
            };
            const normalized = resolveRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("custom_author_fk");
        });

        it("ignores the retired `inverseRelationName` property", () => {
            // `inverseRelationName` belongs to the pre-union relation shape that
            // `resolveRelation` replaced; the target-side name is now derived, and
            // `introspect-emits-valid-relations` lists the field as one codegen
            // must never emit again. Worth asserting rather than assuming: a
            // config written against the old shape still reaches this function
            // (nothing strips unknown keys), so the field surviving into the
            // resolved relation — via a `...relation` spread, say — would let
            // downstream consumers pair against a name the generator never used,
            // and Drizzle silently drops relations whose two sides disagree.
            const relation = {
                kind: "hasOne",
                relationName: "profile",
                target: () => mockPostCollection,
                inverseRelationName: "author_profile"
            } as unknown as Relation;
            const normalized = resolveRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("author_id");
            expect(normalized).not.toHaveProperty("inverseRelationName");
        });
    });

    // --- Has-Many (cardinality: 'many', direction: 'inverse') ---
    describe("Has-Many (one-to-many)", () => {
        it("should generate default foreignKeyOnTarget for a simple has-many relation", () => {
            // The default FK is built from the SOURCE collection's slug
            // (`author` → `author_id`), never from the relation name — naming the
            // relation "posts" must not point it at `posts_id`. The body used to
            // declare `hasOne`, so the hasMany branch's own default was never
            // reached and the two kinds could drift apart unnoticed.
            const relation: Partial<Relation> = {
                kind: "hasMany",
                relationName: "posts",
                target: () => mockPostCollection,
                };
            const normalized = resolveRelation(relation, mockAuthorCollection);
            expect(normalized.kind).toEqual("hasMany");
            expect(normalized.cardinality).toEqual("many");
            expect(normalized.foreignKeyOnTarget).toEqual("author_id");
        });

        it("should use provided `foreignKeyOnTarget` for a has-many relation", () => {
            const relation: Partial<Relation> = {
                kind: "hasMany",
                relationName: "posts",
                target: () => mockPostCollection,
                foreignKeyOnTarget: "writer_id"
            };
            const normalized = resolveRelation(relation, mockAuthorCollection);
            expect(normalized.foreignKeyOnTarget).toEqual("writer_id");
        });
    });

    // --- Many-To-Many (cardinality: 'many', through) ---
    describe("Many-To-Many", () => {
        it("should use provided `through` for a many-to-many relation", () => {
            const relation: Partial<Relation> = {
                kind: "manyToMany",
                relationName: "tags",
                target: () => mockTagCollection,
                through: {
                    table: "posts_tags",
                    sourceColumn: "post_id",
                    targetColumn: "tag_id"
                }
            };
            const normalized = resolveRelation(relation, mockPostCollection);
            expect(normalized.through).toEqual({
                table: "posts_tags",
                sourceColumn: "post_id",
                targetColumn: "tag_id"
            });
        });
    });

    // --- Fallback/Default Behavior ---
    describe("Fallback Behavior", () => {
        it("should throw on an ambiguous 'many' instead of falling back to has-many", () => {
            // This is the behaviour the predecessor (`sanitizeRelation`) got
            // wrong: it inferred the kind from whichever optional fields were
            // set, and a `many` it could not classify fell through a try/catch
            // to has-many — so an unclassifiable relation read the wrong column
            // and produced empty results rather than an error. The switch is now
            // exhaustive and an unrecognised kind throws. The old body declared
            // `hasOne`, i.e. it exercised the classified path it was written to
            // rule out.
            const relation = {
                kind: "many",
                relationName: "posts",
                target: () => mockPostCollection
            } as unknown as Relation;
            expect(() => resolveRelation(relation, mockAuthorCollection)).toThrow(/Unknown relation kind/);
        });

        it("should handle 'one' with 'owning' direction", () => {
            const relation: Partial<Relation> = {
                kind: "belongsTo",
                relationName: "author",
                target: () => mockAuthorCollection,
                };
            const normalized = resolveRelation(relation, mockPostCollection);
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
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\n{2,}/g, "\n")
            .replace(/\s+/g, " ")
            .trim();
    };

    describe("Many-to-Many Relations", () => {
        it("should handle many-to-many with a through table", async () => {
            const authorsCollection: CollectionConfig = {
                slug: "authors",
                table: "authors",
                name: "Authors",
                properties: {
                    name: { type: "string" },
                    books: { type: "relation",
relationName: "books" }
                },
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "books",
                        target: () => booksCollection,
                        through: {
                            table: "author_books",
                            sourceColumn: "author_id",
                            targetColumn: "book_id"
                        }
                    }
                ]
            };

            const booksCollection: CollectionConfig = {
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
            expect(cleanResult).toContain("export const authorBooks = pgTable(\"author_books\"");
            expect(cleanResult).toContain("author_id: text(\"author_id\").notNull().references(() => authors.id, { onDelete: \"cascade\" })");
            expect(cleanResult).toContain("book_id: text(\"book_id\").notNull().references(() => books.id, { onDelete: \"cascade\" })");
            expect(cleanResult).toContain("export const authorsRelations = drizzleRelations(authors, ({ one, many }) => ({ \"books\": many(authorBooks, { relationName: \"books\" }) }));");
        });

        it("should handle a 4-table many-to-many chain with joinPath", async () => {
            const usersCollection: CollectionConfig = {
                slug: "users",
                table: "users",
                name: "Users",
                properties: {
                    name: { type: "string" },
                    permissions: { type: "relation",
relationName: "permissions" }
                },
                relations: [
                    {
                        kind: "via",
                        relationName: "permissions",
                        target: () => permissionsCollection,
                        cardinality: "many",
                        joinPath: [
                            { table: "user_roles",
on: { from: "id",
to: "user_id" } },
                            { table: "roles",
on: { from: "role_id",
to: "id" } },
                            { table: "role_permissions",
on: { from: "id",
to: "role_id" } },
                            { table: "permissions",
on: { from: "permission_id",
to: "id" } }
                        ]
                    }
                ]
            };

            const rolesCollection: CollectionConfig = {
                slug: "roles",
                table: "roles",
                name: "Roles",
                properties: { name: { type: "string" } }
            };

            const permissionsCollection: CollectionConfig = {
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
            const authorsCollection: CollectionConfig = {
                slug: "authors",
                table: "authors",
                name: "Authors",
                properties: {
                    name: { type: "string" },
                    profile: { type: "relation",
relationName: "profile" }
                },
                relations: [
                    {
                        kind: "hasOne",
                        relationName: "profile",
                        target: () => profilesCollection,
                        }
                ]
            };

            const profilesCollection: CollectionConfig = {
                slug: "profiles",
                table: "profiles",
                name: "Profiles",
                properties: {
                    bio: { type: "string" },
                    author: { type: "relation",
relationName: "author" }
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

            const result = await generateSchema([authorsCollection, profilesCollection]);
            const cleanResult = cleanSchema(result);

            // Should create FK on profiles table
            expect(cleanResult).toContain("authorId: text(\"author_id\").references(() => authors.id, { onDelete: \"set null\" })");

            // Should create owning relation on profiles
            expect(cleanResult).toContain("export const profilesRelations = drizzleRelations(profiles, ({ one, many }) => ({ \"author\": one(authors, { fields: [profiles.authorId], references: [authors.id], relationName: \"profiles_authorId\" }) }));");

            // Should create inverse relation on authors — inverse side has NO fields/references
            expect(cleanResult).toContain("export const authorsRelations = drizzleRelations(authors, ({ one, many }) => ({ \"profile\": one(profiles, { relationName: \"profiles_authorId\" }) }));");
        });

        it("should generate owning one-to-many relations", async () => {
            const categoriesCollection: CollectionConfig = {
                slug: "categories",
                table: "categories",
                name: "Categories",
                properties: {
                    name: { type: "string" }
                }
            };

            const postsCollection: CollectionConfig = {
                slug: "posts",
                table: "posts",
                name: "Posts",
                properties: {
                    title: { type: "string" },
                    category: { type: "relation",
relationName: "category" }
                },
                relations: [
                    {
                        kind: "belongsTo",
                        relationName: "category",
                        target: () => categoriesCollection,
                        localKey: "category_id"
                    }
                ]
            };

            const result = await generateSchema([categoriesCollection, postsCollection]);
            const cleanResult = cleanSchema(result);

            // Should create FK on posts table
            expect(cleanResult).toContain("categoryId: text(\"category_id\").references(() => categories.id, { onDelete: \"set null\" })");
            // Should create owning relation on posts
            expect(cleanResult).toContain("export const postsRelations = drizzleRelations(posts, ({ one, many }) => ({ \"category\": one(categories, { fields: [posts.categoryId], references: [categories.id], relationName: \"posts_categoryId\" }) }));");
        });
    });

    describe("Mixed Relation Types", () => {
        it("should handle collections with multiple relations", async () => {
            const authorsCollection: CollectionConfig = {
                slug: "authors",
                table: "authors",
                name: "Authors",
                properties: {
                    name: { type: "string" },
                    publisher: { type: "relation",
relationName: "publisher" }
                },
                relations: [
                    {
                        kind: "belongsTo",
                        relationName: "publisher",
                        target: () => publishersCollection,
                        localKey: "publisher_id"
                    }
                ]
            };

            const publishersCollection: CollectionConfig = {
                slug: "publishers",
                table: "publishers",
                name: "Publishers",
                properties: {
                    name: { type: "string" }
                }
            };

            const booksCollection: CollectionConfig = {
                slug: "books",
                table: "books",
                name: "Books",
                properties: {
                    title: { type: "string" },
                    author: { type: "relation",
relationName: "author" }
                },
                relations: [{
                    kind: "belongsTo",
                    relationName: "author",
                    target: () => authorsCollection,
                    localKey: "author_id"
                }]
            };

            const result = await generateSchema([authorsCollection, publishersCollection, booksCollection]);
            const cleanResult = cleanSchema(result);

            // Check owning relation from author to publisher
            expect(cleanResult).toContain("publisherId: text(\"publisher_id\").references(() => publishers.id, { onDelete: \"set null\" })");
            expect(cleanResult).toContain("\"publisher\": one(publishers, { fields: [authors.publisherId], references: [publishers.id], relationName: \"authors_publisherId\" })");

            // Check owning relation from book to author
            expect(cleanResult).toContain("authorId: text(\"author_id\").references(() => authors.id, { onDelete: \"set null\" })");
            expect(cleanResult).toContain("\"author\": one(authors, { fields: [books.authorId], references: [authors.id], relationName: \"books_authorId\" })");
        });
    });

    describe("Complex Multi-Column Relations", () => {
        it("should handle multi-column foreign keys", async () => {
            const ordersCollection: CollectionConfig = {
                slug: "orders",
                table: "orders",
                name: "Orders",
                properties: {
                    customer_code: { type: "string" },
                    region_id: { type: "number",
validation: { integer: true } },
                    customer: { type: "relation",
relationName: "customer" }
                },
                relations: [
                    {
                        kind: "via",
                        relationName: "customer",
                        target: () => customersCollection,
                        cardinality: "many",
                        joinPath: [
                            { table: "customers",
on: { from: ["customer_code", "region_id"],
to: ["code", "region_id"] } }
                        ]
                    }
                ]
            };

            const customersCollection: CollectionConfig = {
                slug: "customers",
                table: "customers",
                name: "Customers",
                properties: {
                    code: { type: "string" },
                    region_id: { type: "number",
validation: { integer: true } },
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
            expect(cleanResult).toContain("customer_code: text(\"customer_code\")");
            expect(cleanResult).toContain("region_id: integer(\"region_id\")");
            expect(cleanResult).toContain("code: text(\"code\")");

            // No Drizzle relations generated for joinPath relations
            expect(cleanResult).not.toContain("ordersRelations");

            // No SQL view generation
            expect(result).not.toContain("CREATE OR REPLACE VIEW");
            expect(result).not.toContain("SQL VIEWS FOR COMPLEX RELATIONS");
        });
    });

    describe("Edge Cases and Production Scenarios", () => {
        it("should handle self-referencing many-to-many", async () => {
            const usersCollection: CollectionConfig = {
                slug: "users",
                table: "users",
                name: "Users",
                properties: {
                    name: { type: "string" },
                    friends: { type: "relation",
relationName: "friends" }
                },
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "friends",
                        target: () => usersCollection,
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
            expect(cleanResult).toContain("user_id: text(\"user_id\").notNull().references(() => users.id, { onDelete: \"cascade\" })");
            expect(cleanResult).toContain("friend_id: text(\"friend_id\").notNull().references(() => users.id, { onDelete: \"cascade\" })");
        });

        it("should handle mixed ID types in relations", async () => {
            const productsCollection: CollectionConfig = {
                slug: "products",
                table: "products",
                name: "Products",
                properties: {
                    sku: { type: "string",
isId: true },
                    name: { type: "string" },
                    categories: { type: "relation",
relationName: "categories" }
                },
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "categories",
                        target: () => categoriesCollection,
                        through: {
                            table: "product_categories",
                            sourceColumn: "product_sku",
                            targetColumn: "category_id"
                        }
                    }
                ]
            };

            const categoriesCollection: CollectionConfig = {
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
            expect(cleanResult).toContain("sku: text(\"sku\").primaryKey()");
            expect(cleanResult).not.toContain("id: serial(\"id\").primaryKey()");
            expect(cleanResult).toContain("product_sku: text(\"product_sku\").notNull().references(() => products.sku, { onDelete: \"cascade\" })");
            expect(cleanResult).toContain("category_id: text(\"category_id\").notNull().references(() => categories.id, { onDelete: \"cascade\" })");
        });

        it("should handle circular references", async () => {
            const aCollection: CollectionConfig = {
                slug: "a_entities",
                table: "a_entities",
                name: "A Entities",
                properties: {
                    name: { type: "string" },
                    b_entities: { type: "relation",
relationName: "b_entities" }
                },
                relations: [
                    {
                        kind: "hasMany",
                        relationName: "b_entities",
                        target: () => bCollection,
                        foreignKeyOnTarget: "a_entity_id"
                    }
                ]
            };

            const bCollection: CollectionConfig = {
                slug: "b_entities",
                table: "b_entities",
                name: "B Entities",
                properties: {
                    name: { type: "string" },
                    a_entity: { type: "relation",
relationName: "a_entity" }
                },
                relations: [
                    {
                        kind: "belongsTo",
                        relationName: "a_entity",
                        target: () => aCollection,
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
            expect(cleanResult).toContain("aEntityId: text(\"a_entity_id\").references(() => aEntities.id, { onDelete: \"set null\" })");
            // Check that both drizzle relations are generated
            expect(cleanResult).toContain("\"b_entities\": many(bEntities, { relationName: \"b_entities_aEntityId\" })");
            expect(cleanResult).toContain("\"a_entity\": one(aEntities, { fields: [bEntities.aEntityId], references: [aEntities.id], relationName: \"b_entities_aEntityId\" })");
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
        const companiesCollection: CollectionConfig = {
            slug: "companies",
            table: "companies",
            name: "Companies",
            properties: {
                name: { type: "string" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "jobs",
                    target: () => jobsCollection,
                    foreignKeyOnTarget: "company_id"
                }
            ]
        };

        const jobsCollection: CollectionConfig = {
            slug: "jobs",
            table: "jobs",
            name: "Jobs",
            properties: {
                title: { type: "string" },
                company: { type: "relation",
relationName: "company" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "company",
                    target: () => companiesCollection,
                    localKey: "company_id"
                }
            ]
        };

        const result = await generateSchema([companiesCollection, jobsCollection]);
        const cleanResult = cleanSchema(result);

        // Both sides must use the same deterministic name: jobs_companyId
        const expectedSharedName = "jobs_companyId";

        // Owning side (jobs → companies)
        expect(cleanResult).toContain(
            `"company": one(companies, { fields: [jobs.companyId], references: [companies.id], relationName: \"${expectedSharedName}\" })`
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
        const usersCollection: CollectionConfig = {
            slug: "users",
            table: "users",
            name: "Users",
            properties: {
                name: { type: "string" }
            },
            relations: [
                {
                    kind: "hasOne",
                    relationName: "profile",
                    target: () => profilesCollection,
                    foreignKeyOnTarget: "user_id"
                }
            ]
        };

        const profilesCollection: CollectionConfig = {
            slug: "profiles",
            table: "profiles",
            name: "Profiles",
            properties: {
                bio: { type: "string" },
                user: { type: "relation",
relationName: "user" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "user",
                    target: () => usersCollection,
                    localKey: "user_id"
                }
            ]
        };

        const result = await generateSchema([usersCollection, profilesCollection]);
        const cleanResult = cleanSchema(result);

        const expectedSharedName = "profiles_userId";

        // Owning side (profiles → users)
        expect(cleanResult).toContain(
            `"user": one(users, { fields: [profiles.userId], references: [users.id], relationName: \"${expectedSharedName}\" })`
        );

        // Inverse side (users → profiles) — no fields/references, paired by relationName only
        expect(cleanResult).toContain(
            `"profile": one(profiles, { relationName: \"${expectedSharedName}\" })`
        );

        // Both must match
        const allNames = extractRelationNames(result);
        const matchingNames = allNames.filter(n => n === expectedSharedName);
        expect(matchingNames).toHaveLength(2);
    });

    it("should emit different shared names for multiple relations between same tables", async () => {
        const companiesCollection: CollectionConfig = {
            slug: "companies",
            table: "companies",
            name: "Companies",
            properties: { name: { type: "string" } },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "employees",
                    target: () => peopleCollection,
                    foreignKeyOnTarget: "employer_id"
                },
                {
                    kind: "hasMany",
                    relationName: "founders",
                    target: () => peopleCollection,
                    foreignKeyOnTarget: "startup_id"
                }
            ]
        };

        const peopleCollection: CollectionConfig = {
            slug: "people",
            table: "people",
            name: "People",
            properties: {
                name: { type: "string" },
                employer: { type: "relation",
relationName: "employer" },
                startup: { type: "relation",
relationName: "startup" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "employer",
                    target: () => companiesCollection,
                    localKey: "employer_id"
                },
                {
                    kind: "belongsTo",
                    relationName: "startup",
                    target: () => companiesCollection,
                    localKey: "startup_id"
                }
            ]
        };

        const result = await generateSchema([companiesCollection, peopleCollection]);
        const allNames = extractRelationNames(result);

        // Each pair should have a distinct shared name
        const employerNames = allNames.filter(n => n === "people_employerId");
        const startupNames = allNames.filter(n => n === "people_startupId");
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
 *   "There are multiple relations with name 'jobs_companyId' in table 'jobs'"
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
        const companiesCollection: CollectionConfig = {
            slug: "companies",
            table: "companies",
            name: "Companies",
            properties: {
                name: { type: "string" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "jobs",
                    target: () => jobsCollection,
                    foreignKeyOnTarget: "company_id"
                }
            ]
        };

        const jobsCollection: CollectionConfig = {
            slug: "jobs",
            table: "jobs",
            name: "Jobs",
            properties: {
                title: { type: "string" },
                // Property referencing the same FK as the explicit relation
                company: {
                    type: "relation",
                    relationName: "company"
                }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "company",
                    target: () => companiesCollection,
                    localKey: "company_id"
                }
            ]
        };

        const result = await generateSchema([companiesCollection, jobsCollection]);
        const cleanResult = cleanSchema(result);

        // The jobs table should have exactly ONE one() entry for company_id
        const jobsRelationNames = extractRelationNames(result);
        const companyIdRelNames = jobsRelationNames.filter(n => n === "jobs_companyId");

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
        const parentCollection: CollectionConfig = {
            slug: "departments",
            table: "departments",
            name: "Departments",
            properties: {
                name: { type: "string" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "team_members",
                    target: () => memberCollection,
                    foreignKeyOnTarget: "department_id"
                }
            ]
        };

        const memberCollection: CollectionConfig = {
            slug: "team-members",
            table: "team_members",
            name: "Team Members",
            properties: {
                name: { type: "string" },
                department: {
                    type: "relation",
                    relationName: "department"
                }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "department",
                    target: () => parentCollection,
                    localKey: "department_id"
                }
            ]
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
        // Exactly twice, not at most twice: Drizzle pairs an owning one() with
        // its inverse many() by identical `relationName`, so a name that appears
        // ONCE is an unpaired side — the very regression this file guards — and
        // `toBeLessThanOrEqual(2)` accepts it happily.
        for (const [name, count] of nameCountMap) {
            expect(`${name}:${count}`).toBe(`${name}:2`);
        }
    });

    it("should handle multiple different relations to the same target without duplicates", async () => {
        // Two separate FKs from one table to the same target table
        const usersCollection: CollectionConfig = {
            slug: "users",
            table: "users",
            name: "Users",
            properties: { name: { type: "string" } },
            relations: []
        };

        const messagesCollection: CollectionConfig = {
            slug: "messages",
            table: "messages",
            name: "Messages",
            properties: {
                content: { type: "string" },
                sender: { type: "relation",
relationName: "sender" },
                recipient: { type: "relation",
relationName: "recipient" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "sender",
                    target: () => usersCollection,
                    localKey: "sender_id"
                },
                {
                    kind: "belongsTo",
                    relationName: "recipient",
                    target: () => usersCollection,
                    localKey: "recipient_id"
                }
            ]
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

describe("columnName vs property key deduplication regression", () => {
    const extractRelationNames = (schema: string): string[] => {
        const matches = schema.match(/relationName:\s*"([^"]+)"/g) ?? [];
        return matches.map(m => m.replace(/relationName:\s*"/, "").replace(/"$/, ""));
    };

    it("should not emit a synthetic duplicate when property uses columnName different from property key", async () => {
        // Scenario: engagements.clientId has columnName: "client_id"
        // The explicit owning relation uses localKey: "clientId" (property key).
        // The inverse relation on clients uses foreignKeyOnTarget: "client_id" (raw column).
        // Without the fix, the synthetic loop would emit a broken second relation
        // using engagements.client_id (which doesn't exist as a Drizzle property).
        const clientsCollection: CollectionConfig = {
            slug: "clients",
            table: "clients",
            name: "Clients",
            properties: {
                id: { type: "string" },
                name: { type: "string" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "engagements",
                    target: () => engagementsCollection,
                    foreignKeyOnTarget: "client_id"
                }
            ]
        };

        const engagementsCollection: CollectionConfig = {
            slug: "engagements",
            table: "engagements",
            name: "Engagements",
            properties: {
                id: { type: "string" },
                clientId: {
                    type: "relation",
                    columnName: "client_id",
                    relation: {
                        kind: "belongsTo",
                        target: () => clientsCollection,
                        relationName: "client",
                        localKey: "clientId",
                    }
                } as any,
                title: { type: "string" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "client",
                    target: () => clientsCollection,
                    localKey: "clientId"
                }
            ]
        };

        const result = await generateSchema([clientsCollection, engagementsCollection]);

        // engagements should have exactly ONE one() entry for clientId
        const engagementsRelBlock = result.match(/export const engagementsRelations[\s\S]*?\}\)\);/)?.[0] ?? "";
        const oneEntries = (engagementsRelBlock.match(/:\s*one\(/g) ?? []).length;
        expect(oneEntries).toBe(1);

        // The one() entry must reference engagements.clientId (property key), NOT engagements.client_id
        expect(engagementsRelBlock).toContain("engagements.clientId");
        expect(engagementsRelBlock).not.toContain("engagements.client_id");

        // No _synth_ entry should appear
        expect(engagementsRelBlock).not.toContain("_synth_");
    });

    it("should produce matching relation names on both sides when columnName differs from property key", async () => {
        const clientsCollection: CollectionConfig = {
            slug: "clients",
            table: "clients",
            name: "Clients",
            properties: {
                id: { type: "string" },
                name: { type: "string" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "engagements",
                    target: () => engagementsCollection,
                    foreignKeyOnTarget: "client_id"
                }
            ]
        };

        const engagementsCollection: CollectionConfig = {
            slug: "engagements",
            table: "engagements",
            name: "Engagements",
            properties: {
                id: { type: "string" },
                clientId: {
                    type: "relation",
                    columnName: "client_id",
                    relation: {
                        kind: "belongsTo",
                        target: () => clientsCollection,
                        relationName: "client",
                        localKey: "clientId",
                    }
                } as any,
                title: { type: "string" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "client",
                    target: () => clientsCollection,
                    localKey: "clientId"
                }
            ]
        };

        const result = await generateSchema([clientsCollection, engagementsCollection]);

        // Extract relation names from both sides
        const engagementsRelBlock = result.match(/export const engagementsRelations[\s\S]*?\}\)\);/)?.[0] ?? "";
        const clientsRelBlock = result.match(/export const clientsRelations[\s\S]*?\}\)\);/)?.[0] ?? "";

        const engagementsRelNames = extractRelationNames(engagementsRelBlock);
        const clientsRelNames = extractRelationNames(clientsRelBlock);

        // Both sides must share the same relation name
        expect(engagementsRelNames.length).toBeGreaterThanOrEqual(1);
        expect(clientsRelNames.length).toBeGreaterThanOrEqual(1);

        // The owning side's relation name should appear in the inverse side too
        const sharedName = engagementsRelNames[0];
        expect(clientsRelNames).toContain(sharedName);
    });

    it("should correctly handle inverse one-to-one with columnName on target", async () => {
        // One-to-one: user has a profile, profile has userId with columnName: "user_id"
        const usersCollection: CollectionConfig = {
            slug: "users",
            table: "users",
            name: "Users",
            properties: {
                id: { type: "string" },
                name: { type: "string" }
            },
            relations: [
                {
                    kind: "hasOne",
                    relationName: "profile",
                    target: () => profilesCollection,
                    foreignKeyOnTarget: "user_id"
                }
            ]
        };

        const profilesCollection: CollectionConfig = {
            slug: "profiles",
            table: "profiles",
            name: "Profiles",
            properties: {
                id: { type: "string" },
                userId: {
                    type: "relation",
                    columnName: "user_id",
                    relation: {
                        kind: "belongsTo",
                        target: () => usersCollection,
                        relationName: "user",
                        localKey: "userId",
                    }
                } as any,
                bio: { type: "string" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "user",
                    target: () => usersCollection,
                    localKey: "userId"
                }
            ]
        };

        const result = await generateSchema([usersCollection, profilesCollection]);

        // profiles should have exactly ONE one() entry
        const profilesRelBlock = result.match(/export const profilesRelations[\s\S]*?\}\)\);/)?.[0] ?? "";
        const oneEntries = (profilesRelBlock.match(/:\s*one\(/g) ?? []).length;
        expect(oneEntries).toBe(1);

        // Must reference profiles.userId (property key), NOT profiles.user_id
        expect(profilesRelBlock).toContain("profiles.userId");
        expect(profilesRelBlock).not.toContain("profiles.user_id");

        // No _synth_ entry
        expect(profilesRelBlock).not.toContain("_synth_");
    });

    it("should still emit synthetic relations when no explicit owning relation exists", async () => {
        // When a collection has a FK column but no explicit owning relation defined,
        // the synthetic loop should still create the missing relation.
        const categoriesCollection: CollectionConfig = {
            slug: "categories",
            table: "categories",
            name: "Categories",
            properties: {
                id: { type: "string" },
                name: { type: "string" }
            },
            relations: [
                {
                    kind: "hasMany",
                    relationName: "products",
                    target: () => productsCollection,
                    foreignKeyOnTarget: "category_id"
                }
            ]
        };

        const productsCollection: CollectionConfig = {
            slug: "products",
            table: "products",
            name: "Products",
            properties: {
                id: { type: "string" },
                name: { type: "string" },
                category_id: { type: "string" }
                // NOTE: no type: "relation" and no explicit relations[]
            }
        };

        const result = await generateSchema([categoriesCollection, productsCollection]);

        // products should get a synthetic one() for category_id
        const productsRelBlock = result.match(/export const productsRelations[\s\S]*?\}\)\);/)?.[0] ?? "";
        expect(productsRelBlock).toContain("one(categories");
        expect(productsRelBlock).toContain("products.category_id");
    });
});
