import {
    SnapshotCollection,
    PostgresCollection,
    FirebaseCollection,
    MongoDBCollection,
    ReferenceProperty,
    RelationProperty,
    StringProperty
} from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";

describe("CollectionRegistry — engine-specific property gates", () => {

    it("registers and retrieves a Postgres collection with relation properties", () => {
        const postsCollection: SnapshotCollection = {
            id: "posts",
            name: "Posts",
            path: "posts",
            table: "posts",
            properties: {
                title: { type: "string" }
            }
        };

        const authorsCollection: PostgresCollection = {
            id: "authors",
            name: "Authors",
            slug: "authors",
            table: "authors",
            properties: {
                name: { type: "string" },
                posts: {
                    type: "relation",
                    collectionPath: "posts",
                    relationName: "author_posts_link"
                }
            },
            relations: [{
                relationName: "author_posts_link",
                collection: postsCollection
            }]
        };

        const registry = new CollectionRegistry([postsCollection, authorsCollection]);

        const result = registry.get("authors");
        expect(result).toBeDefined();
        expect(result!.properties.name.type).toBe("string");
        expect(result!.properties.posts.type).toBe("relation");

        // Normalization should inject the resolved relation
        const relProp = result!.properties.posts as RelationProperty;
        expect(relProp.relation).toBeDefined();
        expect(relProp.relation!.collection!.name).toBe("Posts");
    });

    it("registers and retrieves a Firestore collection with reference properties", () => {
        const fsCollection: FirebaseCollection = {
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
        const mongoCollection: MongoDBCollection = {
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
        const pgCol: PostgresCollection = {
            id: "users",
            name: "Users",
            slug: "users",
            table: "users",
            properties: {
                email: { type: "string", email: true }
            }
        };

        const fsCol: FirebaseCollection = {
            id: "docs",
            name: "Docs",
            slug: "docs",
            driver: "firestore",
            properties: {
                content: { type: "string" },
                owner: { type: "reference", path: "users" }
            }
        };

        const mongoCol: MongoDBCollection = {
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
        const col: SnapshotCollection = {
            id: "items",
            name: "Items",
            path: "items",
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
        const postsCollection: SnapshotCollection = {
            id: "posts",
            name: "Posts",
            path: "posts",
            table: "posts",
            properties: {
                title: { type: "string" }
            }
        };

        const col: PostgresCollection = {
            id: "categories",
            name: "Categories",
            slug: "categories",
            table: "categories",
            properties: {
                name: { type: "string" },
                posts: {
                    type: "relation",
                    collectionPath: "posts",
                    relationName: "category_posts"
                }
            },
            relations: [{
                relationName: "category_posts",
                collection: postsCollection
            }]
        };

        const registry = new CollectionRegistry([postsCollection, col]);

        // Normalized should have resolved relation
        const normalized = registry.get("categories");
        expect((normalized!.properties.posts as RelationProperty).relation).toBeDefined();

        // Raw should NOT have resolved relation (dual-layer integrity)
        const raw = registry.getRaw("categories");
        expect(raw).toBeDefined();
        expect((raw!.properties.posts as RelationProperty).relation).toBeUndefined();
    });
});
