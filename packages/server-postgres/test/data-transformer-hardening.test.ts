import {
    serializeDataToServer,
    sanitizeAndConvertDates
} from "../src/data-transformer";
import { liftedColumnOf, runtimeTableOf } from "./helpers/codec-columns";
import { pgTable, varchar, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { LegacyPostgresCollectionConfig, LegacyPostgresProperties } from "@rebasepro/common/migrate";

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────
function makeCollection(
    slug: string,
    properties: LegacyPostgresCollectionConfig["properties"],
    relations?: LegacyPostgresCollectionConfig["relations"]
): LegacyPostgresCollectionConfig {
    return {
        name: slug,
        slug,
        properties,
        relations
    };
}

// ─────────────────────────────────────────────────────────────
// serializeDataToServer — typed return (Issue #7 regression)
// ─────────────────────────────────────────────────────────────
describe("serializeDataToServer typed return", () => {
    const properties: LegacyPostgresProperties = {
        title: { type: "string",
name: "Title" },
        count: { type: "number",
name: "Count" }
    };

    it("returns a SerializedEntityData object with scalarData, not raw values", () => {
        const result = serializeDataToServer(
            { title: "Hello",
count: 5 },
            runtimeTableOf(makeCollection("items", properties))
        );
        expect(result).toHaveProperty("scalarData");
        expect(result).toHaveProperty("inverseRelationUpdates");
        expect(result).toHaveProperty("joinPathRelationUpdates");
    });

    it("does NOT include __inverseRelationUpdates on scalarData (dunder elimination)", () => {
        const result = serializeDataToServer(
            { title: "Test" },
            runtimeTableOf(makeCollection("items", properties))
        );
        // The old pattern embedded __dunder properties on the result object
        expect(result.scalarData).not.toHaveProperty("__inverseRelationUpdates");
        expect(result.scalarData).not.toHaveProperty("__joinPathRelationUpdates");
    });

    it("returns empty relation updates for a row of plain columns", () => {
        const result = serializeDataToServer(
            { title: "Test" },
            runtimeTableOf(makeCollection("items", properties))
        );
        expect(result.inverseRelationUpdates).toEqual([]);
        expect(result.joinPathRelationUpdates).toEqual([]);
    });

    it("passes scalar values through correctly", () => {
        const result = serializeDataToServer(
            { title: "Hello World",
count: 42 },
            runtimeTableOf(makeCollection("items", properties))
        );
        expect(result.scalarData.title).toBe("Hello World");
        expect(result.scalarData.count).toBe(42);
    });

    it("handles null/undefined entity gracefully", () => {
        // Deliberately invalid: the null guard under test has no typed caller, so the null arrives untyped.
        const noRow: Record<string, unknown> | null = JSON.parse("null");
        const result = serializeDataToServer(noRow as Record<string, unknown>);
        // Object.entries(null) yields nothing → empty object
        expect(result.scalarData).toEqual({});
        expect(result.inverseRelationUpdates).toEqual([]);
        expect(result.joinPathRelationUpdates).toEqual([]);
    });

    // ── `undefined` means "not this field", not "NULL this column" ──
    //
    // `update(id, { title, subtitle: payload.subtitle })` with no subtitle in
    // the payload used to null the column: the key survived with `undefined`,
    // `sanitizeAndConvertDates` turned it into `null`, and Drizzle's
    // `set[col] !== undefined` test then saw a value to write. Unreachable over
    // HTTP (JSON has no `undefined`); the in-process data API hands the
    // caller's object straight to the driver.
    it("drops a key whose value is undefined instead of writing NULL", () => {
        const result = serializeDataToServer(
            { title: "Hello",
subtitle: undefined },
            runtimeTableOf(makeCollection("items", { ...properties,
subtitle: { type: "string",
name: "Subtitle" } }))
        );
        expect(result.scalarData).toEqual({ title: "Hello" });
        expect("subtitle" in result.scalarData).toBe(false);
    });

    it("still writes NULL for an explicit null", () => {
        // The caller who means "clear this column" says so, and is obeyed.
        const result = serializeDataToServer(
            { title: null },
            runtimeTableOf(makeCollection("items", properties))
        );
        expect(result.scalarData).toEqual({ title: null });
    });

    it("drops an undefined value on a key the collection does not declare", () => {
        const result = serializeDataToServer(
            { title: "Hello",
trigger_populated: undefined },
            runtimeTableOf(makeCollection("items", properties))
        );
        expect("trigger_populated" in result.scalarData).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────
// sanitizeAndConvertDates — utility regression
// ─────────────────────────────────────────────────────────────
describe("sanitizeAndConvertDates", () => {
    it("converts NaN number to null", () => {
        expect(sanitizeAndConvertDates(NaN)).toBeNull();
    });

    it("leaves a string that reads 'NaN' as the text it is", () => {
        // A name, a label, a word: this pass knows no property types, so it
        // cannot tell one from a number that failed to parse.
        expect(sanitizeAndConvertDates("Nan")).toBe("Nan");
        expect(sanitizeAndConvertDates({ label: "nan" })).toEqual({ label: "nan" });
    });

    it("converts Date to ISO string", () => {
        const date = new Date("2024-01-01T00:00:00Z");
        expect(sanitizeAndConvertDates(date)).toBe("2024-01-01T00:00:00.000Z");
    });

    it("leaves text shaped like a timestamp as written", () => {
        const iso = "2024-01-01T00:00:00.123456Z";
        expect(sanitizeAndConvertDates(iso)).toBe(iso);
    });

    it("passes through non-date strings unchanged", () => {
        expect(sanitizeAndConvertDates("hello")).toBe("hello");
    });

    it("recursively sanitizes arrays", () => {
        const result = sanitizeAndConvertDates([NaN, "hello", null]);
        expect(result).toEqual([null, "hello", null]);
    });
});

// ─────────────────────────────────────────────────────────────
// getColumnMeta — type guard regression (Issue #6)
// ─────────────────────────────────────────────────────────────
import { getColumnMeta } from "../src/services/collection-helpers";

describe("getColumnMeta type guard", () => {
    it("extracts columnType, dataType, primary from a well-formed column", () => {
        const fakeCol = pgTable("t", { c: varchar("c") }).c;
        const meta = getColumnMeta(fakeCol);
        expect(meta.columnType).toBe("PgVarchar");
        expect(meta.dataType).toBe("string");
        expect(meta.primary).toBe(false);
    });

    it("returns undefined for missing properties instead of crashing", () => {
        const emptyCol: object = {};
        // Deliberately invalid: an introspected column can arrive without the fields; the guards must hold.
        const meta = getColumnMeta(emptyCol as AnyPgColumn);
        expect(meta.columnType).toBeUndefined();
        expect(meta.dataType).toBeUndefined();
        expect(meta.primary).toBeUndefined();
    });

    it("returns undefined for wrong-typed properties instead of passing them through", () => {
        const badCol: object = {
            columnType: 42, // should be string
            dataType: true, // should be string
            primary: "yes" // should be boolean
        };
        // Deliberately invalid: wrong-typed fields from an introspected column; the guards must refuse them.
        const meta = getColumnMeta(badCol as AnyPgColumn);
        expect(meta.columnType).toBeUndefined();
        expect(meta.dataType).toBeUndefined();
        expect(meta.primary).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────
// FK column preservation (Issue #5) — normalizeScalarValues
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Structural dunder guard (Issue #7) — prevent re-introduction
// ─────────────────────────────────────────────────────────────
describe("structural dunder guard", () => {
    it("scalarData never contains any __ prefixed keys", () => {
        const properties: LegacyPostgresProperties = {
            title: { type: "string",
name: "Title" },
            count: { type: "number",
name: "Count" },
            active: { type: "boolean",
name: "Active" }
        };

        const result = serializeDataToServer(
            { title: "Test",
count: 10,
active: true },
            runtimeTableOf(makeCollection("items", properties))
        );

        const dunderKeys = Object.keys(result.scalarData).filter(k => k.startsWith("__"));
        expect(dunderKeys).toEqual([]);
    });

    it("scalarData never contains any __ prefixed keys even with relation properties", () => {
        const targetCollection = makeCollection("tags", {
            label: { type: "string",
name: "Label" }
        });

        const properties: LegacyPostgresProperties = {
            title: { type: "string",
name: "Title" },
            tag: {
                type: "relation",
                name: "Tag",
                relation: {
                    kind: "belongsTo",
                    target: () => targetCollection,
                    localKey: "tag_id",
                    relationName: "tag"
                }
            }
        };

        const result = serializeDataToServer(
            { title: "Test",
tag: { id: "t1",
path: "tags",
__type: "relation" } },
            runtimeTableOf(makeCollection("items", properties))
        );

        const dunderKeys = Object.keys(result.scalarData).filter(k => k.startsWith("__"));
        expect(dunderKeys).toEqual([]);
    });
});

