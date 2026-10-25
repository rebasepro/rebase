import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { PersistService } from "../src/services/PersistService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A `via` is read-only on every door, the flat create/update included.
 *
 * The type (`ResolvedVia.writable: false`), the docs and the nested door
 * (`PATCH users/1/permissions/3` → `RELATION_NOT_WRITABLE`) all said so, and the
 * generated SDK leaves a `via` off `Insert`/`Update`. The flat door wrote one
 * anyway: a to-one `via` went to the join-path writer, a to-many one to
 * junction membership — so `PATCH /data/users/1 {"permissions":[3]}` rewrote
 * `user_permissions` rows, and a multi-hop chain with no junction to bind
 * answered a 500 telling the caller to regenerate their schema.
 *
 * The refusal comes before anything touches the database: the service here
 * has no database at all, so reaching one would be a different error.
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
                    { table: "user_permissions", on: { from: "id", to: "user_id" } },
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

async function refusal(write: Promise<unknown>): Promise<{ statusCode?: number; code?: string; message: string; details?: unknown }> {
    try {
        await write;
    } catch (error) {
        return error as { statusCode?: number; code?: string; message: string; details?: unknown };
    }
    throw new Error("expected the write to be refused");
}

describe("a flat write naming a via relation", () => {
    it("is refused on an update, for a to-many via", async () => {
        const error = await refusal(service().save("users", { permissions: ["t-3"] }, "u-1"));
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("RELATION_NOT_WRITABLE");
        expect(error.message).toContain("'permissions'");
        expect(error.details).toEqual({ collection: "users", fields: ["permissions"] });
    });

    it("is refused on a create, for a to-one via", async () => {
        const error = await refusal(service().save("users", { name: "Ada", badge: "b-1" }));
        expect(error.code).toBe("RELATION_NOT_WRITABLE");
        expect(error.message).toContain("'badge'");
    });

    it("is refused with null too: unlinking is a write through the chain", async () => {
        const error = await refusal(service().save("users", { badge: null }, "u-1"));
        expect(error.code).toBe("RELATION_NOT_WRITABLE");
    });

    it("lets a key whose value is undefined through, as every other undefined key is", async () => {
        // `{ badge: undefined }` is what spreading an optional field produces
        // in-process; it means "no value", not a write. The save then goes on
        // to the database this service does not have.
        const error = await refusal(service().save("users", { name: "Ada", badge: undefined }, "u-1"));
        expect(error.code).not.toBe("RELATION_NOT_WRITABLE");
    });
});
