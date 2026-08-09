import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { AnyPgColumn, integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { configureUnknownFilterFields } from "../src/utils/drizzle-conditions";

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
        userProfileId: integer("user_profile_id"),
        userId: integer("user_id"),
        createdBy: integer("created_by")
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

    /*
     * Which direction the sort actually compiles to.
     *
     * Found by mutation: swapping `asc` and `desc` in `buildDrizzleQueryOptions`
     * left the entire unit suite green. Every list in every admin panel would
     * have come back reversed — the most visible regression this file's subject
     * can produce, and the one nothing was watching. The tests above pin *which
     * column* is sorted on; nothing pinned which way.
     */
    describe("sort direction", () => {
        // `buildDrizzleQueryOptions` resolves the collection from the registry,
        // so this one needs a registry that knows `posts` — unlike the direct
        // `resolveOrderByField` calls above, which are handed the collection.
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([postsCollection]);
        const sortService = new FetchService({} as never, registry);

        const buildOrder = (order: "asc" | "desc") => {
            const opts = (sortService as unknown as {
                buildDrizzleQueryOptions(
                    table: typeof postsTable,
                    idField: AnyPgColumn,
                    idInfo: { fieldName: string; type: "string" | "number" },
                    options: Record<string, unknown>,
                    collectionPath: string
                ): { orderBy?: unknown[] }
            }).buildDrizzleQueryOptions(
                postsTable,
                postsTable.id as unknown as AnyPgColumn,
                { fieldName: "id", type: "number" },
                { orderBy: "title", order },
                "posts"
            );
            // Drizzle renders the direction as a string chunk on the SQL
            // object; the id tiebreaker is appended after, so the first
            // expression is ours. Reading the chunks rather than serialising
            // the object, which is circular (a column refers to its table).
            const first = opts.orderBy?.[0] as { queryChunks?: { value?: string[] }[] } | undefined;
            return (first?.queryChunks ?? [])
                .flatMap(chunk => chunk?.value ?? [])
                .join(" ")
                .trim();
        };

        it("compiles `asc` ascending", () => {
            expect(buildOrder("asc")).toMatch(/asc/i);
            expect(buildOrder("asc")).not.toMatch(/desc/i);
        });

        it("compiles `desc` descending", () => {
            expect(buildOrder("desc")).toMatch(/desc/i);
        });

        it("gives the two directions different SQL", () => {
            // The assertion that survives a change of Drizzle's internals: the
            // only thing that must hold is that the directions differ.
            expect(buildOrder("asc")).not.toEqual(buildOrder("desc"));
        });
    });

    it("refuses a field that names neither a column nor a relation", () => {
        /*
         * This used to resolve to `undefined`, and the caller then dropped the
         * ORDER BY: `?orderBy=titel` answered 200 with rows in whatever order
         * Postgres pleased, while the requester believed they were sorted.
         * A filter naming a field that does not exist is already refused for
         * exactly that reason, so a sort field answers the same way.
         */
        expect(() => resolve("nonexistent", postsCollection))
            .toThrow(/Unknown orderBy field 'nonexistent' on collection 'posts'/);
    });

    it("names the fields that would have worked", () => {
        // Same courtesy the filter path extends — without the list, the caller
        // is told their guess was wrong and nothing else.
        expect(() => resolve("nonexistent", postsCollection))
            .toThrow(/Valid fields: createdBy, id, title, userId, userProfileId/);
    });

    it("carries a machine-readable code, like the filter path", () => {
        try {
            resolve("nonexistent", postsCollection);
            throw new Error("expected resolveOrderByField to throw");
        } catch (err) {
            expect((err as { code?: string }).code).toBe("UNKNOWN_ORDER_BY_FIELD");
            expect((err as { statusCode?: number }).statusCode).toBe(400);
        }
    });

    describe("under the lenient switch", () => {
        // One knob for both: a deployment that wants unknown *filter* fields
        // warned rather than refused wants the same for sort fields.
        beforeEach(() => configureUnknownFilterFields("warn"));
        afterEach(() => configureUnknownFilterFields("error"));

        it("drops the sort and warns instead of throwing", () => {
            const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

            expect(resolve("nonexistent", postsCollection)).toBeUndefined();
            expect(warn.mock.calls.flat().join(" ")).toMatch(/does not exist in the table/);

            warn.mockRestore();
        });
    });
});
