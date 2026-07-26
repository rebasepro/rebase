import {
    CollectionConfig,
    PostgresCollectionConfig,
    RelationProperty,
    MapProperty,
    ArrayProperty,
    Relation
} from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";
import { resolveRelationProperty } from "../src/util/resolutions";

// ── Fixtures ──────────────────────────────────────────────────────────

function makeTagsCollection(): PostgresCollectionConfig {
    return {
        name: "Tags",
        slug: "tags",
        table: "tags",
        properties: {
            id: { type: "number",
isId: "increment" },
            name: { type: "string" }
        }
    };
}

function makeAuthorsCollection(): PostgresCollectionConfig {
    return {
        name: "Authors",
        slug: "authors",
        table: "authors",
        properties: {
            id: { type: "number",
isId: "increment" },
            display_name: { type: "string" }
        }
    };
}

/**
 * Posts collection using INLINE relation config on properties —
 * NO explicit `relations[]` on the collection.
 * This is the new API that should "just work".
 */
function makePostsWithInlineRelations(
    tagsCol: PostgresCollectionConfig,
    authorsCol: PostgresCollectionConfig
): PostgresCollectionConfig {
    return {
        name: "Blog posts",
        slug: "posts",
        table: "posts",
        properties: {
            id: { type: "number",
isId: "increment" },
            title: { type: "string" },
            author: {
                name: "Author",
                type: "relation",
                relation: {
                    kind: "belongsTo",
                    target: () => authorsCol,
                }
            } as RelationProperty,
            tags: {
                name: "Tags",
                type: "relation",
                relation: {
                    kind: "manyToMany",
                    target: () => tagsCol,
                }
            } as RelationProperty
        }
    };
}

/**
 * Posts collection using the LEGACY explicit `relations[]` array.
 * The properties use `relationName` + `collectionPath` instead of inline `target`.
 */
function makePostsWithExplicitRelations(
    tagsCol: PostgresCollectionConfig,
    authorsCol: PostgresCollectionConfig
): PostgresCollectionConfig {
    return {
        name: "Blog posts (legacy)",
        slug: "posts-legacy",
        table: "posts_legacy",
        properties: {
            id: { type: "number",
isId: "increment" },
            title: { type: "string" },
            author: {
                name: "Author",
                type: "relation",
                relationName: "author_rel",
                collectionPath: "authors"
            } as RelationProperty,
            tags: {
                name: "Tags",
                type: "relation",
                relationName: "tags_rel",
                collectionPath: "tags"
            } as RelationProperty
        },
        relations: [
            {
                kind: "belongsTo",
                relationName: "author_rel",
                target: () => authorsCol,
                },
            {
                kind: "manyToMany",
                relationName: "tags_rel",
                target: () => tagsCol,
                }
        ]
    };
}

// ══════════════════════════════════════════════════════════════════════
// Layer 1: extractRelationsFromProperties
// Verifies that inline `target` on properties produces Relation[] entries
// ══════════════════════════════════════════════════════════════════════

describe("Layer 1 – extractRelationsFromProperties", () => {
    it("extracts relations from inline target/cardinality/direction on properties", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        // normalizeCollection is public — we can call it to inspect extraction
        const normalized = registry.normalizeCollection({ ...posts });

        // After normalization, the collection should have `relations[]` populated
        expect((normalized as PostgresCollectionConfig).relations).toBeDefined();
        const relations = (normalized as PostgresCollectionConfig).relations!;
        expect(relations.length).toBeGreaterThanOrEqual(2);

        const authorRel = relations.find((r) => r.relationName === "author");
        expect(authorRel).toBeDefined();
        expect(authorRel!.cardinality).toBe("one");
        expect(authorRel!.direction).toBe("owning");
        expect(authorRel!.target()).toBe(authors);

        const tagsRel = relations.find((r) => r.relationName === "tags");
        expect(tagsRel).toBeDefined();
        expect(tagsRel!.cardinality).toBe("many");
        expect(tagsRel!.direction).toBe("owning");
        expect(tagsRel!.target()).toBe(tags);
    });

    it("does NOT extract relations when target is absent (legacy style)", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithExplicitRelations(tags, authors);

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...posts });
        const relations = (normalized as PostgresCollectionConfig).relations!;

        // The explicit relations should be present (author_rel, tags_rel)
        expect(relations.find((r) => r.relationName === "author_rel")).toBeDefined();
        expect(relations.find((r) => r.relationName === "tags_rel")).toBeDefined();
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 2: normalizeProperty stamps `relation` on each RelationProperty
// ══════════════════════════════════════════════════════════════════════

describe("Layer 2 – normalizeProperty stamps relation metadata", () => {
    it("stamps `relation` on inline relation properties after normalization", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...posts });

        const authorProp = normalized.properties.author as RelationProperty;
        expect(authorProp.type).toBe("relation");
        expect(authorProp.relation).toBeDefined();
        expect(authorProp.relation!.cardinality).toBe("one");
        expect(authorProp.relation!.target()).toBe(authors);

        const tagsProp = normalized.properties.tags as RelationProperty;
        expect(tagsProp.type).toBe("relation");
        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.cardinality).toBe("many");
        expect(tagsProp.relation!.target()).toBe(tags);
    });

    it("stamps `relation` on legacy (explicit relations[]) properties", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithExplicitRelations(tags, authors);

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...posts });

        const authorProp = normalized.properties.author as RelationProperty;
        expect(authorProp.relation).toBeDefined();
        expect(authorProp.relation!.relationName).toBe("author_rel");

        const tagsProp = normalized.properties.tags as RelationProperty;
        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.relationName).toBe("tags_rel");
    });

    it("stamps relation on nested map properties", () => {
        const tags = makeTagsCollection();
        const posts: PostgresCollectionConfig = {
            name: "Posts",
            slug: "posts-nested",
            table: "posts_nested",
            properties: {
                metadata: {
                    type: "map",
                    properties: {
                        primary_tag: {
                            name: "Primary Tag",
                            type: "relation",
                            relation: {
                                kind: "belongsTo",
                                target: () => tags,
                            }
                        } as RelationProperty
                    }
                }
            }
        };

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...posts });

        const mapProp = normalized.properties.metadata as MapProperty;
        const nestedRelProp = mapProp.properties!.primary_tag as RelationProperty;
        expect(nestedRelProp.relation).toBeDefined();
        expect(nestedRelProp.relation!.cardinality).toBe("one");
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 3: registerMultiple preserves relation metadata through the
//          dual normalization pass and registry storage
// ══════════════════════════════════════════════════════════════════════

describe("Layer 3 – registerMultiple preserves relation metadata", () => {
    it("get() returns collection with relation metadata on inline properties", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry([tags, authors, posts]);

        const stored = registry.get("posts");
        expect(stored).toBeDefined();

        const tagsProp = stored!.properties.tags as RelationProperty;
        expect(tagsProp.type).toBe("relation");
        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.cardinality).toBe("many");
        expect(tagsProp.relation!.target()).toBe(tags);

        const authorProp = stored!.properties.author as RelationProperty;
        expect(authorProp.relation).toBeDefined();
        expect(authorProp.relation!.cardinality).toBe("one");
    });

    it("get() returns collection with relation metadata on legacy properties", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithExplicitRelations(tags, authors);

        const registry = new CollectionRegistry([tags, authors, posts]);

        const stored = registry.get("posts-legacy");
        expect(stored).toBeDefined();

        const tagsProp = stored!.properties.tags as RelationProperty;
        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.relationName).toBe("tags_rel");
    });

    it("getRaw() does NOT have relation metadata (preserves raw input)", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry([tags, authors, posts]);

        const raw = registry.getRaw("posts");
        expect(raw).toBeDefined();

        const tagsProp = raw!.properties.tags as RelationProperty;
        expect(tagsProp.relation).toBeUndefined();
    });

    it("getCollections() returns all collections with relation metadata", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry([tags, authors, posts]);

        const allCollections = registry.getCollections();
        const postsCol = allCollections.find((c) => c.slug === "posts");
        expect(postsCol).toBeDefined();

        const tagsProp = postsCol!.properties.tags as RelationProperty;
        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.cardinality).toBe("many");
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 4: collection.relations[] is populated from inline properties
//          (so form bindings can use resolveRelationProperty)
// ══════════════════════════════════════════════════════════════════════

describe("Layer 4 – collection.relations[] populated from inline config", () => {
    it("inline target properties generate collection.relations entries", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry([tags, authors, posts]);
        const stored = registry.get("posts") as PostgresCollectionConfig;

        expect(stored.relations).toBeDefined();
        expect(stored.relations!.length).toBeGreaterThanOrEqual(2);

        const authorRel = stored.relations!.find((r) => r.relationName === "author");
        expect(authorRel).toBeDefined();
        expect(authorRel!.cardinality).toBe("one");

        const tagsRel = stored.relations!.find((r) => r.relationName === "tags");
        expect(tagsRel).toBeDefined();
        expect(tagsRel!.cardinality).toBe("many");
    });

    it("form-level resolveRelationProperty works with inline-only config", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry([tags, authors, posts]);
        const stored = registry.get("posts") as PostgresCollectionConfig;
        const tagsProp = stored.properties.tags as RelationProperty;

        // resolveRelationProperty should find the relation because:
        // 1. If tagsProp.relation is already set, it returns immediately
        // 2. Otherwise, it should find it via stored.relations[]
        const resolved = resolveRelationProperty(tagsProp, stored.relations!, "tags");
        expect(resolved.relation).toBeDefined();
        expect(resolved.relation!.cardinality).toBe("many");
        expect(resolved.relation!.target()).toBe(tags);
    });

    it("form-level resolveRelationProperty works even if property.relation is undefined", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry([tags, authors, posts]);
        const stored = registry.get("posts") as PostgresCollectionConfig;

        // Simulate a scenario where property.relation was stripped (e.g. by serialization)
        const strippedProp: RelationProperty = {
            ...stored.properties.tags as RelationProperty,
            relation: undefined
        };
        // The property should still have a relationName that matches
        // (the normalization process sets relationName from the key)
        // But in the inline case, the property key IS the relationName

        const resolved = resolveRelationProperty(strippedProp, stored.relations!, "tags");
        expect(resolved.relation).toBeDefined();
        expect(resolved.relation!.cardinality).toBe("many");
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 5: Idempotency – re-registration preserves metadata
// ══════════════════════════════════════════════════════════════════════

describe("Layer 5 – idempotent re-registration", () => {
    it("second registerMultiple with identical input is a no-op (returns false)", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        const changed1 = registry.registerMultiple([tags, authors, posts]);
        expect(changed1).toBe(true);

        const changed2 = registry.registerMultiple([tags, authors, posts]);
        expect(changed2).toBe(false);

        // Metadata should still be present after the no-op
        const stored = registry.get("posts");
        const tagsProp = stored!.properties.tags as RelationProperty;
        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.cardinality).toBe("many");
    });

    it("re-registration with modified collection updates metadata", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        registry.registerMultiple([tags, authors, posts]);

        // Modify the posts collection — change tags cardinality to "one"
        const modifiedPosts: PostgresCollectionConfig = {
            ...posts,
            properties: {
                ...posts.properties,
                tags: {
                    kind: "belongsTo",
                    ...(posts.properties.tags as RelationProperty),
                    }
            }
        };

        const changed = registry.registerMultiple([tags, authors, modifiedPosts]);
        expect(changed).toBe(true);

        const stored = registry.get("posts");
        const tagsProp = stored!.properties.tags as RelationProperty;
        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.cardinality).toBe("one");
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 6: Circular dependency resilience (posts → tags → posts)
// ══════════════════════════════════════════════════════════════════════

describe("Layer 6 – circular dependency resilience", () => {
    it("handles mutual references between collections (posts ↔ tags)", () => {
        const tags: PostgresCollectionConfig = {
            name: "Tags",
            slug: "tags",
            table: "tags",
            properties: {
                id: { type: "number",
isId: "increment" },
                name: { type: "string" }
            },
            // tags has an inverse relation pointing back to posts
            relations: []
        };

        const posts: PostgresCollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                id: { type: "number",
isId: "increment" },
                tags: {
                    name: "Tags",
                    type: "relation",
                    relation: {
                        kind: "manyToMany",
                        target: () => tags,
                    }
                } as RelationProperty
            }
        };

        // Now add the inverse relation on tags pointing back to posts
        tags.relations = [
            {
                // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                // Was: cardinality=many direction=inverse
                kind: "AMBIGUOUS",
                relationName: "posts",
                target: () => posts,
                }
        ];

        const registry = new CollectionRegistry([posts, tags]);

        // Posts should have tags relation
        const storedPosts = registry.get("posts");
        expect(storedPosts).toBeDefined();
        const postTagsProp = storedPosts!.properties.tags as RelationProperty;
        expect(postTagsProp.relation).toBeDefined();
        expect(postTagsProp.relation!.cardinality).toBe("many");

        // Tags should have posts relation
        const storedTags = registry.get("tags") as PostgresCollectionConfig;
        expect(storedTags).toBeDefined();
        expect(storedTags.relations).toBeDefined();
        expect(storedTags.relations!.find((r) => r.relationName === "posts")).toBeDefined();
    });

    it("resolves string target slugs correctly when registering collections", () => {
        const posts: PostgresCollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                id: { type: "number",
isId: "increment" },
                author: {
                    name: "Author",
                    type: "relation",
                    // String slug instead of function returning reference,
                    relation: {
                        kind: "belongsTo",
                        target: "authors",
                    }
                } as RelationProperty
            }
        };

        const authors: PostgresCollectionConfig = {
            name: "Authors",
            slug: "authors",
            table: "authors",
            properties: {
                id: { type: "number",
isId: "increment" },
                name: { type: "string" }
            }
        };

        const registry = new CollectionRegistry([posts, authors]);

        const storedPosts = registry.get("posts") as PostgresCollectionConfig;
        expect(storedPosts).toBeDefined();

        const authorProp = storedPosts.properties.author as RelationProperty;
        expect(authorProp.relation).toBeDefined();
        expect(authorProp.relation!.cardinality).toBe("one");

        const resolvedTarget = authorProp.relation!.target();
        expect(resolvedTarget).toBeDefined();
        expect(resolvedTarget.slug).toBe("authors");
        expect(resolvedTarget.name).toBe("Authors");
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 7: Mixed inline + explicit relations on the same collection
// ══════════════════════════════════════════════════════════════════════

describe("Layer 7 – mixed inline + explicit relations", () => {
    it("inline properties and explicit relations[] coexist without conflict", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const categories: PostgresCollectionConfig = {
            name: "Categories",
            slug: "categories",
            table: "categories",
            properties: {
                id: { type: "number",
isId: "increment" },
                name: { type: "string" }
            }
        };

        const posts: PostgresCollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                id: { type: "number",
isId: "increment" },
                title: { type: "string" },
                // Inline relation — no separate relations[] entry needed
                tags: {
                    name: "Tags",
                    type: "relation",
                    relation: {
                        kind: "manyToMany",
                        target: () => tags,
                    }
                } as RelationProperty,
                // Legacy relation — uses explicit relations[]
                author: {
                    name: "Author",
                    type: "relation",
                    relationName: "author_link",
                    collectionPath: "authors"
                } as RelationProperty,
                // Another inline relation
                category: {
                    name: "Category",
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        target: () => categories,
                    }
                } as RelationProperty
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "author_link",
                    target: () => authors,
                    }
            ]
        };

        const registry = new CollectionRegistry([tags, authors, categories, posts]);
        const stored = registry.get("posts") as PostgresCollectionConfig;
        expect(stored).toBeDefined();

        // Check inline tags relation
        const tagsProp = stored.properties.tags as RelationProperty;
        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.cardinality).toBe("many");

        // Check explicit author relation
        const authorProp = stored.properties.author as RelationProperty;
        expect(authorProp.relation).toBeDefined();
        expect(authorProp.relation!.relationName).toBe("author_link");

        // Check inline category relation
        const catProp = stored.properties.category as RelationProperty;
        expect(catProp.relation).toBeDefined();
        expect(catProp.relation!.cardinality).toBe("one");

        // All three relations should be in the collection.relations[]
        expect(stored.relations!.length).toBeGreaterThanOrEqual(3);
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 8: table_bindings code path — property.relation must be truthy
// ══════════════════════════════════════════════════════════════════════

describe("Layer 8 – property.relation is truthy for table binding selection", () => {
    it("relation property from registry has truthy relation field (not undefined/null)", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry([tags, authors, posts]);
        const stored = registry.get("posts");
        expect(stored).toBeDefined();

        // Simulate what table_bindings.tsx does:
        // `if (property.type === "relation") { if (property.relation) { ... } }`
        for (const [key, prop] of Object.entries(stored!.properties)) {
            if (prop.type === "relation") {
                const relProp = prop as RelationProperty;
                expect(relProp.relation).toBeTruthy();
                expect(typeof relProp.relation!.target).toBe("function");
                expect(["one", "many"]).toContain(relProp.relation!.cardinality);
            }
        }
    });

    it("all keys of the Relation object are present and valid", () => {
        const tags = makeTagsCollection();
        const posts: PostgresCollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                id: { type: "number",
isId: "increment" },
                tags: {
                    name: "Tags",
                    type: "relation",
                    relation: {
                        kind: "manyToMany",
                        target: () => tags,
                        through: {
                        table: "posts_tags",
                        sourceColumn: "post_id",
                        targetColumn: "tag_id"
                    },
                    }
                } as RelationProperty
            }
        };

        const registry = new CollectionRegistry([tags, posts]);
        const stored = registry.get("posts");
        const tagsProp = stored!.properties.tags as RelationProperty;
        const relation = tagsProp.relation!;

        expect(relation.relationName).toBe("tags");
        expect(relation.target).toBeDefined();
        expect(relation.target()).toBe(tags);
        expect(relation.cardinality).toBe("many");
        expect(relation.direction).toBe("owning");
        expect(relation.through).toEqual({
            table: "posts_tags",
            sourceColumn: "post_id",
            targetColumn: "tag_id"
        });
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 9: relation: { target } nested config on property
// ══════════════════════════════════════════════════════════════════════

describe("Layer 9 – nested relation config (property.relation.target)", () => {
    it("extracts relation when target is inside property.relation instead of inline", () => {
        const customers: PostgresCollectionConfig = {
            name: "Customers",
            slug: "customers",
            table: "customers",
            properties: {
                id: { type: "number",
isId: "increment" },
                name: { type: "string" }
            }
        };

        const orders: PostgresCollectionConfig = {
            name: "Orders",
            slug: "orders",
            table: "orders",
            properties: {
                id: { type: "number",
isId: "increment" },
                // This mimics the pattern in orders.ts where the developer puts
                // target inside property.relation rather than directly on the property
                customer: {
                    name: "Customer",
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        relationName: "customer",
                        target: () => customers,
                        localKey: "customer_id"
                    }
                } as RelationProperty
            }
        };

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...orders });

        // The relation should have been extracted into relations[]
        const relations = (normalized as PostgresCollectionConfig).relations!;
        expect(relations).toBeDefined();
        const customerRel = relations.find((r) => r.relationName === "customer");
        expect(customerRel).toBeDefined();
        expect(customerRel!.cardinality).toBe("one");
        expect(customerRel!.direction).toBe("owning");
        expect(customerRel!.localKey).toBe("customer_id");
        expect(customerRel!.target()).toBe(customers);

        // The property should have relation metadata stamped
        const custProp = normalized.properties.customer as RelationProperty;
        expect(custProp.relation).toBeDefined();
        expect(custProp.relation!.target()).toBe(customers);
    });

    it("inline target on property takes precedence over nested relation.target", () => {
        const customers: PostgresCollectionConfig = {
            name: "Customers",
            slug: "customers",
            table: "customers",
            properties: {
                id: { type: "number",
isId: "increment" }
            }
        };

        const orders: PostgresCollectionConfig = {
            name: "Orders",
            slug: "orders",
            table: "orders",
            properties: {
                id: { type: "number",
isId: "increment" },
                customer: {
                    name: "Customer",
                    type: "relation",
                    // Inline target (takes precedence)
                    target: () => customers,
                    cardinality: "one",
                    direction: "owning",
                    // Nested relation with different cardinality (should be ignored)
                    relation: {
                        // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                        // Was: cardinality=many direction=inverse
                        kind: "AMBIGUOUS",
                        relationName: "customer",
                        target: () => customers,
                        }
                } as RelationProperty
            }
        };

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...orders });
        const relations = (normalized as PostgresCollectionConfig).relations!;
        const customerRel = relations.find((r) => r.relationName === "customer");
        expect(customerRel).toBeDefined();
        // Inline takes precedence: cardinality should be "one", not "many"
        expect(customerRel!.cardinality).toBe("one");
        expect(customerRel!.direction).toBe("owning");
    });
});

// ══════════════════════════════════════════════════════════════════════
// Layer 10: Recursive registration with cascading relations
// (customers → orders → order_items → products)
// ══════════════════════════════════════════════════════════════════════

describe("Layer 10 – recursive _registerRecursively with deep chains", () => {
    it("does not crash when normalized subcollections differ from raw subcollections", () => {
        const products: PostgresCollectionConfig = {
            name: "Products",
            slug: "products",
            table: "products",
            properties: {
                id: { type: "number",
isId: "increment" },
                name: { type: "string" }
            }
        };

        const orderItems: PostgresCollectionConfig = {
            name: "Order Items",
            slug: "order_items",
            table: "order_items",
            properties: {
                id: { type: "number",
isId: "increment" },
                quantity: { type: "number" },
                // Inline relation to orders — will be extracted as "one"
                order: {
                    name: "Order",
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        relationName: "order",
                        target: () => orders,
                        }
                } as RelationProperty,
                // Inline relation to products
                product: {
                    name: "Product",
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        target: () => products,
                    }
                } as RelationProperty
            }
        };

        const orders: PostgresCollectionConfig = {
            name: "Orders",
            slug: "orders",
            table: "orders",
            properties: {
                id: { type: "number",
isId: "increment" },
                total: { type: "number" }
            },
            relations: [
                {
                    // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                    // Was: cardinality=many direction=inverse
                    kind: "AMBIGUOUS",
                    relationName: "order_items",
                    target: () => orderItems,
                    }
            ]
        };

        const customers: PostgresCollectionConfig = {
            name: "Customers",
            slug: "customers",
            table: "customers",
            properties: {
                id: { type: "number",
isId: "increment" },
                name: { type: "string" }
            },
            relations: [
                {
                    // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                    // Was: cardinality=many direction=inverse
                    kind: "AMBIGUOUS",
                    relationName: "orders",
                    target: () => orders,
                    }
            ]
        };

        // This should NOT crash — the old code would fail because
        // rawSubcollections[index] could be undefined when normalized
        // subcollections have more entries due to inline extraction
        expect(() => {
            const registry = new CollectionRegistry();
            registry.registerMultiple([customers, orders, orderItems, products]);
        }).not.toThrow();

        // Also test register() path (used by backend init)
        expect(() => {
            const registry = new CollectionRegistry();
            [customers, orders, orderItems, products].forEach((c) => {
                registry.register(c);
            });
        }).not.toThrow();
    });

    it("registers all collections in the chain via single-register path", () => {
        const products: PostgresCollectionConfig = {
            name: "Products",
            slug: "products",
            table: "products",
            properties: {
                id: { type: "number",
isId: "increment" },
                name: { type: "string" }
            }
        };

        const orderItems: PostgresCollectionConfig = {
            name: "Order Items",
            slug: "order_items",
            table: "order_items",
            properties: {
                id: { type: "number",
isId: "increment" },
                product: {
                    name: "Product",
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        target: () => products,
                    }
                } as RelationProperty
            }
        };

        const orders: PostgresCollectionConfig = {
            name: "Orders",
            slug: "orders",
            table: "orders",
            properties: {
                id: { type: "number",
isId: "increment" }
            },
            relations: [
                {
                    // TODO(relations): ambiguous under the tagged union — declare the kind explicitly.
                    // Was: cardinality=many direction=inverse
                    kind: "AMBIGUOUS",
                    relationName: "order_items",
                    target: () => orderItems,
                    }
            ]
        };

        const registry = new CollectionRegistry();
        // Only register orders — it should recursively register order_items
        registry.register(orders);

        expect(registry.get("orders")).toBeDefined();
        expect(registry.get("order_items")).toBeDefined();
        // Products is a "one" relation, not a subcollection ("many"), so it won't be auto-registered
    });
});

// ══════════════════════════════════════════════════════════════════════
// REGRESSION: sanitizeRelation must be called during normalizeCollection
// Without this, derived fields (through, localKey, foreignKeyOnTarget)
// are missing from both collection.relations[] and property.relation,
// breaking junction-table (many-to-many) data fetching on the backend.
// ══════════════════════════════════════════════════════════════════════

describe("Regression – normalizeCollection sanitizes relations (derived fields)", () => {

    it("populates `through` on many-to-many owning relations in collection.relations[]", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...posts }) as PostgresCollectionConfig;
        const tagsRel = normalized.relations!.find(r => r.relationName === "tags");

        expect(tagsRel).toBeDefined();
        expect(tagsRel!.through).toBeDefined();
        expect(tagsRel!.through!.table).toBe("posts_tags");
        expect(tagsRel!.through!.sourceColumn).toBe("post_id");
        expect(tagsRel!.through!.targetColumn).toBe("tag_id");
    });

    it("populates `through` on property.relation for many-to-many owning properties", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...posts });
        const tagsProp = normalized.properties.tags as RelationProperty;

        expect(tagsProp.relation).toBeDefined();
        expect(tagsProp.relation!.through).toBeDefined();
        expect(tagsProp.relation!.through!.table).toBe("posts_tags");
        expect(tagsProp.relation!.through!.sourceColumn).toBe("post_id");
        expect(tagsProp.relation!.through!.targetColumn).toBe("tag_id");
    });

    it("populates `localKey` on one-to-one owning relations in collection.relations[]", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...posts }) as PostgresCollectionConfig;
        const authorRel = normalized.relations!.find(r => r.relationName === "author");

        expect(authorRel).toBeDefined();
        expect(authorRel!.localKey).toBe("author_id");
    });

    it("populates `localKey` on property.relation for one-to-one owning properties", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...posts });
        const authorProp = normalized.properties.author as RelationProperty;

        expect(authorProp.relation).toBeDefined();
        expect(authorProp.relation!.localKey).toBe("author_id");
    });

    it("preserves explicit `through` config and does not override it", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();

        const postsWithExplicitThrough: PostgresCollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                id: { type: "number",
isId: "increment" },
                title: { type: "string" },
                tags: {
                    name: "Tags",
                    type: "relation",
                    relation: {
                        kind: "manyToMany",
                        target: () => tags,
                        through: {
                        table: "custom_junction",
                        sourceColumn: "src",
                        targetColumn: "tgt"
                    },
                    }
                } as RelationProperty
            }
        };

        const registry = new CollectionRegistry();
        const normalized = registry.normalizeCollection({ ...postsWithExplicitThrough }) as PostgresCollectionConfig;
        const tagsRel = normalized.relations!.find(r => r.relationName === "tags");

        expect(tagsRel!.through!.table).toBe("custom_junction");
        expect(tagsRel!.through!.sourceColumn).toBe("src");
        expect(tagsRel!.through!.targetColumn).toBe("tgt");
    });

    it("derived fields survive full registry registration (registerMultiple)", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        registry.registerMultiple([posts, tags, authors]);

        const stored = registry.get("posts") as PostgresCollectionConfig;
        expect(stored).toBeDefined();

        // collection.relations[] must have through
        const tagsRel = stored.relations!.find(r => r.relationName === "tags");
        expect(tagsRel!.through).toBeDefined();
        expect(tagsRel!.through!.table).toBe("posts_tags");

        // property.relation must also have through
        const tagsProp = stored.properties.tags as RelationProperty;
        expect(tagsProp.relation!.through).toBeDefined();
        expect(tagsProp.relation!.through!.table).toBe("posts_tags");

        // author must have localKey
        const authorRel = stored.relations!.find(r => r.relationName === "author");
        expect(authorRel!.localKey).toBe("author_id");
        const authorProp = stored.properties.author as RelationProperty;
        expect(authorProp.relation!.localKey).toBe("author_id");
    });

    it("resolveCollectionRelations returns consistent through with property.relation", () => {
        const tags = makeTagsCollection();
        const authors = makeAuthorsCollection();
        const posts = makePostsWithInlineRelations(tags, authors);

        const registry = new CollectionRegistry();
        registry.registerMultiple([posts, tags, authors]);

        const stored = registry.get("posts")!;
        const { resolveCollectionRelations } = require("../src/util/relations");
        const resolved = resolveCollectionRelations(stored);

        // resolveCollectionRelations and property.relation must agree
        const tagsProp = stored.properties.tags as RelationProperty;
        expect(resolved.tags.through).toEqual(tagsProp.relation!.through);
        expect(resolved.author.localKey).toEqual((stored.properties.author as RelationProperty).relation!.localKey);
    });
});
