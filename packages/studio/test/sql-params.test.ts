import { describe, expect, it } from "@jest/globals";
import {
    findSqlParameters,
    missingSqlParameters,
    quoteSqlLiteral,
    sqlParameterNames,
    substituteSqlParameters
} from "../src/utils/sql_params";

/**
 * `:name` placeholders in the SQL console. A colon is a placeholder only in
 * SQL text: never inside a string, a quoted identifier, a dollar-quoted body,
 * a comment or an array subscript, and never as half of a `::` cast.
 */
describe("finding :name placeholders", () => {
    it("finds each placeholder, in order, with its position", () => {
        const sql = "SELECT * FROM posts WHERE author_id = :author AND created_at > :since";
        expect(findSqlParameters(sql)).toEqual([
            { name: "author", start: sql.indexOf(":author"), end: sql.indexOf(":author") + 7 },
            { name: "since", start: sql.indexOf(":since"), end: sql.length }
        ]);
    });

    it("lists a name used twice once, keeping its case", () => {
        expect(sqlParameterNames("SELECT :Id, :id, :Id")).toEqual(["Id", "id"]);
    });

    it("skips a :: cast, including a cast to a type that looks like a name", () => {
        expect(sqlParameterNames("SELECT created_at::date, :day::timestamptz, x::text")).toEqual(["day"]);
    });

    it("skips string literals, '' escapes and E'' backslash escapes", () => {
        expect(sqlParameterNames("SELECT ':no', 'it''s :no', E'\\' :no', :yes")).toEqual(["yes"]);
    });

    it("skips quoted identifiers", () => {
        expect(sqlParameterNames("SELECT \"weird:col\", \"a\"\":b\" FROM t WHERE x = :yes")).toEqual(["yes"]);
    });

    it("skips dollar-quoted bodies, tagged or not, but not a positional $1", () => {
        const sql = "CREATE FUNCTION f() RETURNS int AS $$ SELECT :no $$ LANGUAGE sql; " +
            "DO $body$ BEGIN PERFORM :no; END $body$; SELECT $1, :yes";
        expect(sqlParameterNames(sql)).toEqual(["yes"]);
    });

    it("skips line comments and nested block comments", () => {
        const sql = "SELECT 1 -- :no\n, /* :no /* :no */ :no */ :yes";
        expect(sqlParameterNames(sql)).toEqual(["yes"]);
    });

    it("skips array slices and := named arguments", () => {
        expect(sqlParameterNames("SELECT arr[1:2], arr[lo:hi], f(a := 1), :yes")).toEqual(["yes"]);
    });

    it("does not read a placeholder out of an identifier or a number", () => {
        expect(sqlParameterNames("SELECT a:b, 10:30")).toEqual([]);
    });

    it("survives an unterminated string, comment or dollar quote", () => {
        expect(sqlParameterNames("SELECT :a, 'open :b")).toEqual(["a"]);
        expect(sqlParameterNames("SELECT :a /* open :b")).toEqual(["a"]);
        expect(sqlParameterNames("SELECT :a, $$ open :b")).toEqual(["a"]);
    });
});

describe("filling placeholders in", () => {
    it("writes a quoted literal, NULL, or the raw text", () => {
        const sql = "SELECT * FROM t WHERE a = :a AND b IS :b AND c > :c";
        expect(substituteSqlParameters(sql, {
            a: { mode: "text", value: "O'Brien" },
            b: { mode: "null", value: "ignored" },
            c: { mode: "raw", value: "now() - interval '1 day'" }
        })).toBe("SELECT * FROM t WHERE a = 'O''Brien' AND b IS NULL AND c > now() - interval '1 day'");
    });

    it("fills every use of a name, and leaves the casts and strings around it alone", () => {
        expect(substituteSqlParameters("SELECT :d::date, ':d', :d", { d: { mode: "text", value: "2026-01-01" } }))
            .toBe("SELECT '2026-01-01'::date, ':d', '2026-01-01'");
    });

    it("writes a backslash so the database reads it back whatever standard_conforming_strings says", () => {
        expect(quoteSqlLiteral("C:\\path")).toBe("E'C:\\\\path'");
        expect(quoteSqlLiteral("plain")).toBe("'plain'");
    });

    it("says which placeholders have no value: none given, or blank and not NULL", () => {
        expect(missingSqlParameters("SELECT :a, :b, :c, :d", {
            a: { mode: "text", value: "" },
            b: { mode: "null", value: "" },
            c: { mode: "raw", value: "1" }
        })).toEqual(["a", "d"]);
    });
});
