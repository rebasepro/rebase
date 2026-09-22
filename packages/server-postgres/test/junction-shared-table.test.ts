/**
 * Two many-to-many relations that resolve to one junction table must agree on
 * its key columns.
 *
 * A default `through` is named after the two tables, so `posts.tags` and
 * `posts.featuredTags` both land on `posts_tags` — one with `tag_id`, the other
 * with `featured_tag_id`. Only one table is created, from the first relation, so
 * `featured_tag_id` never existed and every read or write of `featuredTags`
 * failed against a column that is not there. The two sides of one link
 * (`posts.tags` and `tags.posts`) are the legitimate way to share a junction,
 * and they name the same two columns.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import { planCollectionSchemaEnsure } from "../src/schema/ensure-collection-tables";

const tags: CollectionConfig = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
};

const toTags = { kind: "manyToMany", target: () => tags } as const;

describe("a junction table two relations resolve to", () => {
    it("is refused when they name different key columns, naming both relations", () => {
        const posts: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                tags: { name: "Tags", type: "relation", relation: toTags },
                featuredTags: { name: "Featured tags", type: "relation", relation: toTags }
            }
        };
        const refusal = /"posts_tags"[\s\S]*"tags"[\s\S]*"featuredTags"[\s\S]*featured_tag_id/;
        expect(() => planSchema([posts, tags])).toThrow(refusal);
        // Boot plans through the same function, so it refuses the same way.
        expect(() => planCollectionSchemaEnsure([posts, tags], {
            tables: new Map(), enums: new Set(), constraints: new Set()
        })).toThrow(refusal);
    });

    it("is refused for a self-referencing pair too", () => {
        const people: CollectionConfig = {
            slug: "people",
            table: "people",
            name: "People",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                friends: { name: "Friends", type: "relation", relation: { kind: "manyToMany", target: () => people } },
                followers: { name: "Followers", type: "relation", relation: { kind: "manyToMany", target: () => people } }
            }
        };
        expect(() => planSchema([people])).toThrow(/"people_people"/);
    });

    it("is shared by the two sides of one link", () => {
        const posts: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                tags: { name: "Tags", type: "relation", relation: toTags }
            }
        };
        const taggedTags: CollectionConfig = {
            ...tags,
            properties: {
                ...tags.properties,
                posts: { name: "Posts", type: "relation", relation: { kind: "manyToMany", target: () => posts } }
            }
        };
        const plan = planSchema([posts, taggedTags]);
        const junction = plan.tables.find(t => t.table === "posts_tags");
        expect(junction?.columns.map(c => c.column)).toEqual(["post_id", "tag_id"]);
    });

    it("is not shared once the second relation names its own", () => {
        const posts: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                tags: { name: "Tags", type: "relation", relation: toTags },
                featuredTags: {
                    name: "Featured tags",
                    type: "relation",
                    relation: { ...toTags, through: { table: "posts_featured_tags" } }
                }
            }
        };
        const plan = planSchema([posts, tags]);
        const columnsOf = (table: string): string[] | undefined =>
            plan.tables.find(t => t.table === table)?.columns.map(c => c.column);
        expect(columnsOf("posts_tags")).toEqual(["post_id", "tag_id"]);
        expect(columnsOf("posts_featured_tags")).toEqual(["post_id", "featured_tag_id"]);
    });
});
