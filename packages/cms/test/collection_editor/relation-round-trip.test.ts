import type { CollectionConfig } from "@rebasepro/types";

import {
    toSerializableCollectionConfig,
    fromSerializableCollectionConfig,
    fromSerializableCollectionConfigs
} from "../../src/collection_editor/serializable_utils";

/**
 * A relation has to survive JSON and come back callable.
 *
 * `target` is a `() => CollectionConfig` thunk, which does not serialize, so it
 * travels as a slug. Rebuilding it was the step nobody did: the deserializer
 * had no `relation` branch, so a relation fell through the pass-through default
 * and came back with `target` still a *string* — while every consumer in the
 * codebase calls `target()`. The cast to `Property` at the end of that function
 * erased the difference, so it typechecked and shipped.
 *
 * A slug also only means something relative to the other collections, so this
 * pins the set-based entry point too: deserializing one config at a time cannot
 * resolve targets, and must say so rather than hand back a broken thunk.
 */

const users: CollectionConfig = {
    slug: "users",
    name: "Users",
    table: "users",
    properties: { id: { type: "string",
isId: true } }
} as unknown as CollectionConfig;

const tags: CollectionConfig = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: { id: { type: "string",
isId: true } }
} as unknown as CollectionConfig;

const posts: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "string",
isId: true },
        author: {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo",
target: () => users,
localKey: "author_id" }
        },
        tags: {
            name: "Tags",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => tags,
                through: { table: "posts_tags",
sourceColumn: "post_id",
targetColumn: "tag_id" }
            }
        }
    }
} as unknown as CollectionConfig;

/** The `relation` block of a property on a deserialized collection. */
const linkOf = (collection: unknown, key: string) =>
    ((collection as { properties: Record<string, { relation?: Record<string, unknown> }> })
        .properties[key].relation)!;

describe("relation round-trip through JSON", () => {
    const wire = () => JSON.parse(JSON.stringify([
        toSerializableCollectionConfig(posts as never),
        toSerializableCollectionConfig(users as never),
        toSerializableCollectionConfig(tags as never)
    ]));

    it("writes the link as one nested object keyed by kind", () => {
        const [serializedPosts] = wire();
        expect(serializedPosts.properties.author.relation).toEqual({
            kind: "belongsTo",
            target: "users",
            localKey: "author_id"
        });
        // The thunk is gone — this has to be JSON.
        expect(typeof serializedPosts.properties.author.relation.target).toBe("string");
    });

    it("comes back with target callable again, resolving to the real collection", () => {
        const [restoredPosts] = fromSerializableCollectionConfigs(wire());

        const author = linkOf(restoredPosts, "author");
        expect(typeof author.target).toBe("function");
        expect((author.target as () => CollectionConfig)().slug).toBe("users");

        const tagsLink = linkOf(restoredPosts, "tags");
        expect((tagsLink.target as () => CollectionConfig)().slug).toBe("tags");
    });

    it("keeps the kind and its own fields intact across the trip", () => {
        const [restoredPosts] = fromSerializableCollectionConfigs(wire());

        expect(linkOf(restoredPosts, "author")).toMatchObject({ kind: "belongsTo",
localKey: "author_id" });
        expect(linkOf(restoredPosts, "tags")).toMatchObject({
            kind: "manyToMany",
            through: { table: "posts_tags",
sourceColumn: "post_id",
targetColumn: "tag_id" }
        });
    });

    it("resolves targets in any order, including circular references", () => {
        // `users` is deserialized after `posts`, which points at it.
        const [restoredPosts] = fromSerializableCollectionConfigs(wire());
        expect((linkOf(restoredPosts, "author").target as () => CollectionConfig)().slug).toBe("users");
    });

    it("says what is missing when a config is deserialized on its own", () => {
        const [serializedPosts] = wire();
        const alone = fromSerializableCollectionConfig(serializedPosts);
        // Not a silent string masquerading as a thunk — a thunk that explains.
        expect(() => (linkOf(alone, "author").target as () => CollectionConfig)())
            .toThrow(/targets collection "users"/);
        expect(() => (linkOf(alone, "author").target as () => CollectionConfig)())
            .toThrow(/fromSerializableCollectionConfigs/);
    });
});
