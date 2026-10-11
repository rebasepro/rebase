/**
 * @jest-environment jsdom
 */
import { getEntitySchema } from "../../src/form/validation";
import type { Properties } from "@rebasepro/types";

/**
 * A `oneOf` array (blocks) declares a property per block type. Each block's
 * value answers to that property's rules, exactly as an `of` item answers to
 * `of`. The schema used to be `z.array(z.any())`, so a 40-character heading
 * capped at 10, an empty required heading and a negative price all saved.
 */
const properties: Properties = {
    blocks: {
        type: "array",
        name: "Blocks",
        oneOf: {
            properties: {
                heading: { type: "string", name: "Heading", validation: { required: true, max: 10 } },
                price: { type: "number", name: "Price", validation: { min: 0 } }
            }
        }
    },
    custom: {
        type: "array",
        name: "Custom",
        oneOf: {
            typeField: "kind",
            valueField: "data",
            properties: {
                heading: { type: "string", name: "Heading", validation: { max: 3 } }
            }
        }
    }
};

async function errorPaths(values: Record<string, unknown>): Promise<string[]> {
    const schema = getEntitySchema("id", properties);
    const result = await schema.safeParseAsync(values);
    if (result.success) return [];
    return result.error.issues.map(issue => issue.path.join("."));
}

describe("oneOf block validation", () => {
    it("accepts blocks that follow their own rules", async () => {
        expect(await errorPaths({
            blocks: [{ type: "heading", value: "Hello" }, { type: "price", value: 3 }]
        })).toEqual([]);
    });

    it("judges each block's value against the property its type names", async () => {
        expect(await errorPaths({
            blocks: [
                { type: "heading", value: "x".repeat(40) },
                { type: "heading", value: "" },
                { type: "price", value: -5 },
                { type: "heading", value: "fine" }
            ]
        })).toEqual(["blocks.0.value", "blocks.1.value", "blocks.2.value"]);
    });

    it("reads a custom typeField and valueField", async () => {
        expect(await errorPaths({
            custom: [{ kind: "heading", data: "long" }]
        })).toEqual(["custom.0.data"]);
    });

    it("leaves a block of an undeclared type alone", async () => {
        expect(await errorPaths({
            blocks: [{ type: "gallery", value: "anything" }, null]
        })).toEqual([]);
    });
});
