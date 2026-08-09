import { afterEach, describe, expect, it } from "@jest/globals";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";
import {
    configureUnknownFilterFields,
    DrizzleConditionBuilder,
    getUnknownFilterFieldsMode
} from "../src/utils/drizzle-conditions";

/**
 * A filter field that resolves to no column used to be logged and dropped.
 * Dropping a condition can only widen the result set, so a typo'd or renamed
 * key turned a scoped read into "everything RLS happens to allow". These tests
 * pin the fail-closed default, the `or(...)` case that widens the most, the
 * relation fallback that must keep working, and the explicit opt-out.
 */

const postsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title").notNull(),
    authorId: integer("author_id")
});

/**
 * Owning relations whose foreign key is NOT `<propertyKey>_id`: the default
 * local key comes from `generateForeignKeyName`, which snake-cases and
 * singularises, and it can be overridden outright.
 */
const accountsTable = pgTable("accounts", {
    id: serial("id").primaryKey(),
    userProfileId: integer("user_profile_id"),
    userId: integer("user_id"),
    ownerUid: integer("owner_uid")
});

const target = (slug: string) => () => ({ slug, name: slug, properties: {} } as CollectionConfig);

const accountsCollection: CollectionConfig = {
    slug: "accounts",
    name: "Accounts",
    properties: {
        // camelCase key → `user_profile_id`
        userProfile: {
            name: "User profile",
            type: "relation",
            relation: { kind: "belongsTo", target: target("user_profiles") }
        },
        // plural key → singularised `user_id`
        users: {
            name: "User",
            type: "relation",
            relation: { kind: "belongsTo", target: target("users") }
        },
        // explicit local key, derivable from nothing
        owner: {
            name: "Owner",
            type: "relation",
            relation: { kind: "belongsTo", target: target("users"), localKey: "owner_uid" }
        }
    }
};

afterEach(() => {
    configureUnknownFilterFields("error");
});

describe("unknown filter fields", () => {

    it("defaults to erroring", () => {
        expect(getUnknownFilterFieldsMode()).toBe("error");
    });

    describe("flat filters", () => {

        it("throws a client error for a field that resolves to nothing", () => {
            expect(() => DrizzleConditionBuilder.buildFilterConditions(
                { nonexistent: ["==", "x"] },
                postsTable,
                "posts"
            )).toThrow(ApiError);
        });

        it("reports a 400 naming the field, the collection and the valid fields", () => {
            let thrown: ApiError | undefined;
            try {
                DrizzleConditionBuilder.buildFilterConditions(
                    { titel: ["==", "hello"] },
                    postsTable,
                    "posts"
                );
            } catch (error) {
                thrown = error as ApiError;
            }
            expect(thrown).toBeInstanceOf(ApiError);
            expect(thrown!.statusCode).toBe(400);
            expect(thrown!.code).toBe("UNKNOWN_FILTER_FIELD");
            expect(thrown!.message).toContain("Unknown filter field 'titel' on collection 'posts'");
            expect(thrown!.message).toContain("authorId");
            expect(thrown!.details).toMatchObject({
                field: "titel",
                collection: "posts",
                validFields: ["authorId", "id", "title"]
            });
        });

        it("still compiles the fields that do resolve when none are unknown", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { title: ["==", "hello"] },
                postsTable,
                "posts"
            );
            expect(conditions).toHaveLength(1);
        });
    });

    describe("logical conditions", () => {

        it("throws for an unknown leaf nested inside an `or`", () => {
            // The dangerous one: a dropped branch of a disjunction lets the
            // surviving branches match on their own.
            expect(() => DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "or",
                    conditions: [
                        { column: "title", operator: "==", value: "hello" },
                        { column: "nonexistent", operator: "==", value: "x" }
                    ]
                },
                postsTable,
                "posts"
            )).toThrow(/Unknown filter field 'nonexistent' on collection 'posts'/);
        });

        it("throws for an unknown leaf nested two levels deep", () => {
            expect(() => DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "and",
                    conditions: [
                        { column: "title", operator: "==", value: "hello" },
                        {
                            type: "or",
                            conditions: [
                                { column: "authorId", operator: "==", value: 1 },
                                { column: "ghost", operator: "==", value: 2 }
                            ]
                        }
                    ]
                },
                postsTable,
                "posts"
            )).toThrow(ApiError);
        });

        it("compiles an `or` whose leaves all resolve", () => {
            const condition = DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "or",
                    conditions: [
                        { column: "title", operator: "==", value: "hello" },
                        { column: "authorId", operator: "==", value: 1 }
                    ]
                },
                postsTable,
                "posts"
            );
            expect(condition).not.toBeNull();
        });
    });

    describe("relation fallback", () => {

        it("resolves `author` to the `authorId` field in a flat filter", () => {
            const { PgDialect } = require("drizzle-orm/pg-core");
            const pgDialect = new PgDialect();

            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { author: ["==", 7] },
                postsTable,
                "posts"
            );
            expect(conditions).toHaveLength(1);
            const query = pgDialect.sqlToQuery(conditions[0]);
            expect(query.sql).toBe('"posts"."author_id" = $1');
            expect(query.params).toEqual([7]);
        });

        it("resolves a camelCase relation key through the collection's `localKey`", () => {
            const { PgDialect } = require("drizzle-orm/pg-core");
            const pgDialect = new PgDialect();

            // `userProfile_id` is not a field; `userProfileId` is.
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { userProfile: ["==", 3] },
                accountsTable,
                "accounts",
                { collection: accountsCollection }
            );
            expect(conditions).toHaveLength(1);
            expect(pgDialect.sqlToQuery(conditions[0]).sql).toBe('"accounts"."user_profile_id" = $1');
        });

        it("resolves a plural relation key through the singularised `localKey`", () => {
            const { PgDialect } = require("drizzle-orm/pg-core");
            const pgDialect = new PgDialect();

            // `users_id` is not a field; `userId` is.
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { users: ["==", 3] },
                accountsTable,
                "accounts",
                { collection: accountsCollection }
            );
            expect(conditions).toHaveLength(1);
            expect(pgDialect.sqlToQuery(conditions[0]).sql).toBe('"accounts"."user_id" = $1');
        });

        it("resolves an explicit `localKey` that no naming convention would guess", () => {
            const { PgDialect } = require("drizzle-orm/pg-core");
            const pgDialect = new PgDialect();

            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { owner: ["==", 3] },
                accountsTable,
                "accounts",
                { collection: accountsCollection }
            );
            expect(conditions).toHaveLength(1);
            expect(pgDialect.sqlToQuery(conditions[0]).sql).toBe('"accounts"."owner_uid" = $1');
        });

        it("still resolves the derivable keys with no collection to resolve against", () => {
            // The last-resort guesses: `<field>_id` and the singularising
            // default. Only the explicit `localKey` is beyond them.
            expect(DrizzleConditionBuilder.buildFilterConditions(
                { userProfile: ["==", 3] }, accountsTable, "accounts"
            )).toHaveLength(1);
            expect(DrizzleConditionBuilder.buildFilterConditions(
                { users: ["==", 3] }, accountsTable, "accounts"
            )).toHaveLength(1);
            expect(() => DrizzleConditionBuilder.buildFilterConditions(
                { owner: ["==", 3] }, accountsTable, "accounts"
            )).toThrow(ApiError);
        });

        it("resolves a relation `localKey` inside a logical condition too", () => {
            const condition = DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "or",
                    conditions: [
                        { column: "userProfile", operator: "==", value: 3 },
                        { column: "owner", operator: "==", value: 4 }
                    ]
                },
                accountsTable,
                "accounts",
                { collection: accountsCollection }
            );
            expect(condition).not.toBeNull();
        });

        it("resolves `author` to the `authorId` field inside a logical condition", () => {
            const condition = DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "or",
                    conditions: [
                        { column: "author", operator: "==", value: 7 }
                    ]
                },
                postsTable,
                "posts"
            );
            expect(condition).not.toBeNull();
        });
    });

    describe("the admin's null checkbox on an owning relation", () => {

        // The checkbox emits `[whichever operator is selected, null]`. With
        // `in` selected that was `["in", null]`, which fell through the
        // array-length test and returned no condition at all — a dropped
        // condition, so the read widened to every row rather than to the ones
        // with no author.

        it("compiles `in null` to IS NULL instead of dropping it", () => {
            const { PgDialect } = require("drizzle-orm/pg-core");
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { author: ["in", null] },
                postsTable,
                "posts"
            );
            expect(conditions).toHaveLength(1);
            expect(new PgDialect().sqlToQuery(conditions[0]).sql).toBe('"posts"."author_id" IS NULL');
        });

        it("compiles `not-in null` to IS NOT NULL", () => {
            const { PgDialect } = require("drizzle-orm/pg-core");
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { author: ["not-in", null] },
                postsTable,
                "posts"
            );
            expect(conditions).toHaveLength(1);
            expect(new PgDialect().sqlToQuery(conditions[0]).sql).toBe('"posts"."author_id" IS NOT NULL');
        });

        it("agrees with `== null`, which the same control emits for `==`", () => {
            const { PgDialect } = require("drizzle-orm/pg-core");
            const dialect = new PgDialect();
            const sqlFor = (op: string) => dialect.sqlToQuery(
                DrizzleConditionBuilder.buildFilterConditions({ author: [op, null] } as never, postsTable, "posts")[0]
            ).sql;
            expect(sqlFor("in")).toBe(sqlFor("=="));
            expect(sqlFor("not-in")).toBe(sqlFor("!="));
        });

        it("keeps an empty list distinct from a null value", () => {
            // Two different questions, and both now have an answer. `in null`
            // is "has no author"; `in []` is "is one of nobody", which selects
            // nothing. Neither is "no condition".
            const { PgDialect } = require("drizzle-orm/pg-core");
            const dialect = new PgDialect();
            const sqlFor = (value: unknown) => dialect.sqlToQuery(
                DrizzleConditionBuilder.buildFilterConditions(
                    { author: ["in", value] } as never, postsTable, "posts"
                )[0]
            ).sql;
            expect(sqlFor(null)).toBe('"posts"."author_id" IS NULL');
            expect(sqlFor([])).toBe("FALSE");
        });
    });

    describe("an empty membership list", () => {

        // `filter: { id: ["in", teamIds] }` with no teams is how a caller asks
        // for nothing. It answered with the whole table, because a dropped
        // condition is an absent condition. This is the same inversion
        // `UnknownFilterFieldsMode` exists for, one layer down, and unlike an
        // unknown field it needs no typo to reach — an empty array is what a
        // correct program produces when the set it derived is empty.

        const dialect = new (require("drizzle-orm/pg-core").PgDialect)();
        const render = (condition: unknown) => dialect.sqlToQuery(condition).sql;

        it("`in []` selects nothing", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { authorId: ["in", []] }, postsTable, "posts"
            );
            expect(conditions).toHaveLength(1);
            expect(render(conditions[0])).toBe("FALSE");
        });

        it("`not-in []` selects everything, which is what excluding nothing means", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { authorId: ["not-in", []] }, postsTable, "posts"
            );
            expect(conditions).toHaveLength(1);
            expect(render(conditions[0])).toBe("TRUE");
        });

        it("`array-contains-any []` overlaps nothing", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { title: ["array-contains-any", []] }, postsTable, "posts"
            );
            expect(conditions).toHaveLength(1);
            expect(render(conditions[0])).toBe("FALSE");
        });

        it("survives inside an `and`, where dropping it widened the most", () => {
            // `and(title = 'x', FALSE)` is FALSE. Drop the second and the
            // first matches on its own — every post with that title, from a
            // query that asked for none.
            const condition = DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "and",
                    conditions: [
                        { column: "title", operator: "==", value: "hello" },
                        { column: "authorId", operator: "in", value: [] }
                    ]
                },
                postsTable,
                "posts"
            );
            expect(render(condition)).toContain("FALSE");
        });

        it("reads a scalar as the one-element list rather than dropping it", () => {
            // `?filter=authorId.in.7` parses to the string `"7"` — the REST
            // dialect only builds an array for a parenthesised value — so this
            // is an ordinary query, not malformed input.
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { authorId: ["in", 7] }, postsTable, "posts"
            );
            expect(conditions).toHaveLength(1);
            const query = dialect.sqlToQuery(conditions[0]);
            expect(query.sql).toBe('"posts"."author_id" in ($1)');
            expect(query.params).toEqual([7]);
        });
    });

    describe("`warn` mode", () => {

        it("drops an unknown flat filter field instead of throwing", () => {
            configureUnknownFilterFields("warn");
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { nonexistent: ["==", "x"], title: ["==", "hello"] },
                postsTable,
                "posts"
            );
            expect(conditions).toHaveLength(1);
        });

        it("drops an unknown leaf out of an `or` instead of throwing", () => {
            configureUnknownFilterFields("warn");
            const condition = DrizzleConditionBuilder.buildLogicalConditions(
                {
                    type: "or",
                    conditions: [
                        { column: "title", operator: "==", value: "hello" },
                        { column: "nonexistent", operator: "==", value: "x" }
                    ]
                },
                postsTable,
                "posts"
            );
            // Pre-fix behaviour, preserved verbatim: the disjunction keeps only
            // the branch that compiled. `not.toBeNull()` cannot see that — it is
            // equally true of a disjunction that kept a placeholder for the
            // unknown leaf, which is the widening this whole file guards
            // against. Compiling it shows exactly one branch survived, and
            // which one: `or()` of a single condition returns that condition
            // itself, so there is no `or` left in the output at all.
            const { PgDialect } = require("drizzle-orm/pg-core");
            const query = new PgDialect().sqlToQuery(condition);
            expect(query.sql).toBe('"posts"."title" = $1');
            expect(query.params).toEqual(["hello"]);
        });

        it("honours an explicit per-call override without touching the default", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { nonexistent: ["==", "x"] },
                postsTable,
                "posts",
                { unknownFields: "warn" }
            );
            expect(conditions).toHaveLength(0);
            expect(getUnknownFilterFieldsMode()).toBe("error");
        });
    });
});
