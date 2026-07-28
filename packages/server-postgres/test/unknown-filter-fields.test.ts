import { afterEach, describe, expect, it } from "@jest/globals";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
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
    author_id: integer("author_id")
});

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
            expect(thrown!.message).toContain("author_id");
            expect(thrown!.details).toMatchObject({
                field: "titel",
                collection: "posts",
                validFields: ["author_id", "id", "title"]
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
                                { column: "author_id", operator: "==", value: 1 },
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
                        { column: "author_id", operator: "==", value: 1 }
                    ]
                },
                postsTable,
                "posts"
            );
            expect(condition).not.toBeNull();
        });
    });

    describe("relation fallback", () => {

        it("resolves `author` to the `author_id` column in a flat filter", () => {
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

        it("resolves `author` to the `author_id` column inside a logical condition", () => {
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
            // the branch that compiled.
            expect(condition).not.toBeNull();
        });

        it("honours an explicit per-call override without touching the default", () => {
            const conditions = DrizzleConditionBuilder.buildFilterConditions(
                { nonexistent: ["==", "x"] },
                postsTable,
                "posts",
                "warn"
            );
            expect(conditions).toHaveLength(0);
            expect(getUnknownFilterFieldsMode()).toBe("error");
        });
    });
});
