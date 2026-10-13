import { describe, it, expect } from "@jest/globals";
import { typedJsonRows } from "./sql_utils";

/**
 * The console's values are the database's text (psql-style), so a value
 * written back is the value that was read. "Export JSON" writes that text —
 * `"42"`, `"t"`, `"{\"a\":1}"` — which a script reading the file has to parse
 * again. "Export typed JSON" reads each value by its column's type: numbers
 * that a double holds exactly, booleans, and json as JSON; anything else, and
 * any value that would change on the way, stays the text it was.
 */
describe("typed JSON rows", () => {
    const columns = [
        { name: "id", type: "integer" },
        { name: "big", type: "bigint" },
        { name: "price", type: "numeric(10,2)" },
        { name: "ratio", type: "double precision" },
        { name: "active", type: "boolean" },
        { name: "meta", type: "jsonb" },
        { name: "raw", type: "json" },
        { name: "tags", type: "text[]" },
        { name: "at", type: "timestamp with time zone" },
        { name: "note", type: "text" }
    ];

    it("reads numbers, booleans and json by type, and keeps the rest as text", () => {
        expect(typedJsonRows([{
            id: "42",
            big: "9007199254740993",
            price: "19.90",
            ratio: "0.5",
            active: "t",
            meta: "{\"a\": [1, 2]}",
            raw: "[true]",
            tags: "{a,b}",
            at: "2026-01-05 10:00:00+00",
            note: "42"
        }], columns)).toEqual([{
            id: 42,
            big: "9007199254740993",
            price: 19.9,
            ratio: 0.5,
            active: true,
            meta: { a: [1, 2] },
            raw: [true],
            tags: "{a,b}",
            at: "2026-01-05 10:00:00+00",
            note: "42"
        }]);
    });

    it("keeps NULL as null and false as false", () => {
        expect(typedJsonRows([{ id: null, active: "f" }], columns)).toEqual([{ id: null, active: false }]);
    });

    it("keeps a number a double cannot hold exactly as its text", () => {
        expect(typedJsonRows([{ price: "12345678901234567.89" }, { ratio: "NaN" }, { ratio: "1e+21" }, { id: "x" }], columns))
            .toEqual([{ price: "12345678901234567.89" }, { ratio: "NaN" }, { ratio: 1e21 }, { id: "x" }]);
    });

    it("leaves a value of a column with no type as it came", () => {
        expect(typedJsonRows([{ x: 1, y: "t" }], [{ name: "x" }, { name: "y" }])).toEqual([{ x: 1, y: "t" }]);
    });
});
