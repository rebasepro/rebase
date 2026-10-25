import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { resolveCollectionRelations } from "../src";

/**
 * Which `via` chains Rebase writes: the ones with a single link to set.
 *
 * - a to-one chain of one step — the target row holds the key, so the write
 *   points it at this row, as a `hasOne` does;
 * - a to-many chain of two steps through one table between the ends — that
 *   table holds the links, written as junction rows, as a `manyToMany` is.
 *
 * Both shipped as writable through a create or update (the 0.24.0 one-to-one
 * fix). Anything longer has no single link to maintain: a to-many chain found
 * no junction and failed as a 500, and a to-one chain re-pointed the target at
 * whatever the first step happened to read. `writable` is the one place that
 * says which, and every door reads it.
 */
const tags = { slug: "tags", table: "tags", properties: { id: { type: "string", isId: true } } };
const badges = { slug: "badges", table: "badges", properties: { id: { type: "string", isId: true } } };

function via(name: string, cardinality: "one" | "many", target: unknown, joinPath: unknown[]) {
    return { type: "relation", relation: { kind: "via", relationName: name, cardinality, target: () => target, joinPath } };
}

const users = {
    slug: "users",
    table: "users",
    properties: {
        id: { type: "string", isId: true },
        badge: via("badge", "one", badges, [{ table: "badges", on: { from: "id", to: "owner_id" } }]),
        teamBadge: via("teamBadge", "one", badges, [
            { table: "teams", on: { from: "team_id", to: "id" } },
            { table: "badges", on: { from: "id", to: "team_id" } }
        ]),
        tags: via("tags", "many", tags, [
            { table: "users_tags", on: { from: "id", to: "user_id" } },
            { table: "tags", on: { from: "tag_id", to: "id" } }
        ]),
        roleTags: via("roleTags", "many", tags, [
            { table: "user_roles", on: { from: "id", to: "user_id" } },
            { table: "roles_tags", on: { from: "role_id", to: "role_id" } },
            { table: "tags", on: { from: "tag_id", to: "id" } }
        ]),
        ownedTags: via("ownedTags", "many", tags, [{ table: "tags", on: { from: "id", to: "owner_id" } }])
    }
} as unknown as CollectionConfig;

describe("a via relation's writable flag", () => {
    const relations = resolveCollectionRelations(users);

    it("is true for a one-step to-one chain: the target holds the key", () => {
        expect(relations.badge.writable).toBe(true);
    });

    it("is true for a to-many chain through one junction table", () => {
        expect(relations.tags.writable).toBe(true);
    });

    it("is false for a multi-hop to-one chain", () => {
        expect(relations.teamBadge.writable).toBe(false);
    });

    it("is false for a multi-hop to-many chain", () => {
        expect(relations.roleTags.writable).toBe(false);
    });

    it("is false for a to-many chain with no table between the ends to hold the links", () => {
        expect(relations.ownedTags.writable).toBe(false);
    });
});
