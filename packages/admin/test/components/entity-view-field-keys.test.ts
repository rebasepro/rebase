import type { AdminCollection } from "@rebasepro/admin-types";
import { readOnlyFieldKeys } from "../../src/components/EntityViewBinding";
import { HEADER_DISPLAY_ROLES } from "../../src/components/EntityDisplayHeader";

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

    /* ---- the display header ------------------------------------------------ */

    it("drops the properties the display header has already rendered", () => {
        const c = collection({
            name: { type: "string" },
            status: { type: "string" },
            price: { type: "number" }
        });
        expect(readOnlyFieldKeys(c, false, new Set(["name", "status"])))
            .toEqual(["price"]);
    });

    it("leaves the grid alone when the header rendered nothing", () => {
        const c = collection({
            name: { type: "string" },
            price: { type: "number" }
        });
        // A collection with no `admin.display` block resolves no property for
        // any header role but the title, so the empty set is the common case and
        // must not be a special case.
        expect(readOnlyFieldKeys(c, false, new Set())).toEqual(["name", "price"]);
        expect(readOnlyFieldKeys(c, false, undefined)).toEqual(["name", "price"]);
    });

    it("drops header keys and context-less additional fields together", () => {
        const c = collection(
            {
                name: { type: "string" },
                price: { type: "number" }
            },
            { additionalFields: [{ key: "margin", name: "Margin", Builder: () => null }] }
        );
        expect(readOnlyFieldKeys(c, false, new Set(["name"]))).toEqual(["price"]);
        expect(readOnlyFieldKeys(c, true, new Set(["name"]))).toEqual(["price", "margin"]);
    });

    it("never lets the header consume the title or the date", () => {
        // The heading above a record and a labelled field are different things.
        // `Order #` is a column with a name and a description that someone opens
        // the record to read; `ORD-2026-0040` in the identity bar names the page.
        // Dropping the field because its text also appears in the breadcrumb
        // takes a value out of the record on the grounds that it is legible
        // somewhere else — which is how `Order #` went missing.
        expect(HEADER_DISPLAY_ROLES).not.toContain("title");
        // Same for the date: the record block carries the timestamps, and a
        // business date belongs in the field its collection declared.
        expect(HEADER_DISPLAY_ROLES).not.toContain("date");
        expect([...HEADER_DISPLAY_ROLES].sort())
            .toEqual(["image", "status", "subtitle", "tags"]);
    });

    it("ignores a header key naming a property the collection does not have", () => {
        const c = collection({ name: { type: "string" } });
        // A `display` role filled by a resolver has no key at all, and a stale
        // one names a column that was dropped. Neither may remove a field that
        // is not the one it names.
        expect(readOnlyFieldKeys(c, false, new Set(["gone"]))).toEqual(["name"]);
    });
});
