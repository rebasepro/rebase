import { CollectionConfig } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";

/**
 * The nested-collection routes in the spec are derived from the *resolved*
 * relations, which is what the nested-path router matches against.
 *
 * They used to be derived by reading `collection.relations[].relationName`
 * straight off the authored config. That name is optional — it defaults to the
 * property key, or to the target's slug — so the generator dropped every
 * relation that relied on the default, and it never saw relations declared
 * inline on a property at all, because those are not in the array. A collection
 * could carry three documented subcollections in the admin panel and none in
 * the spec.
 */
describe("OpenAPI subcollection routes", () => {
    const tags: CollectionConfig = {
        slug: "tags",
        name: "Tags",
        singularName: "Tag",
        table: "tags",
        properties: { id: { type: "string",
isId: true },
name: { type: "string" } }
    } as unknown as CollectionConfig;

    const comments: CollectionConfig = {
        slug: "comments",
        name: "Comments",
        singularName: "Comment",
        table: "comments",
        properties: { id: { type: "string",
isId: true },
body: { type: "string" } }
    } as unknown as CollectionConfig;

    const users: CollectionConfig = {
        slug: "users",
        name: "Users",
        singularName: "User",
        table: "users",
        properties: { id: { type: "string",
isId: true } }
    } as unknown as CollectionConfig;

    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        singularName: "Post",
        table: "posts",
        properties: {
            id: { type: "string",
isId: true },
            // Inline, no relationName — addressed by the property key.
            tags: { name: "Tags",
type: "relation",
relation: { kind: "manyToMany",
target: () => tags } },
            // To-one: reachable, but not a listing.
            author: { name: "Author",
type: "relation",
relation: { kind: "belongsTo",
target: () => users } }
        },
        // Explicit array entry, no relationName — defaults to the target's slug.
        relations: [{ kind: "hasMany",
target: () => comments,
foreignKeyOnTarget: "post_id" }]
    } as unknown as CollectionConfig;

    const nestedPaths = () => {
        const spec = generateOpenApiSpec([posts, tags, comments, users]);
        return Object.keys(spec.paths as Record<string, unknown>)
            .filter(p => p.includes("{parentId}"))
            .sort();
    };

    it("documents to-many relations that never spelled out a name", () => {
        expect(nestedPaths()).toEqual([
            "/data/posts/{parentId}/comments",
            "/data/posts/{parentId}/tags"
        ]);
    });

    it("leaves to-one relations out — they address a row, not a page", () => {
        expect(nestedPaths()).not.toContain("/data/posts/{parentId}/author");
    });

    it("responds with the target's schema, not the parent's", () => {
        const spec = generateOpenApiSpec([posts, tags, comments, users]) as Record<string, any>;
        const items = spec.paths["/data/posts/{parentId}/comments"]
            .get.responses[200].content["application/json"].schema.properties.data.items;
        expect(items).toEqual({ $ref: "#/components/schemas/Comment" });
    });
});
