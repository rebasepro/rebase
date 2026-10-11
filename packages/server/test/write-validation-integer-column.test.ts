import { CollectionConfig } from "@rebasepro/types";
import { assertWriteValuesValid, type WriteViolation } from "../src/api/rest/write-validation";

/**
 * `columnType: "integer"` without `validation.integer`: nothing checked the
 * value, and Postgres answered a fraction with 22P02, rendered as
 * `Invalid data format in "products".` with no field named.
 */
const products: CollectionConfig = {
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        id: { type: "string", isId: "uuid" },
        stock: { type: "number", columnType: "integer" },
        views: { type: "number", columnType: "bigint", validation: { min: 0 } },
        price: { type: "number", columnType: "numeric" }
    }
};

function violationsOf(values: Record<string, unknown>): WriteViolation[] {
    try {
        assertWriteValuesValid(values, products);
    } catch (error) {
        return ((error as { details?: { violations?: WriteViolation[] } }).details?.violations) ?? [];
    }
    return [];
}

describe("an integer column takes whole numbers", () => {
    it("refuses a fraction, naming the field", () => {
        expect(violationsOf({ stock: 1.5 }).map(v => [v.field, v.code])).toEqual([["stock", "integer"]]);
        expect(violationsOf({ views: 2.5 }).map(v => [v.field, v.code])).toEqual([["views", "integer"]]);
    });

    it("accepts a whole number, and a fraction in a numeric column", () => {
        expect(violationsOf({ stock: 2, views: 3, price: 1.5 })).toEqual([]);
    });
});
