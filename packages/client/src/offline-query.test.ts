import {
    compareValues,
    isExactlyEvaluable,
    isLocallySortable,
    looseEquals,
    matchesLogical,
    matchesOperator,
    matchesParams,
    matchesWhere,
    resolvePagination,
    runLocalQuery,
    sortRows
} from "./offline-query";
import { DEFAULT_LIST_LIMIT, EntityRelation } from "@rebasepro/types";
import { resolveFindWindow } from "@rebasepro/common";
import type { FindParams } from "./transport";

type Row = Record<string, unknown>;

/**
 * The local evaluator is what lets a row written offline appear in the
 * filtered lists it belongs to, so every divergence from the Postgres driver's
 * semantics shows up as a list that is subtly wrong only when the network is.
 * These pin the cases where SQL and JavaScript disagree.
 */
describe("local query engine", () => {
    describe("operators", () => {
        it("compares numbers written as strings by the wire as numbers", () => {
            // The wire format carries no types, so `["<", "10"]` arrives as a
            // string. Comparing it as text would order "10" before "9".
            expect(matchesOperator(9, "<", "10")).toBe(true);
            expect(matchesOperator("9", "<", 10)).toBe(true);
            expect(matchesOperator(10, "<", "9")).toBe(false);
        });

        it("treats a comparison against NULL as unknown, not as false-or-true", () => {
            // `WHERE status != 'done'` does not return rows with a NULL status.
            expect(matchesOperator(null, "!=", "done")).toBe(false);
            expect(matchesOperator(undefined, "!=", "done")).toBe(false);
            expect(matchesOperator(null, "<", 5)).toBe(false);
            expect(matchesOperator(null, ">", 5)).toBe(false);
            expect(matchesOperator(null, "in", ["a"])).toBe(false);
            expect(matchesOperator(null, "not-in", ["a"])).toBe(false);
        });

        it("tests null with the operators meant for it", () => {
            expect(matchesOperator(null, "is-null", null)).toBe(true);
            expect(matchesOperator(undefined, "is-null", null)).toBe(true);
            expect(matchesOperator(0, "is-null", null)).toBe(false);
            expect(matchesOperator("", "is-not-null", null)).toBe(true);
            expect(matchesOperator(null, "is-not-null", null)).toBe(false);
        });

        it("matches dates against instants and ISO strings alike", () => {
            const row = new Date("2026-07-01T00:00:00Z");
            expect(matchesOperator(row, ">=", new Date("2026-06-01T00:00:00Z"))).toBe(true);
            expect(matchesOperator(row, "<", "2026-08-01T00:00:00Z")).toBe(true);
            expect(matchesOperator(row, "==", new Date("2026-07-01T00:00:00Z"))).toBe(true);
        });

        it("compares a relation by the id it points at", () => {
            const relation = new EntityRelation("u1", "users");
            expect(matchesOperator(relation, "==", "u1")).toBe(true);
            expect(matchesOperator(relation, "in", ["u1", "u2"])).toBe(true);
            expect(matchesOperator(relation, "==", "u2")).toBe(false);
        });

        it("handles list membership and array columns", () => {
            expect(matchesOperator("editor", "in", ["admin", "editor"])).toBe(true);
            expect(matchesOperator("viewer", "not-in", ["admin", "editor"])).toBe(true);
            expect(matchesOperator(["a", "b"], "array-contains", "b")).toBe(true);
            expect(matchesOperator(["a", "b"], "array-contains", "c")).toBe(false);
            expect(matchesOperator(["a", "b"], "array-contains-any", ["c", "b"])).toBe(true);
            expect(matchesOperator("not-an-array", "array-contains", "a")).toBe(false);
        });

        it("reads LIKE patterns as SQL does, wildcards and escapes included", () => {
            expect(matchesOperator("post-1", "like", "post-%")).toBe(true);
            expect(matchesOperator("Post-1", "like", "post-%")).toBe(false);
            expect(matchesOperator("Post-1", "ilike", "post-%")).toBe(true);
            expect(matchesOperator("abc", "like", "a_c")).toBe(true);
            expect(matchesOperator("abbc", "like", "a_c")).toBe(false);
            expect(matchesOperator("50%", "like", "50\\%")).toBe(true);
            expect(matchesOperator("500", "like", "50\\%")).toBe(false);
            expect(matchesOperator("a.c", "like", "a.c")).toBe(true);
            // A regex metacharacter in the pattern is a literal, not a wildcard.
            expect(matchesOperator("abc", "like", "a.c")).toBe(false);
            expect(matchesOperator("Post-1", "not-ilike", "post-%")).toBe(false);
            expect(matchesOperator("other", "not-like", "post-%")).toBe(true);
        });

        it("accepts REST short-codes wherever canonical operators are accepted", () => {
            // Filters that came off the wire carry `eq`/`gte`, not `==`/`>=`.
            expect(matchesWhere({ status: "active" }, { status: ["eq" as "==", "active"] })).toBe(true);
            expect(matchesWhere({ age: 20 }, { age: ["gte" as ">=", 18] })).toBe(true);
        });

        it("keeps an unknown operator from silently dropping rows", () => {
            // Better a list that is too broad than one that quietly hides rows
            // because this build predates an operator.
            expect(matchesOperator("x", "spaceship" as never, "y")).toBe(true);
        });
    });

    describe("where clauses", () => {
        const row: Row = { status: "active", age: 30, tags: ["a"] };

        it("ANDs across fields and across tuples on one field", () => {
            expect(matchesWhere(row, { status: ["==", "active"], age: [">=", 18] })).toBe(true);
            expect(matchesWhere(row, { status: ["==", "active"], age: [">=", 40] })).toBe(false);
            expect(matchesWhere(row, { age: [[">=", 18], ["<", 65]] })).toBe(true);
            expect(matchesWhere(row, { age: [[">=", 18], ["<", 25]] })).toBe(false);
        });

        it("is vacuously true with no clause", () => {
            expect(matchesWhere(row, undefined)).toBe(true);
            expect(matchesWhere(row, {})).toBe(true);
        });
    });

    describe("logical trees", () => {
        const row: Row = { status: "draft", author: "me" };

        it("evaluates nested and/or", () => {
            expect(matchesLogical(row, {
                type: "or",
                conditions: [
                    { column: "status", operator: "==", value: "published" },
                    { column: "author", operator: "==", value: "me" }
                ]
            })).toBe(true);

            expect(matchesLogical(row, {
                type: "and",
                conditions: [
                    { column: "status", operator: "==", value: "draft" },
                    {
                        type: "or",
                        conditions: [
                            { column: "author", operator: "==", value: "you" },
                            { column: "author", operator: "==", value: "me" }
                        ]
                    }
                ]
            })).toBe(true);

            expect(matchesLogical(row, {
                type: "or",
                conditions: [{ column: "status", operator: "==", value: "published" }]
            })).toBe(false);
        });
    });

    describe("ordering", () => {
        it("puts nulls last ascending and first descending, as Postgres does", () => {
            const rows: Row[] = [{ id: 1, n: 2 }, { id: 2, n: null }, { id: 3, n: 1 }];
            expect(sortRows([...rows], ["n", "asc"]).map((r) => r.id)).toEqual([3, 1, 2]);
            expect(sortRows([...rows], ["n", "desc"]).map((r) => r.id)).toEqual([2, 1, 3]);
        });

        it("breaks ties on id so paging cannot shuffle equal rows between pages", () => {
            const rows: Row[] = [{ id: "c", n: 1 }, { id: "a", n: 1 }, { id: "b", n: 1 }];
            expect(sortRows(rows, ["n", "asc"]).map((r) => r.id)).toEqual(["a", "b", "c"]);
        });

        it("orders dates chronologically, not lexicographically", () => {
            const rows: Row[] = [
                { id: 1, at: new Date("2026-01-02T00:00:00Z") },
                { id: 2, at: new Date("2025-12-31T00:00:00Z") }
            ];
            expect(sortRows(rows, ["at", "asc"]).map((r) => r.id)).toEqual([2, 1]);
        });
    });

    describe("pagination", () => {
        it("resolves page over offset the way the server does", () => {
            expect(resolvePagination({ limit: 10, offset: 30 })).toEqual({ limit: 10, offset: 30 });
            expect(resolvePagination({ limit: 10, page: 3 })).toEqual({ limit: 10, offset: 20 });
            // `page` wins over `offset`, and the first page is not negative.
            expect(resolvePagination({ limit: 10, page: 1, offset: 99 })).toEqual({ limit: 10, offset: 0 });
        });

        it("defaults to the same page size the server would apply", () => {
            // Asserted against the constant, not against a number written here.
            // This test used to say `{ limit: 20 }` — restating a default this
            // module had invented, while `/api/data` paged by 50. The local
            // answer and the network answer to one `observe()` were therefore
            // different lengths, and the test agreed with the wrong one.
            expect(resolvePagination()).toEqual({ limit: DEFAULT_LIST_LIMIT, offset: 0 });
        });

        it("agrees with the shared resolver on every shape of window", () => {
            // The one that matters: the local evaluator and every other
            // transport must resolve identical windows, or a cached list and a
            // fetched list disagree about which rows page two holds.
            for (const params of [
                undefined,
                { limit: 10 },
                { offset: 30 },
                { page: 4 },
                { limit: 25, page: 2 },
                { limit: 10, page: 1, offset: 99 }
            ]) {
                const { limit, offset } = resolveFindWindow(params);
                expect(resolvePagination(params)).toEqual({ limit, offset });
            }
        });
    });

    describe("runLocalQuery", () => {
        const rows: Row[] = [
            { id: "a", n: 3, status: "draft" },
            { id: "b", n: 1, status: "draft" },
            { id: "c", n: 2, status: "published" }
        ];

        it("filters, sorts and paginates, reporting the unpaginated total", () => {
            const result = runLocalQuery(rows, {
                where: { status: ["==", "draft"] },
                orderBy: ["n", "asc"],
                limit: 1
            });
            expect(result.data.map((r) => r.id)).toEqual(["b"]);
            expect(result.meta).toEqual({ total: 2, limit: 1, offset: 0, hasMore: true });
        });

        it("reports no more rows on the last page", () => {
            const result = runLocalQuery(rows, { orderBy: ["n", "asc"], limit: 2, offset: 2 });
            expect(result.data.map((r) => r.id)).toEqual(["a"]);
            expect(result.meta).toMatchObject({ total: 3, offset: 2, hasMore: false });
        });

        it("approximates search as a substring scan over string and number fields", () => {
            expect(runLocalQuery(rows, { searchString: "publi" }).data.map((r) => r.id)).toEqual(["c"]);
            expect(runLocalQuery(rows, { searchString: "PUBLI" }).data.map((r) => r.id)).toEqual(["c"]);
            expect(runLocalQuery(rows, { searchString: "   " }).data).toHaveLength(3);
        });

        it("combines where, logical and search with AND", () => {
            const params: FindParams = {
                where: { status: ["==", "draft"] },
                logical: { type: "or", conditions: [{ column: "n", operator: "==", value: 3 }] }
            };
            expect(runLocalQuery(rows, params).data.map((r) => r.id)).toEqual(["a"]);
            expect(matchesParams({ id: "b", n: 1, status: "draft" }, params)).toBe(false);
        });
    });

    describe("isExactlyEvaluable", () => {
        it("admits what it cannot answer as well as the server would", () => {
            expect(isExactlyEvaluable(undefined)).toBe(true);
            expect(isExactlyEvaluable({ where: { a: ["==", 1] }, orderBy: ["a", "asc"] })).toBe(true);
            // Real full-text search is not a substring scan…
            expect(isExactlyEvaluable({ searchString: "x" })).toBe(false);
            // …and related rows live in collections this query never loaded.
            expect(isExactlyEvaluable({ include: ["author"] })).toBe(false);
            expect(isExactlyEvaluable({ include: [] })).toBe(true);
        });

        /**
         * An ordering comparison is answered here by `compareValues`, which
         * falls back to an `Intl.Collator`, and by Postgres using the
         * *database's* collation — a property of the server this process has
         * never been told. `'apple' < 'Banana'` is false under the C collation
         * and true under `en_US.UTF-8`; the collator says true. So the two
         * select different sets, in whichever direction the deployment happened
         * to be created.
         */
        it("refuses an ordering comparison, whose answer depends on the server's collation", () => {
            for (const op of ["<", "<=", ">", ">="] as const) {
                expect({ op, exact: isExactlyEvaluable({ where: { name: [op, "Banana"] } }) })
                    .toEqual({ op, exact: false });
            }
            // Equality, membership and pattern matching are unaffected — all
            // verified against a real database in
            // `server-postgres/test/e2e/offline-query-agreement.test.ts`.
            for (const op of ["==", "!=", "in", "not-in", "like", "ilike"] as const) {
                expect({ op, exact: isExactlyEvaluable({ where: { name: [op, "x"] } }) })
                    .toEqual({ op, exact: true });
            }
            expect(isExactlyEvaluable({ where: { a: ["is-null", null] } })).toBe(true);
        });

        it("refuses a numeric range too, because the operand type does not settle it", () => {
            // `compareValues` deliberately reads numeric strings as numbers, so
            // it cannot tell an integer column from a text column of digits —
            // and on the latter Postgres orders "10" before "9" while this
            // orders 9 before 10. Conservative on purpose; the schema would be
            // needed to do better.
            expect(isExactlyEvaluable({ where: { qty: [">", 10] } })).toBe(false);
        });

        it("looks inside and/or groups, not just the top-level where", () => {
            expect(isExactlyEvaluable({
                logical: { type: "or", conditions: [
                    { column: "a", operator: "==", value: 1 },
                    { column: "b", operator: "==", value: 2 }
                ] }
            } as never)).toBe(true);
            expect(isExactlyEvaluable({
                logical: { type: "or", conditions: [
                    { column: "a", operator: "==", value: 1 },
                    { type: "and", conditions: [{ column: "b", operator: "<", value: "m" }] }
                ] }
            } as never)).toBe(false);
        });

        it("still refuses several conditions on one field when any of them orders", () => {
            expect(isExactlyEvaluable({ where: { a: [["==", 1], ["<", "m"]] } } as never)).toBe(false);
            expect(isExactlyEvaluable({ where: { a: [["==", 1], ["!=", 2]] } } as never)).toBe(true);
        });
    });

    describe("isLocallySortable", () => {
        /**
         * Asked of the rows rather than the query, because unlike a filter this
         * one is decidable from the data in hand: the collator is reachable
         * only when a value cannot be read as a number.
         */
        it("accepts a column this page holds only as numbers", () => {
            expect(isLocallySortable([{ id: 1, n: 3 }, { id: 2, n: 10 }], ["n", "asc"])).toBe(true);
            // The wire's type erasure is already undone by `compareValues`.
            expect(isLocallySortable([{ id: 1, n: "3" }, { id: 2, n: "10" }], ["n", "asc"])).toBe(true);
            // Dates normalise to instants before any comparison happens.
            expect(isLocallySortable(
                [{ id: 1, at: new Date(1) }, { id: 2, at: new Date(2) }], ["at", "desc"]
            )).toBe(true);
        });

        it("refuses a column holding text, whose order is the database's to decide", () => {
            expect(isLocallySortable([{ id: 1, name: "apple" }, { id: 2, name: "Banana" }], ["name", "asc"]))
                .toBe(false);
            // One text value is enough — a column is one type, and the page that
            // happens to be cached does not get to vote.
            expect(isLocallySortable([{ id: 1, n: 3 }, { id: 2, n: "x" }], ["n", "asc"])).toBe(false);
        });

        it("ignores nulls, which are ordered by an explicit rule", () => {
            expect(isLocallySortable([{ id: 1, n: null }, { id: 2, n: 5 }], ["n", "asc"])).toBe(true);
            expect(isLocallySortable([{ id: 1 }, { id: 2 }], ["missing", "asc"])).toBe(true);
        });

        it("is vacuously true with no sort", () => {
            expect(isLocallySortable([{ id: 1, name: "a" }], undefined)).toBe(true);
        });
    });

    describe("primitives", () => {
        it("compareValues returns undefined rather than an order across NULL", () => {
            expect(compareValues(null, 1)).toBeUndefined();
            expect(compareValues(1, undefined)).toBeUndefined();
            expect(compareValues(1, 2)).toBeLessThan(0);
            expect(compareValues("b", "a")).toBeGreaterThan(0);
        });

        it("looseEquals treats null and undefined as the same absence", () => {
            expect(looseEquals(null, undefined)).toBe(true);
            expect(looseEquals(null, 0)).toBe(false);
            expect(looseEquals(true, "true")).toBe(true);
            expect(looseEquals(1, "1")).toBe(true);
        });
    });
});
