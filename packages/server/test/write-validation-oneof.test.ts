import { CollectionConfig } from "@rebasepro/types";
import { assertWriteValuesValid, type WriteViolation } from "../src/api/rest/write-validation";

/**
 * A `oneOf` array (blocks) declares one property per block type, and each
 * block's value is published under that property's rules. Only `of` items
 * were checked, so a heading capped at 10 characters stored 40 and a price
 * with `min: 0` stored -5.
 */
const pages: CollectionConfig = {
    slug: "pages",
    name: "Pages",
    table: "pages",
    properties: {
        id: { type: "string", isId: "uuid" },
        blocks: {
            type: "array",
            oneOf: {
                properties: {
                    heading: { type: "string", validation: { max: 10 } },
                    price: { type: "number", validation: { min: 0 } }
                }
            }
        },
        custom: {
            type: "array",
            oneOf: {
                typeField: "kind",
                valueField: "data",
                properties: {
                    heading: { type: "string", validation: { max: 3 } }
                }
            }
        }
    }
};

function violationsOf(values: Record<string, unknown>): WriteViolation[] {
    try {
        assertWriteValuesValid(values, pages);
    } catch (error) {
        return ((error as { details?: { violations?: WriteViolation[] } }).details?.violations) ?? [];
    }
    return [];
}

describe("oneOf block values follow their own rules", () => {
    it("accepts valid blocks", () => {
        expect(violationsOf({ blocks: [{ type: "heading", value: "Hello" }, { type: "price", value: 4 }] })).toEqual([]);
    });

    it("refuses a block value that breaks its type's rules, at the block's value path", () => {
        const fields = violationsOf({
            blocks: [
                { type: "heading", value: "x".repeat(40) },
                { type: "price", value: -5 },
                { type: "heading", value: "ok" }
            ]
        }).map(v => v.field);
        expect(fields).toEqual(["blocks[0].value", "blocks[1].value"]);
    });

    it("reads a custom typeField and valueField", () => {
        expect(violationsOf({ custom: [{ kind: "heading", data: "long" }] }).map(v => v.field)).toEqual(["custom[0].data"]);
    });

    it("leaves an undeclared block type and a non-object item to the database", () => {
        expect(violationsOf({ blocks: [{ type: "gallery", value: "x".repeat(40) }, "loose", null] })).toEqual([]);
    });
});
