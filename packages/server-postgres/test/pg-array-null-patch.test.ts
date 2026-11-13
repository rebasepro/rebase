import { describe, it, expect, jest } from "@jest/globals";
import { pgTable, text, integer, boolean, bigint, date } from "drizzle-orm/pg-core";
import { parsePgArrayLiteral, patchPgArrayNullSafety } from "../src/utils/pg-array-null-patch";
import { getTableColumns } from "drizzle-orm";
import { PgArray } from "drizzle-orm/pg-core";

// Build a table that has native array columns
const testTable = pgTable("test_items", {
    id: text("id").primaryKey(),
    name: text("name"),
    tags: text("tags").array(),
    scores: integer("scores").array(),
    flags: boolean("flags").array(),
});

describe("patchPgArrayNullSafety", () => {
    it("should patch PgArray columns to handle null", () => {
        patchPgArrayNullSafety({ test_items: testTable });

        const columns = getTableColumns(testTable);
        const tagsColumn = columns.tags;

        // Before patch, calling mapFromDriverValue(null) would throw TypeError
        // After patch, it should return null
        // Outside drizzle's type on purpose: a NULL column hands the mapper null, which is what the patch is for.
        expect(tagsColumn.mapFromDriverValue(null as unknown as string)).toBeNull();
        // As above, for a value that is absent altogether.
        expect(tagsColumn.mapFromDriverValue(undefined as unknown as string)).toBeNull();
    });

    it("should still process valid array values correctly", () => {
        patchPgArrayNullSafety({ test_items: testTable });

        const columns = getTableColumns(testTable);
        const tagsColumn = columns.tags;
        const scoresColumn = columns.scores;

        // Valid arrays should still work
        expect(tagsColumn.mapFromDriverValue(["hello", "world"])).toEqual(["hello", "world"]);
        expect(tagsColumn.mapFromDriverValue([])).toEqual([]);
        expect(scoresColumn.mapFromDriverValue([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it("should not patch non-array columns", () => {
        // A table of its own: the shared `testTable` is patched by the tests
        // above, so a "was it touched?" check against it could never see the
        // before state.
        const mixedTable = pgTable("mixed_items", {
            id: text("id").primaryKey(),
            name: text("name"),
            tags: text("tags").array(),
        });

        const columns = getTableColumns(mixedTable);
        const nameColumn = columns.name;
        const tagsColumn = columns.tags;

        // `instanceof PgArray` is drizzle's own fact about `text()` — true
        // before the patch runs and true after, so it holds even for a patch
        // that wrapped every column on the table. What the patch controls is
        // the mapper: it installs an own-property wrapper on the columns it
        // touches, so an untouched column still resolves `mapFromDriverValue`
        // to the same inherited function.
        const nameMapperBefore = nameColumn.mapFromDriverValue;
        const tagsMapperBefore = tagsColumn.mapFromDriverValue;

        patchPgArrayNullSafety({ mixed_items: mixedTable });

        expect(nameColumn instanceof PgArray).toBe(false);
        expect(nameColumn.mapFromDriverValue).toBe(nameMapperBefore);
        expect(Object.getOwnPropertyDescriptor(nameColumn, "mapFromDriverValue")).toBeUndefined();

        // …and the array column in the same table proves the patch did run,
        // so the check above is a real exclusion and not a vacuous one.
        expect(tagsColumn.mapFromDriverValue).not.toBe(tagsMapperBefore);
    });

    it("should handle tables with no array columns", () => {
        const simpleTable = pgTable("simple", {
            id: text("id").primaryKey(),
            name: text("name"),
        });

        // Should not throw
        expect(() => patchPgArrayNullSafety({ simple: simpleTable })).not.toThrow();
    });

    it("should handle empty input", () => {
        expect(() => patchPgArrayNullSafety({})).not.toThrow();
    });

    it("keeps a null item null instead of mapping it through the item column", () => {
        const items = pgTable("null_items", {
            id: text("id").primaryKey(),
            counts: bigint("counts", { mode: "number" }).array(),
            days: date("days", { mode: "string" }).array()
        });
        patchPgArrayNullSafety({ null_items: items });
        const { counts, days } = getTableColumns(items);
        // Drizzle's own mapping: `Number(null)` — a null `bigint[]` item read back as 0.
        expect(counts.mapFromDriverValue(["1", null, "9007199254740991"])).toEqual([1, null, 9007199254740991]);
        // A literal the driver left to drizzle: an unquoted NULL is null, a quoted one the string.
        expect(days.mapFromDriverValue("{2026-01-02,NULL}")).toEqual(["2026-01-02", null]);
    });

    it("wraps a column once however often a table is patched", () => {
        const twice = pgTable("twice", { id: text("id").primaryKey(), tags: text("tags").array() });
        patchPgArrayNullSafety({ twice });
        const first = getTableColumns(twice).tags.mapFromDriverValue;
        patchPgArrayNullSafety({ twice });
        expect(getTableColumns(twice).tags.mapFromDriverValue).toBe(first);
    });
});

describe("parsePgArrayLiteral", () => {
    it("reads quoted, unquoted, null, empty and nested items", () => {
        expect(parsePgArrayLiteral("{}")).toEqual([]);
        expect(parsePgArrayLiteral("{a,\"b c\",NULL,\"NULL\",null}")).toEqual(["a", "b c", null, "NULL", null]);
        expect(parsePgArrayLiteral("{\"it's\",\"a \\\"word\\\"\",\"back\\\\slash\"}")).toEqual(["it's", "a \"word\"", "back\\slash"]);
        expect(parsePgArrayLiteral("{\"2026-01-02 11:00:00+01\",NULL}")).toEqual(["2026-01-02 11:00:00+01", null]);
        expect(parsePgArrayLiteral("{{1,2},{NULL,4}}")).toEqual([["1", "2"], [null, "4"]]);
        expect(parsePgArrayLiteral("[0:1]={x,y}")).toEqual(["x", "y"]);
        expect(parsePgArrayLiteral("{\"\"}")).toEqual([""]);
    });
});
