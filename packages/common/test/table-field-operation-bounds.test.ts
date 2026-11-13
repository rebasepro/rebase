import { describe, expect, it } from "@jest/globals";
import { col, defineTable, json } from "@rebasepro/types";
import type { ColumnDescriptor } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import { fieldOperationBounds } from "../src/table/field-operation-bounds";

/**
 * The bounds a field operation's result must keep, read from `.validate()`.
 */

const items = defineTable("items", {
    columns: {
        id: col.integer().primaryKey(),
        stock: col.integer().validate({ min: 0, max: 10, integer: true }),
        rating: col.doublePrecision().validate({ moreThan: 0, lessThan: 5, positive: true }),
        plain: col.integer(),
        tags: col.text().array().validate({ minItems: 1, maxItems: 3, uniqueItems: true }),
        blocks: col.jsonb(json.array(json.string()).validate({ maxItems: 2 })),
        unique: col.text().array().validate({ uniqueItems: true }),
        title: col.text().validate({ min: 1, max: 80 }),
        meta: col.jsonb(json.object({ a: json.string() }))
    },
    rls: "admin-only"
});

const [table] = compileTables([items]);

function column(key: string): ColumnDescriptor {
    const found = table?.columns.find(candidate => candidate.key === key);
    if (!found) throw new Error(`items has no column ${key}`);
    return found;
}

describe("fieldOperationBounds", () => {
    it("states a numeric column's range, not its integer rule", () => {
        expect(fieldOperationBounds(column("stock"))).toEqual({ kind: "number", min: 0, max: 10 });
        expect(fieldOperationBounds(column("rating"))).toEqual({ kind: "number", moreThan: 0, lessThan: 5, positive: true });
    });

    it("states a list's size bounds, native or JSON, not its uniqueness", () => {
        expect(fieldOperationBounds(column("tags"))).toEqual({ kind: "array", minItems: 1, maxItems: 3 });
        expect(fieldOperationBounds(column("blocks"))).toEqual({ kind: "array", maxItems: 2 });
        expect(fieldOperationBounds(column("unique"))).toBeUndefined();
    });

    it("has nothing for a column without bounds, or one no operator changes", () => {
        expect(fieldOperationBounds(column("plain"))).toBeUndefined();
        expect(fieldOperationBounds(column("title"))).toBeUndefined();
        expect(fieldOperationBounds(column("meta"))).toBeUndefined();
    });
});
