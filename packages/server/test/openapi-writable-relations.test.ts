/**
 * The create body names every relation the server writes — the same set the
 * generated SDK's `Insert` types, kind for kind.
 *
 * It offered `belongsTo` only, on the claim that "a to-many is not writable
 * through the body". The server writes a `hasMany` or `manyToMany` membership,
 * a `hasOne`, and a single-hop `via` through a create or update, and the SDK
 * types all of them; a client generated from the document could set none.
 * A multi-hop `via` is refused (RELATION_NOT_WRITABLE) and stays out.
 */
import { buildCollectionInputSchema } from "../src/api/openapi-generator";
import { CollectionConfig } from "../../types/src/types/collections";

const profiles = { slug: "profiles", table: "profiles", properties: { id: { type: "number", isId: "increment" } } };
const tags = { slug: "tags", table: "tags", properties: { id: { type: "string", isId: "uuid" } } };
const authors = { slug: "authors", table: "authors", properties: { id: { type: "number", isId: "increment" } } };

const posts = {
    slug: "posts", name: "Posts", table: "posts",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string", validation: { required: true } },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } },
        profile: { type: "relation", relation: { kind: "hasOne", target: () => profiles, foreignKeyOnTarget: "post_id" } },
        comments: { type: "relation", relation: { kind: "hasMany", target: () => profiles, foreignKeyOnTarget: "post_id" } },
        tags: {
            type: "relation",
            relation: {
                kind: "manyToMany", target: () => tags,
                through: { properties: { position: { type: "number" } } }
            }
        },
        badge: {
            type: "relation",
            relation: {
                kind: "via", cardinality: "one", target: () => profiles,
                joinPath: [{ table: "profiles", on: { from: "id", to: "badge_post_id" } }]
            }
        },
        tagsVia: {
            type: "relation",
            relation: {
                kind: "via", cardinality: "many", target: () => tags,
                joinPath: [
                    { table: "posts_labels", on: { from: "id", to: "post_id" } },
                    { table: "tags", on: { from: "tag_id", to: "id" } }
                ]
            }
        },
        roleTags: {
            type: "relation",
            relation: {
                kind: "via", cardinality: "many", target: () => tags,
                joinPath: [
                    { table: "post_roles", on: { from: "id", to: "post_id" } },
                    { table: "roles_tags", on: { from: "role_id", to: "role_id" } },
                    { table: "tags", on: { from: "tag_id", to: "id" } }
                ]
            }
        }
    }
} as unknown as CollectionConfig;

describe("the OpenAPI create body's relations", () => {
    const schema = buildCollectionInputSchema(posts) as { required?: string[]; properties: Record<string, Record<string, unknown>> };

    it("still offers both spellings of a belongsTo", () => {
        expect(schema.properties.authorId).toMatchObject({ type: "integer" });
        expect(schema.properties.author).toMatchObject({ type: "integer" });
    });

    it("offers a hasOne and a single-hop to-one via as the target's id, nullable", () => {
        expect(schema.properties.profile).toMatchObject({ type: "integer", nullable: true });
        expect(schema.properties.badge).toMatchObject({ type: "integer", nullable: true });
    });

    it("offers a to-many membership as a list of ids or { id } objects", () => {
        const items = (schema.properties.comments as { items: { oneOf: unknown[] } }).items.oneOf;
        expect(schema.properties.comments).toMatchObject({ type: "array" });
        expect(items).toEqual([
            { type: "integer" },
            { type: "object", required: ["id"], properties: { id: { type: "integer" } } }
        ]);
        expect(schema.properties.tagsVia).toMatchObject({ type: "array" });
    });

    it("carries a manyToMany's junction payload as `_pivot`", () => {
        const items = (schema.properties.tags as { items: { oneOf: Array<{ properties?: Record<string, unknown> }> } }).items.oneOf;
        expect(items[1].properties?._pivot).toMatchObject({ type: "object", properties: { position: { type: "number" } } });
    });

    it("leaves a multi-hop via out, and requires none of them", () => {
        expect(schema.properties).not.toHaveProperty("roleTags");
        expect(schema.required).toEqual(["title"]);
    });
});
