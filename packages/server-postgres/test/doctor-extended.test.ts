/**
 * `expectedDataType`: the `information_schema.columns.data_type` the doctor
 * expects for each column type a table can declare.
 *
 * One row per `ColumnType` member, read through the planner's own `pgTypeOf`,
 * so the doctor never keeps a second reading of what a column compiles to.
 * (This file used to walk the legacy property options — `isId`, `columnType`,
 * `validation.integer` — one by one; turning those into column types is the
 * lift's job now, tested with the lift.)
 */
import type { ColumnType } from "@rebasepro/types";
import { expectedDataType } from "../src/schema/doctor";

const CASES: Array<[string, ColumnType, string | null]> = [
    ["text", { kind: "text" }, "text"],
    ["varchar", { kind: "varchar", length: 255 }, "character varying"],
    ["char", { kind: "char", length: 2 }, "character"],
    ["uuid", { kind: "uuid" }, "uuid"],
    ["enum", { kind: "enum", values: ["active", "inactive"] }, "USER-DEFINED"],
    ["shared enum", { kind: "enum", values: ["a"], name: "status" }, "USER-DEFINED"],
    ["smallint", { kind: "smallint" }, "smallint"],
    ["integer", { kind: "integer" }, "integer"],
    ["bigint", { kind: "bigint" }, "bigint"],
    // A serial is an integer with a sequence default; the catalogue reports the width.
    ["smallserial", { kind: "smallserial" }, "smallint"],
    ["serial", { kind: "serial" }, "integer"],
    ["bigserial", { kind: "bigserial" }, "bigint"],
    ["real", { kind: "real" }, "real"],
    ["doublePrecision", { kind: "doublePrecision" }, "double precision"],
    ["numeric", { kind: "numeric" }, "numeric"],
    ["numeric(10,2)", { kind: "numeric", precision: 10, scale: 2 }, "numeric"],
    ["boolean", { kind: "boolean" }, "boolean"],
    ["timestamptz", { kind: "timestamptz" }, "timestamp with time zone"],
    ["date", { kind: "date" }, "date"],
    ["time", { kind: "time" }, "time without time zone"],
    ["json", { kind: "json" }, "json"],
    ["jsonb", { kind: "jsonb" }, "jsonb"],
    ["vector", { kind: "vector", dimensions: 1536 }, "USER-DEFINED"],
    ["bytea", { kind: "bytea" }, "bytea"],
    ["text[]", { kind: "array", of: { kind: "text" } }, "ARRAY"],
    ["integer[]", { kind: "array", of: { kind: "integer" } }, "ARRAY"],
    ["boolean[]", { kind: "array", of: { kind: "boolean" } }, "ARRAY"],
    // `col.custom()`: its data_type is the catalogue's own name for the type,
    // compared by the boot diff through format_type instead.
    ["custom", { kind: "other", sqlType: "inet" }, null]
];

describe("expectedDataType", () => {
    it.each(CASES)("%s", (_label, type, expected) => {
        expect(expectedDataType(type)).toBe(expected);
    });

    it("has nothing to compare for a type the planner refuses", () => {
        // An array of documents is refused by the planner, with a message; the
        // doctor does not invent a type mismatch on top of it.
        expect(expectedDataType({ kind: "array", of: { kind: "jsonb" } })).toBeNull();
        // An enum with no labels names a type nothing creates.
        expect(expectedDataType({ kind: "enum", values: [] })).toBeNull();
    });
});
