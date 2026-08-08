/**
 * MongoConditionBuilder Tests
 *
 * Tests for the condition builder that translates Rebase filters to MongoDB queries.
 */

import { MongoConditionBuilder } from "../src/db/MongoConditionBuilder";
import { CollectionConfig, FilterValues } from "@rebasepro/types";

describe("MongoConditionBuilder", () => {
    describe("buildFilterConditions", () => {
        it("should return empty array for undefined filter", () => {
            const result = MongoConditionBuilder.buildFilterConditions(undefined as unknown as FilterValues<string>);
            expect(result).toEqual([]);
        });

        it("should handle equality operator", () => {
            const filter: FilterValues<string> = {
                status: ["==", "active"]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ status: { $eq: "active" } }]);
        });

        it("should handle less than operator", () => {
            const filter: FilterValues<string> = {
                age: ["<", 30]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ age: { $lt: 30 } }]);
        });

        it("should handle less than or equal operator", () => {
            const filter: FilterValues<string> = {
                age: ["<=", 30]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ age: { $lte: 30 } }]);
        });

        it("should handle greater than operator", () => {
            const filter: FilterValues<string> = {
                age: [">", 18]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ age: { $gt: 18 } }]);
        });

        it("should handle greater than or equal operator", () => {
            const filter: FilterValues<string> = {
                age: [">=", 21]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ age: { $gte: 21 } }]);
        });

        it("should handle not equal operator", () => {
            const filter: FilterValues<string> = {
                status: ["!=", "deleted"]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ status: { $ne: "deleted" } }]);
        });

        it("should handle in operator", () => {
            const filter: FilterValues<string> = {
                status: ["in", ["active", "pending"]]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ status: { $in: ["active", "pending"] } }]);
        });

        it("should handle not-in operator", () => {
            const filter: FilterValues<string> = {
                status: ["not-in", ["deleted", "archived"]]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ status: { $nin: ["deleted", "archived"] } }]);
        });

        it("should handle array-contains operator", () => {
            const filter: FilterValues<string> = {
                tags: ["array-contains", "featured"]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ tags: { $elemMatch: { $eq: "featured" } } }]);
        });

        it("should handle array-contains-any operator", () => {
            const filter: FilterValues<string> = {
                tags: ["array-contains-any", ["featured", "popular"]]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toEqual([{ tags: { $in: ["featured", "popular"] } }]);
        });

        it("should handle multiple filters", () => {
            const filter: FilterValues<string> = {
                status: ["==", "active"],
                priority: [">=", 5]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toHaveLength(2);
            expect(result).toContainEqual({ status: { $eq: "active" } });
            expect(result).toContainEqual({ priority: { $gte: 5 } });
        });

        /**
         * `FilterValues` declares two shapes per field — one tuple, or an array
         * of them — and the fluent builder produces the second from two
         * `.where()` calls on the same column. This compiler destructured the
         * param directly, so `op` bound to the tuple `[">=", 18]`, no operator
         * matched, and BOTH conditions were dropped: an age-range read answered
         * 200 with every user in the collection.
         */
        it("compiles an array of tuples on one field into every condition", () => {
            const filter: FilterValues<string> = {
                age: [[">=", 18], ["<", 65]]
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toHaveLength(2);
            expect(result).toContainEqual({ age: { $gte: 18 } });
            expect(result).toContainEqual({ age: { $lt: 65 } });
        });

        it("still reads a single tuple as one condition", () => {
            const result = MongoConditionBuilder.buildFilterConditions({
                status: ["==", "active"]
            });
            expect(result).toEqual([{ status: { $eq: "active" } }]);
        });

        /**
         * A filter that cannot be compiled must not compile to "no filter".
         * This logged a warning and returned `undefined`, which the caller read
         * as "nothing to add" — the read ran unfiltered behind a 200.
         */
        it("refuses an operator it cannot compile instead of dropping the condition", () => {
            expect(() => MongoConditionBuilder.buildFilterConditions({
                status: ["≈" as never, "active"]
            })).toThrow(/not supported/);
        });

        it("should skip null filter params", () => {
            const filter: FilterValues<string> = {
                status: ["==", "active"],
                empty: undefined
            };
            const result = MongoConditionBuilder.buildFilterConditions(filter);
            expect(result).toHaveLength(1);
        });

        it("should handle is-null operator", () => {
            const result = MongoConditionBuilder.buildFilterConditions({
                deleted_at: ["is-null", null]
            });
            expect(result).toEqual([{ deleted_at: { $eq: null } }]);
        });

        it("should handle is-not-null operator", () => {
            const result = MongoConditionBuilder.buildFilterConditions({
                published_at: ["is-not-null", null]
            });
            expect(result).toEqual([{ published_at: { $ne: null } }]);
        });

        it("should translate ilike to a case-insensitive anchored regex", () => {
            const [cond] = MongoConditionBuilder.buildFilterConditions({
                name: ["ilike", "%john%"]
            });
            const regex = (cond as { name: { $regex: RegExp } }).name.$regex;
            expect(regex).toBeInstanceOf(RegExp);
            expect(regex.source).toBe("^.*john.*$");
            expect(regex.flags).toBe("i");
            expect(regex.test("Big JOHNny")).toBe(true);
        });

        it("should translate like to a case-sensitive anchored regex with _ wildcard", () => {
            const [cond] = MongoConditionBuilder.buildFilterConditions({
                code: ["like", "A_C%"]
            });
            const regex = (cond as { code: { $regex: RegExp } }).code.$regex;
            expect(regex.source).toBe("^A.C.*$");
            expect(regex.flags).toBe("");
            expect(regex.test("ABCdef")).toBe(true);
            expect(regex.test("abcdef")).toBe(false);
        });

        it("should negate not-ilike via $not", () => {
            const [cond] = MongoConditionBuilder.buildFilterConditions({
                name: ["not-ilike", "%spam%"]
            });
            const not = (cond as { name: { $not: RegExp } }).name.$not;
            expect(not).toBeInstanceOf(RegExp);
            expect(not.flags).toBe("i");
        });

        it("should escape regex metacharacters in like patterns", () => {
            const [cond] = MongoConditionBuilder.buildFilterConditions({
                path: ["like", "a.b+c%"]
            });
            const regex = (cond as { path: { $regex: RegExp } }).path.$regex;
            expect(regex.source).toBe("^a\\.b\\+c.*$");
            expect(regex.test("a.b+cXYZ")).toBe(true);
            expect(regex.test("axbxc")).toBe(false);
        });
    });

    describe("buildSort", () => {
        it("should return undefined when no orderBy provided", () => {
            const result = MongoConditionBuilder.buildSort();
            expect(result).toBeUndefined();
        });

        it("should build ascending sort", () => {
            const result = MongoConditionBuilder.buildSort("name", "asc");
            expect(result).toEqual({ name: 1 });
        });

        it("should build descending sort", () => {
            const result = MongoConditionBuilder.buildSort("createdAt", "desc");
            expect(result).toEqual({ createdAt: -1 });
        });

        it("should default to ascending when order not specified", () => {
            const result = MongoConditionBuilder.buildSort("name");
            expect(result).toEqual({ name: 1 });
        });
    });

    describe("combineConditionsWithAnd", () => {
        it("should return undefined for empty array", () => {
            const result = MongoConditionBuilder.combineConditionsWithAnd([]);
            expect(result).toBeUndefined();
        });

        it("should return single condition directly", () => {
            const conditions = [{ status: { $eq: "active" } }];
            const result = MongoConditionBuilder.combineConditionsWithAnd(conditions);
            expect(result).toEqual({ status: { $eq: "active" } });
        });

        it("should combine multiple conditions with $and", () => {
            const conditions = [
                { status: { $eq: "active" } },
                { priority: { $gte: 5 } }
            ];
            const result = MongoConditionBuilder.combineConditionsWithAnd(conditions);
            expect(result).toEqual({
                $and: [
                    { status: { $eq: "active" } },
                    { priority: { $gte: 5 } }
                ]
            });
        });
    });

    describe("combineConditionsWithOr", () => {
        it("should return undefined for empty array", () => {
            const result = MongoConditionBuilder.combineConditionsWithOr([]);
            expect(result).toBeUndefined();
        });

        it("should combine multiple conditions with $or", () => {
            const conditions = [
                { name: { $regex: /test/i } },
                { description: { $regex: /test/i } }
            ];
            const result = MongoConditionBuilder.combineConditionsWithOr(conditions);
            expect(result).toEqual({
                $or: [
                    { name: { $regex: /test/i } },
                    { description: { $regex: /test/i } }
                ]
            });
        });
    });

    describe("buildQuery", () => {
        it("should return empty object for no options", () => {
            const result = MongoConditionBuilder.buildQuery({});
            expect(result).toEqual({});
        });

        it("should combine filter and search conditions", () => {
            const result = MongoConditionBuilder.buildQuery({
                filter: { status: ["==", "active"] },
                searchString: "test",
                properties: { name: { name: "Name",
type: "string" } }
            });
            expect(result).toHaveProperty("$and");
        });
    });

    /*
     * Search built a regex over the collection's string properties, or fell
     * back to `$text` when it found none.
     *
     * It found none — ever. The check read `prop.dataType === "string"`, and no
     * property in `@rebasepro/types` has ever had a `dataType` field; a real
     * collection carries `type`. So every search on this driver became a
     * `$text` query, which requires a text index and throws `IndexNotFound`
     * without one.
     *
     * The fixtures in this file were written with the same wrong key, so the
     * test data agreed with the bug and neither ever met a real collection.
     * These assert on the shape a collection actually has.
     */
    describe("search picks its fields off the property shape collections really use", () => {
        const props: CollectionConfig["properties"] = {
            name: { name: "Name",
type: "string" },
            bio: { name: "Bio",
type: "string" },
            age: { name: "Age",
type: "number" }
        };

        it("builds a regex condition per string property", () => {
            const conditions = MongoConditionBuilder.buildSearchConditions("ada", props);

            expect(conditions).toHaveLength(2);
            expect(conditions.map(c => Object.keys(c)[0]).sort()).toEqual(["bio", "name"]);
        });

        it("does not search non-string properties", () => {
            const conditions = MongoConditionBuilder.buildSearchConditions("ada", props);

            expect(conditions.some(c => "age" in c)).toBe(false);
        });

        it("matches case-insensitively on the search string", () => {
            const [first] = MongoConditionBuilder.buildSearchConditions("ada", { name: { name: "Name",
type: "string" } });

            const regex = (first as Record<string, { $regex: RegExp }>).name.$regex;
            expect(regex.test("Ada Lovelace")).toBe(true);
            expect(regex.flags).toContain("i");
        });

        it("escapes regex metacharacters so a search term stays a literal", () => {
            const [first] = MongoConditionBuilder.buildSearchConditions("a.b", { name: { name: "Name",
type: "string" } });

            const regex = (first as Record<string, { $regex: RegExp }>).name.$regex;
            expect(regex.test("a.b")).toBe(true);
            expect(regex.test("axb")).toBe(false);
        });

        it("falls back to $text only when the collection really has no string field", () => {
            // The fallback is correct in itself — it was simply the only path
            // ever taken, on collections that had string fields all along.
            const conditions = MongoConditionBuilder.buildSearchConditions("ada", { age: { name: "Age",
type: "number" } });

            expect(conditions).toEqual([{ $text: { $search: "ada" } }]);
        });
    });
});
