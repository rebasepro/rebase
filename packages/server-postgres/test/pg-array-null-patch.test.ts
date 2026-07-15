import { describe, it, expect, jest } from "@jest/globals";
import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";
import { patchPgArrayNullSafety } from "../src/utils/pg-array-null-patch";
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
        expect(tagsColumn.mapFromDriverValue(null as any)).toBeNull();
        expect(tagsColumn.mapFromDriverValue(undefined as any)).toBeNull();
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
        patchPgArrayNullSafety({ test_items: testTable });

        const columns = getTableColumns(testTable);
        const nameColumn = columns.name;

        // Non-array columns should not be PgArray instances
        expect(nameColumn instanceof PgArray).toBe(false);
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
});
