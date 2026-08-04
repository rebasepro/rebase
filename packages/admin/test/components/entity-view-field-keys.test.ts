import type { AdminCollection } from "@rebasepro/admin-types";
import { readOnlyFieldKeys } from "../../src/components/EntityViewBinding";

/**
 * The read-only record shares the form's layout resolver, so it has to hand it
 * the same field list — with one exception.
 *
 * An `additionalFields` entry is a component the developer supplies, and it is
 * handed a form context. The delete dialog renders a record with no context at
 * all, so those entries cannot render there. The resolver gives every one of
 * them a full row, so dropping them at render time rather than here leaves an
 * empty row where the card should be.
 */
const collection = (
    properties: Record<string, unknown>,
    extra: Record<string, unknown> = {}
) => ({
    name: "Products",
    singularName: "Product",
    slug: "products",
    properties,
    ...extra
} as unknown as AdminCollection);

describe("readOnlyFieldKeys", () => {

    it("keeps the additional fields when there is a context to render them with", () => {
        const c = collection(
            { name: { type: "string" } },
            { additionalFields: [{ key: "margin", name: "Margin", Builder: () => null }] }
        );
        expect(readOnlyFieldKeys(c, true)).toEqual(["name", "margin"]);
    });

    it("drops the additional fields when there is not", () => {
        const c = collection(
            { name: { type: "string" } },
            { additionalFields: [{ key: "margin", name: "Margin", Builder: () => null }] }
        );
        expect(readOnlyFieldKeys(c, false)).toEqual(["name"]);
    });

    it("drops them out of a configured order too, keeping the rest in place", () => {
        const c = collection(
            {
                name: { type: "string" },
                sku: { type: "string" }
            },
            {
                additionalFields: [{ key: "margin", name: "Margin", Builder: () => null }],
                propertiesOrder: ["sku", "margin", "name"]
            }
        );
        expect(readOnlyFieldKeys(c, false)).toEqual(["sku", "name"]);
        expect(readOnlyFieldKeys(c, true)).toEqual(["sku", "margin", "name"]);
    });

    it("is the plain property list when the collection declares no additional fields", () => {
        const c = collection({
            name: { type: "string" },
            price: { type: "number" }
        });
        expect(readOnlyFieldKeys(c, false)).toEqual(["name", "price"]);
        expect(readOnlyFieldKeys(c, true)).toEqual(["name", "price"]);
    });
});
