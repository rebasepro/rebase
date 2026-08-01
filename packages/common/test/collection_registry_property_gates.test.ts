import {
    CollectionConfig,
    PostgresCollectionConfig,
    FirebaseCollectionConfig,
    MongoDBCollectionConfig,
    ReferenceProperty,
    RelationProperty,
    StringProperty,
    getDataSourceCapabilities
} from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";

/**
 * These fixtures used to declare the engine as `driver: "firestore"` /
 * `driver: "mongodb"`. There is no `driver` field — the discriminant is
 * `engine` — so every one of them resolved to the default Postgres engine and
 * no engine gate was ever crossed. The file was not in `tsconfig.tests.json`,
 * so nothing caught it. Each test now asserts the resolved engine and its
 * capabilities, which is what the names claim to be about.
 */
describe("CollectionRegistry — engine-specific property gates", () => {

    it("registers and retrieves a Postgres collection with relation properties", () => {
        const postsCollection: CollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                title: { name: "Title",
type: "string" }
            }
        };

        const authorsCollection: PostgresCollectionConfig = {
            name: "Authors",
            slug: "authors",
            table: "authors",
            properties: {
                name: { name: "Name",
type: "string" },
                posts: {
                    name: "Posts",
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
        expect(result!.engine).toBe("postgres");
        expect(getDataSourceCapabilities(result!.engine).supportsRelations).toBe(true);
        expect(result!.properties.name.type).toBe("string");
        expect(result!.properties.posts.type).toBe("relation");

        // Normalization should inject the resolved relation
        const relProp = result!.properties.posts as RelationProperty;
        expect(relProp.resolvedRelation).toBeDefined();
        expect(relProp.resolvedRelation!.targetSlug).toBe("posts");
    });

    it("registers and retrieves a Firestore collection with reference properties", () => {
        const fsCollection: FirebaseCollectionConfig = {
            name: "Articles",
            slug: "articles",
            engine: "firestore",
            properties: {
                title: { name: "Title",
type: "string" },
                author: {
                    name: "Author",
                    type: "reference",
                    path: "users"
                }
            }
        };

        const registry = new CollectionRegistry([fsCollection]);

        const result = registry.get("articles");
        expect(result).toBeDefined();
        expect(result!.engine).toBe("firestore");
        const capabilities = getDataSourceCapabilities(result!.engine);
        expect(capabilities.supportsReferences).toBe(true);
        expect(capabilities.supportsRelations).toBe(false);
        expect(result!.properties.title.type).toBe("string");
        expect(result!.properties.author.type).toBe("reference");
        const refProp = result!.properties.author as ReferenceProperty;
        expect(refProp.path).toBe("users");
    });

    it("registers and retrieves a MongoDB collection with reference properties", () => {
        const mongoCollection: MongoDBCollectionConfig = {
            name: "Comments",
            slug: "comments",
            engine: "mongodb",
            properties: {
                body: { name: "Body",
type: "string" },
                post: {
                    name: "Post",
                    type: "reference",
                    path: "posts"
                }
            }
        };

        const registry = new CollectionRegistry([mongoCollection]);

        const result = registry.get("comments");
        expect(result).toBeDefined();
        expect(result!.engine).toBe("mongodb");
        const capabilities = getDataSourceCapabilities(result!.engine);
        expect(capabilities.supportsReferences).toBe(true);
        expect(capabilities.supportsRelations).toBe(false);
        expect(result!.properties.body.type).toBe("string");
        expect(result!.properties.post.type).toBe("reference");
        const refProp = result!.properties.post as ReferenceProperty;
        expect(refProp.path).toBe("posts");
    });

    it("handles a mixed-engine registry with Postgres, Firestore, and MongoDB collections", () => {
        const pgCol: PostgresCollectionConfig = {
            name: "Users",
            slug: "users",
            table: "users",
            properties: {
                email: { name: "Email",
type: "string",
email: true }
            }
        };

        const fsCol: FirebaseCollectionConfig = {
            name: "Docs",
            slug: "docs",
            engine: "firestore",
            properties: {
                content: { name: "Content",
type: "string" },
                owner: { name: "Owner",
type: "reference",
path: "users" }
            }
        };

        const mongoCol: MongoDBCollectionConfig = {
            name: "Logs",
            slug: "logs",
            engine: "mongodb",
            properties: {
                message: { name: "Message",
type: "string" },
                user: { name: "User",
type: "reference",
path: "users" }
            }
        };

        const registry = new CollectionRegistry([pgCol, fsCol, mongoCol]);

        // Each collection keeps its own engine — registering them together does
        // not flatten them all onto the default.
        expect(registry.get("users")!.engine).toBe("postgres");
        expect(registry.get("docs")!.engine).toBe("firestore");
        expect(registry.get("logs")!.engine).toBe("mongodb");

        // Verify engine-specific property types are preserved
        expect(registry.get("users")!.properties.email.type).toBe("string");
        expect(registry.get("docs")!.properties.owner.type).toBe("reference");
        expect(registry.get("logs")!.properties.user.type).toBe("reference");
    });

    it("StringProperty does not carry a reference field", () => {
        // A runtime `toBeUndefined()` on a field the fixture never sets cannot
        // fail. `reference` was removed from `StringProperty` at the type level,
        // so assert it at the type level: if the field ever comes back, the
        // `@ts-expect-error` goes unused and tsc reports it.
        const description = {
            name: "Description",
            type: "string",
            // @ts-expect-error `reference` is not a StringProperty field — a
            // reference is its own property type.
            reference: "users"
        } satisfies StringProperty;

        const col: CollectionConfig = {
            name: "Items",
            slug: "items",
            table: "items",
            properties: {
                description: { name: "Description",
type: "string",
columnType: "text" }
            }
        };

        const registry = new CollectionRegistry([col]);
        const result = registry.get("items");
        expect(result).toBeDefined();

        const sp = result!.properties.description as StringProperty;
        expect(sp.type).toBe("string");
        expect(sp.columnType).toBe("text");
        expect(description.name).toBe("Description");
    });

    it("preserves raw collection data when using narrowed Postgres types", () => {
        const postsCollection: CollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: {
                title: { name: "Title",
type: "string" }
            }
        };

        const col: PostgresCollectionConfig = {
            name: "Categories",
            slug: "categories",
            table: "categories",
            properties: {
                name: { name: "Name",
type: "string" },
                posts: {
                    name: "Posts",
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
        // ...and so is the engine stamp.
        expect(normalized!.engine).toBe("postgres");
        expect(raw!.engine).toBeUndefined();
    });
});
