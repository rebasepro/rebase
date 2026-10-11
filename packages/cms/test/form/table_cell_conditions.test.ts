/**
 * @jest-environment jsdom
 */
import type { AuthController } from "@rebasepro/cms-types";
import type { Entity, Properties, Property } from "@rebasepro/types";
import { isDisabled } from "@rebasepro/app";
import { cellValidationProperties, resolveCellProperty } from "../../src/form/resolve_cell_property";
import { getEntitySchema, mapPropertyToZod } from "../../src/form/validation";

/**
 * The table's inline cell and popup judged a value against the raw property:
 * a `conditions` rule or a `dynamicProps` validation the record form applies
 * did nothing there, so `price: -5` was refused in the form and saved from a
 * cell.
 */
const context = { path: "products", authController: { user: { uid: "u1" } } as unknown as AuthController };

const price = {
    type: "number",
    name: "Price",
    conditions: {
        min: { if: [{ "==": [{ var: "values.is_free" }, true] }, null, 0] },
        disabled: { "==": [{ var: "values.is_free" }, true] }
    }
} as unknown as Property;

const discount = {
    dynamicProps: ({ values }: { values: Record<string, unknown> }) => ({
        type: "number",
        name: "Discount",
        validation: { max: values.vip ? 50 : 10 }
    })
} as unknown as Property;

const row = (values: Record<string, unknown>): Entity<Record<string, unknown>> => ({ id: "p-1", path: "products", values });

async function cellErrors(property: Property | null, value: unknown): Promise<boolean> {
    if (!property) return false;
    const result = await mapPropertyToZod({ property, name: "field" }).safeParseAsync(value);
    return !result.success;
}

describe("an inline cell's property, resolved against its row", () => {
    it("applies a conditions rule", async () => {
        const paid = resolveCellProperty(price, "price", row({ is_free: false }), context);
        expect(await cellErrors(paid, -5)).toBe(true);
        expect(isDisabled(paid!)).toBe(false);

        const free = resolveCellProperty(price, "price", row({ is_free: true }), context);
        expect(isDisabled(free!)).toBe(true);
    });

    it("applies a dynamicProps validation", async () => {
        expect(await cellErrors(resolveCellProperty(discount, "discount", row({ vip: false }), context), 20)).toBe(true);
        expect(await cellErrors(resolveCellProperty(discount, "discount", row({ vip: true }), context), 20)).toBe(false);
    });

    it("keeps a plain property as it is, so its column schema and cells stay cached", () => {
        const plain = { type: "string", name: "Name" } as Property;
        expect(resolveCellProperty(plain, "name", row({}), context)).toBe(plain);
    });

    it("resolves once per row value", () => {
        const values = row({ is_free: false });
        expect(resolveCellProperty(price, "price", values, context)).toBe(resolveCellProperty(price, "price", values, context));
    });
});

describe("the popup's properties for a cell", () => {
    const properties = { is_free: { type: "boolean" }, price } as unknown as Properties;

    it("judge the value by the row's rules", async () => {
        const cell = cellValidationProperties(properties, "price", { is_free: false, price: -5 }, undefined, "p-1", context);
        const result = await getEntitySchema("p-1", cell).safeParseAsync({ is_free: false, price: -5 });
        expect(result.success).toBe(false);
    });

    it("leave out a field a rule disables", () => {
        expect(cellValidationProperties(properties, "price", { is_free: true, price: -5 }, undefined, "p-1", context)).toEqual({});
    });
});
