import { describe, expect, it } from "@jest/globals";
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { getCopyValues } from "../src/util/copy";

/**
 * What the form's "Duplicate" seeds a create with. A create writes every
 * relation it carries, and for a link whose key lives on the other row —
 * a `hasMany`'s children, a `hasOne`'s profile, a `via` — writing it means
 * pointing those rows at the copy: duplicating an author used to move all of
 * their posts to the copy. The Docker e2e `duplicate-record-e2e` (server-postgres)
 * proves the save with this rule leaves every existing row alone.
 */

const target = (slug: string): PostgresCollectionConfig => ({
    name: slug, slug, table: slug,
    properties: { id: { name: "ID", type: "string", isId: true } }
});

const authors: PostgresCollectionConfig = {
    name: "authors", slug: "authors", table: "authors",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        name: { type: "string" },
        editor: { type: "relation", relation: { kind: "belongsTo", target: () => target("editors"), localKey: "editor_id" } },
        posts: { type: "relation", relation: { kind: "hasMany", target: () => target("posts"), foreignKeyOnTarget: "author_id" } },
        profile: { type: "relation", relation: { kind: "hasOne", target: () => target("profiles"), foreignKeyOnTarget: "author_id" } },
        tags: {
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => target("tags"),
                through: { table: "authors_tags", sourceColumn: "author_id", targetColumn: "tag_id" }
            }
        },
        badge: {
            type: "relation",
            relation: {
                kind: "via",
                target: () => target("badges"),
                cardinality: "one",
                joinPath: [{ table: "badges", on: { from: "authors.id", to: "badges.owner_id" } }]
            }
        }
    }
};

describe("getCopyValues", () => {
    it("drops the key and every link whose key is on the other row; keeps the rest", () => {
        const original = {
            id: "a-1",
            name: "Ada",
            editor: { id: "e-1" },
            posts: [{ id: "p-1" }],
            profile: { id: "pr-1" },
            tags: [{ id: "t-1" }],
            badge: { id: "b-1" }
        };
        expect(getCopyValues(authors, original)).toEqual({ name: "Ada", editor: { id: "e-1" }, tags: [{ id: "t-1" }] });
    });

});
