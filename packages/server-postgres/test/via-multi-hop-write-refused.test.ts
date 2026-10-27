import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { PersistService } from "../src/services/PersistService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { assertWritableThrough, type NestedPathHop } from "../src/services/nested-path";
import { resolveCollectionRelations } from "@rebasepro/common";

/**
 * A multi-hop `via` is read-only; a single-hop one is written as it shipped.
 *
 * A to-many chain with no single junction between its ends used to reach
 * `bindJoinPathJunction`, inside the write's transaction, and fail as a 500
 * RELATION_MISCONFIGURED telling the caller to run `rebase schema generate` —
 * for a relation that reads fine and is configured correctly. A multi-hop
 * to-one chain re-pointed the target at the first step's column. Both are now
 * a 400 RELATION_NOT_WRITABLE, before anything is read or written: this
 * service has no database at all, so reaching one would be a different error.
 */
const tags = { slug: "tags", table: "tags", properties: { id: { type: "string", isId: true } } };
const badges = { slug: "badges", table: "badges", properties: { id: { type: "string", isId: true } } };

const users = {
    slug: "users",
    table: "users",
    properties: {
        id: { type: "string", isId: true },
        name: { type: "string" },
        permissions: {
            type: "relation",
            relation: {
                kind: "via",
                cardinality: "many",
                target: () => tags,
                joinPath: [
                    { table: "user_roles", on: { from: "id", to: "user_id" } },
                    { table: "role_tags", on: { from: "role_id", to: "role_id" } },
                    { table: "tags", on: { from: "tag_id", to: "id" } }
                ]
            }
        },
        teamBadge: {
            type: "relation",
            relation: {
                kind: "via",
                cardinality: "one",
                target: () => badges,
                joinPath: [
                    { table: "teams", on: { from: "team_id", to: "id" } },
                    { table: "badges", on: { from: "id", to: "team_id" } }
                ]
            }
        },
        tags: {
            type: "relation",
            relation: {
                kind: "via",
                cardinality: "many",
                target: () => tags,
                joinPath: [
                    { table: "users_tags", on: { from: "id", to: "user_id" } },
                    { table: "tags", on: { from: "tag_id", to: "id" } }
                ]
            }
        },
        badge: {
            type: "relation",
            relation: {
                kind: "via",
                cardinality: "one",
                target: () => badges,
                joinPath: [{ table: "badges", on: { from: "id", to: "owner_id" } }]
            }
        }
    }
} as unknown as CollectionConfig;

function service(): PersistService {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([users, tags, badges] as unknown as CollectionConfig[]);
    return new PersistService({} as never, registry);
}

type Refusal = { statusCode?: number; code?: string; message: string; details?: unknown };

async function refusal(write: Promise<unknown>): Promise<Refusal> {
    try {
        await write;
    } catch (error) {
        return error as Refusal;
    }
    throw new Error("expected the write to fail");
}

describe("a create or update naming a via relation", () => {
    it("refuses a multi-hop to-many via with 400 RELATION_NOT_WRITABLE, not a 500", async () => {
        const error = await refusal(service().save("users", { permissions: ["t-3"] }, "u-1"));
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("RELATION_NOT_WRITABLE");
        expect(error.message).toContain("'permissions'");
        expect(error.message).toContain("single-hop");
        expect(error.details).toEqual({ collection: "users", fields: ["permissions"] });
    });

    it("refuses a multi-hop to-one via, on a create too, and with null", async () => {
        expect((await refusal(service().save("users", { name: "Ada", teamBadge: "b-1" }))).code)
            .toBe("RELATION_NOT_WRITABLE");
        expect((await refusal(service().save("users", { teamBadge: null }, "u-1"))).code)
            .toBe("RELATION_NOT_WRITABLE");
    });

    it("lets a single-hop via through, to-one and to-many, as it shipped", async () => {
        // Past this gate the save goes on to the database this service lacks.
        expect((await refusal(service().save("users", { badge: "b-1" }, "u-1"))).code)
            .not.toBe("RELATION_NOT_WRITABLE");
        expect((await refusal(service().save("users", { tags: ["t-1"] }, "u-1"))).code)
            .not.toBe("RELATION_NOT_WRITABLE");
    });

    it("lets an undefined value through, as every other undefined key is", async () => {
        expect((await refusal(service().save("users", { permissions: undefined }, "u-1"))).code)
            .not.toBe("RELATION_NOT_WRITABLE");
    });
});

describe("a nested write through a via relation", () => {
    it("is refused even for a single-hop one: the nested door does not link through a chain", () => {
        const relation = resolveCollectionRelations(users).tags;
        const hop = {
            parentCollection: users, parentId: "u-1", relationKey: "tags", relation, targetCollection: tags
        } as unknown as NestedPathHop;
        expect(() => assertWritableThrough(hop, "users/u-1/tags")).toThrow(expect.objectContaining({ code: "RELATION_NOT_WRITABLE" }));
    });
});
