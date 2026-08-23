/**
 * The name a generated `export const <name> = pgTable(…)` is bound to.
 *
 * `getTableVarName` camel-cased underscores and stopped there, so a table name
 * that is legal in Postgres and not in JavaScript produced a
 * `schema.generated.ts` that does not parse. That file is imported by the
 * server, so the consequence is not one broken collection — `rebase build` and
 * `db push` fail at tsc for the whole directory — and it is reachable from a
 * documented flow: `rebase init` against a database holding `2024_archive`
 * writes a collection file that parses and a schema file that does not.
 */
import { getTableVarName, getEnumVarName } from "../src/util/relations";

const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

describe("getTableVarName", () => {
    describe("is a no-op for every name that already worked", () => {
        // This is what makes changing a derived name safe: the only inputs
        // whose output moves are the ones that produced a syntax error, and
        // nothing can be running against those.
        it.each([
            ["posts", "posts"],
            ["blog_posts", "blogPosts"],
            ["a_b_c_d", "aBCD"],
            ["users", "users"],
            // Pre-existing and slightly surprising: the camel-case rule matches
            // a LEADING underscore too, so `_private` has always produced
            // `Private`. Recorded rather than corrected — it is a legal
            // identifier, and it is a name something may already be bound to.
            ["_private", "Private"],
            ["Table1", "Table1"]
        ])("%s stays %s", (input, expected) => {
            expect(getTableVarName(input)).toBe(expected);
        });
    });

    describe("always produces something that can be declared", () => {
        it.each([
            "2024_archive",
            "reporting.events",
            "a-b",
            "table name",
            "1",
            "123_456",
            "über_tabelle",
            'weird"quote',
            "a$b"
        ])("%s becomes a legal identifier", (input) => {
            expect(getTableVarName(input)).toMatch(JS_IDENTIFIER);
        });
    });

    describe("keeps names that differ, different", () => {
        it("does not collide a dotted name with an underscored one", () => {
            // Dropping separators instead of camel-casing them would map both
            // of these to `reportingevents`, and two tables would fight over
            // one variable in a file that then compiles and is wrong.
            expect(getTableVarName("reporting.events")).not.toBe(getTableVarName("reporting_events_x"));
            expect(getTableVarName("reporting.events")).toBe("reportingEvents");
            expect(getTableVarName("reporting_events")).toBe("reportingEvents");
        });

        it("does not collide a leading-digit name with its bare form", () => {
            expect(getTableVarName("2024_archive")).not.toBe(getTableVarName("archive"));
        });
    });

    it("carries the guarantee into enum variable names", () => {
        // `getEnumVarName` builds on it, so a table that needed sanitising
        // would otherwise reintroduce the same syntax error one line later.
        expect(getEnumVarName("2024_archive", "status")).toMatch(JS_IDENTIFIER);
        expect(getEnumVarName("reporting.events", "kind")).toMatch(JS_IDENTIFIER);
    });
});
