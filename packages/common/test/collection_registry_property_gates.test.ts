import {
    CollectionConfig,
    PostgresCollectionConfig,
    FirebaseCollectionConfig,
    MongoDBCollectionConfig,
    ReferenceProperty,
    RelationProperty,
    StringProperty
} from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";

describe("CollectionRegistry — engine-specific property gates", () => {

    it("registers and retrieves a Postgres collection with relation properties", () => {
        const postsCollection: CollectionConfig = {
            id: "posts",
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                title: { type: "string" }
            }
        };

        const authorsCollection: PostgresCollectionConfig = {
            id: "authors",
            name: "Authors",
            slug: "authors",
            table: "authors",
            properties: {
                name: { type: "string" },
                posts: {
                    type: "relation",
                    relation: {
                        kind: "hasMany",
                        relationName: "author_posts_link",
                        target: () => postsCollection,
                        foreignKeyOnTarget: "author_id"
                    }
                }
            }
        };

        const registry = new CollectionRegistry([postsCollection, authorsCollection]);

        const result = registry.get("authors");
        expect(result).toBeDefined();
        expect(result!.properties.name.type).toBe("string");
        expect(result!.properties.posts.type).toBe("relation");

        // Normalization should inject the resolved relation
        const relProp = result!.properties.posts as RelationProperty;
        expect(relProp.resolvedRelation).toBeDefined();
        expect(relProp.resolvedRelation!.targetSlug).toBe("posts");
    });

    it("registers and retrieves a Firestore collection with reference properties", () => {
        const fsCollection: FirebaseCollectionConfig = {
            id: "articles",
            name: "Articles",
            slug: "articles",
            driver: "firestore",
            properties: {
                title: { type: "string" },
                author: {
                    type: "reference",
                    path: "users"
                }
            }
        };

        const registry = new CollectionRegistry([fsCollection]);

        const result = registry.get("articles");
        expect(result).toBeDefined();
        expect(result!.properties.title.type).toBe("string");
        expect(result!.properties.author.type).toBe("reference");
        const refProp = result!.properties.author as ReferenceProperty;
        expect(refProp.path).toBe("users");
    });

    it("registers and retrieves a MongoDB collection with reference properties", () => {
        const mongoCollection: MongoDBCollectionConfig = {
            id: "comments",
            name: "Comments",
            slug: "comments",
            driver: "mongodb",
            properties: {
                body: { type: "string" },
                post: {
                    type: "reference",
                    path: "posts"
                }
            }
        };

        const registry = new CollectionRegistry([mongoCollection]);

        const result = registry.get("comments");
        expect(result).toBeDefined();
        expect(result!.properties.body.type).toBe("string");
        expect(result!.properties.post.type).toBe("reference");
        const refProp = result!.properties.post as ReferenceProperty;
        expect(refProp.path).toBe("posts");
    });

    it("handles a mixed-engine registry with Postgres, Firestore, and MongoDB collections", () => {
        const pgCol: PostgresCollectionConfig = {
            id: "users",
            name: "Users",
            slug: "users",
            table: "users",
            properties: {
                email: { type: "string", email: true }
            }
        };

        const fsCol: FirebaseCollectionConfig = {
            id: "docs",
            name: "Docs",
            slug: "docs",
            driver: "firestore",
            properties: {
                content: { type: "string" },
                owner: { type: "reference", path: "users" }
            }
        };

        const mongoCol: MongoDBCollectionConfig = {
            id: "logs",
            name: "Logs",
            slug: "logs",
            driver: "mongodb",
            properties: {
                message: { type: "string" },
                user: { type: "reference", path: "users" }
            }
        };

        const registry = new CollectionRegistry([pgCol, fsCol, mongoCol]);

        expect(registry.get("users")).toBeDefined();
        expect(registry.get("docs")).toBeDefined();
        expect(registry.get("logs")).toBeDefined();

        // Verify engine-specific property types are preserved
        expect(registry.get("users")!.properties.email.type).toBe("string");
        expect(registry.get("docs")!.properties.owner.type).toBe("reference");
        expect(registry.get("logs")!.properties.user.type).toBe("reference");
    });

    it("StringProperty does not carry a reference field after normalization", () => {
        const col: CollectionConfig = {
            id: "items",
            name: "Items",
            slug: "items",
            table: "items",
            properties: {
                description: {
                    type: "string",
                    multiline: true
                }
            }
        };

        const registry = new CollectionRegistry([col]);
        const result = registry.get("items");
        expect(result).toBeDefined();

        const sp = result!.properties.description as StringProperty;
        expect(sp.type).toBe("string");
        expect(sp.multiline).toBe(true);
        // StringProperty.reference was removed — verify it doesn't exist
        expect((sp as Record<string, unknown>).reference).toBeUndefined();
    });

    it("preserves raw collection data when using narrowed Postgres types", () => {
        const postsCollection: CollectionConfig = {
            id: "posts",
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                title: { type: "string" }
            }
        };

        const col: PostgresCollectionConfig = {
            id: "categories",
            name: "Categories",
            slug: "categories",
            table: "categories",
            properties: {
                name: { type: "string" },
                posts: {
                    type: "relation",
                    relation: {
                        kind: "hasMany",
                        relationName: "category_posts",
                        target: () => postsCollection,
                        foreignKeyOnTarget: "category_id"
                    }
                }
            }
        };

        const registry = new CollectionRegistry([postsCollection, col]);

        // Normalized should have resolved relation
        const normalized = registry.get("categories");
        expect((normalized!.properties.posts as RelationProperty).relation).toBeDefined();

        // Raw should NOT have resolved relation (dual-layer integrity)
        const raw = registry.getRaw("categories");
        expect(raw).toBeDefined();
        // The raw layer keeps what the author wrote; only the resolved stamp is absent.
        expect((raw!.properties.posts as RelationProperty).relation).toBeDefined();
        expect((raw!.properties.posts as RelationProperty).resolvedRelation).toBeUndefined();
    });
});
