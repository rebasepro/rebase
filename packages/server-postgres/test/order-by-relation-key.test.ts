import { describe, expect, it } from "@jest/globals";
import { AnyPgColumn, integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * Sorting by an owning relation sorts by the foreign key it compiles to, and
 * that key is the relation's `localKey` — not `<field>_id`.
 *
 * The default local key is `generateForeignKeyName`, which snake-cases *and
 * singularises*, so `userProfile` is `user_profile_id` and `users` is
 * `user_id`; an author can also name the column outright. A guess that misses
 * resolves to no column at all, and the caller then drops the `ORDER BY`
 * rather than failing: the rows come back in an arbitrary order, and paging
 * over an unordered result repeats and skips rows.
 */
describe("orderBy on an owning relation resolves through localKey", () => {
    const postsTable = pgTable("posts", {
        id: serial("id").primaryKey(),
        title: varchar("title").notNull(),
        user_profile_id: integer("user_profile_id"),
        user_id: integer("user_id"),
        created_by: integer("created_by")
    });

    const profilesCollection = { slug: "user_profiles", name: "Profiles", table: "user_profiles" } as unknown as CollectionConfig;
    const usersCollection = { slug: "users", name: "Users", table: "users" } as unknown as CollectionConfig;

    const postsCollection: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        idField: "id",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" },
            // camelCase: the default key snake-cases as well as singularises.
            userProfile: { type: "relation", relationName: "userProfile" },
            // Plural key: the default key singularises it.
            users: { type: "relation", relationName: "users" },
            // Named outright — nothing about the key predicts the column.
            owner: { type: "relation", relationName: "owner" }
        },
        relations: [
            { kind: "belongsTo", relationName: "userProfile", target: () => profilesCollection },
            { kind: "belongsTo", relationName: "users", target: () => usersCollection },
            { kind: "belongsTo", relationName: "owner", target: () => usersCollection, localKey: "created_by" }
        ]
    } as unknown as CollectionConfig;

    const service = new FetchService({} as never, new PostgresCollectionRegistry());
    const resolve = (orderBy: string, collection?: CollectionConfig): AnyPgColumn | undefined =>
        (service as unknown as {
            resolveOrderByField(
                table: typeof postsTable,
                orderBy: string,
                collection?: CollectionConfig
            ): AnyPgColumn | undefined
        }).resolveOrderByField(postsTable, orderBy, collection);

    it("sorts a camelCase relation key by its snake-cased foreign key", () => {
        // Not `userProfile_id`, which is no column at all.
        expect(resolve("userProfile", postsCollection)?.name).toBe("user_profile_id");
    });

    it("sorts a plural relation key by its singularised foreign key", () => {
        // Not `users_id`.
        expect(resolve("users", postsCollection)?.name).toBe("user_id");
    });

    it("honours a localKey the relation names outright", () => {
        expect(resolve("owner", postsCollection)?.name).toBe("created_by");
    });

    it("still resolves a plain column directly", () => {
        expect(resolve("title", postsCollection)?.name).toBe("title");
    });

    it("falls back to the default key shapes with no collection in hand", () => {
        expect(resolve("user_profile")?.name).toBe("user_profile_id");
        expect(resolve("users")?.name).toBe("user_id");
    });

    it("resolves nothing for a field that names neither a column nor a relation", () => {
        expect(resolve("nonexistent", postsCollection)).toBeUndefined();
    });
});
