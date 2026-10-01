import { describe, expect, it } from "@jest/globals";
import type { DataType, Property } from "@rebasepro/types";
import { resolveFilterOperators } from "@rebasepro/app";

import { propertiesToColumns } from "../../src/components/CollectionTableBinding/column_utils";
import { getFilterableProperties } from "../../src/components/CollectionViewBinding/FiltersDialog";

/**
 * The filters dialog and the table header decide which properties can be
 * filtered, and they used to decide it with two predicates. The dialog offered
 * `array-contains` for an array of *any* item type, so an array of maps listed
 * a "Lines" row with nothing to fill in, and an array of booleans rendered a
 * switch wired to `array-contains`; the header offered neither. Both now ask
 * the same question, so they cannot give two answers.
 */

const TYPES: DataType[] = ["string", "number", "boolean", "date", "geopoint", "reference", "relation", "array", "map", "vector", "binary"];

function propertyOf(type: DataType): Property {
    switch (type) {
        case "map":
            return { type, name: type, properties: { a: { type: "string", name: "a" } } } as Property;
        case "reference":
            return { type, name: type, path: "users" } as Property;
        case "relation":
            return { type, name: type, relation: { kind: "belongsTo", target: "users" } } as unknown as Property;
        case "array":
            return { type, name: type, of: { type: "string", name: "item" } } as Property;
        default:
            return { type, name: type } as Property;
    }
}

const header = (property: Property) => propertiesToColumns({ properties: { p: property }, sortable: true })[0]?.filter ?? false;
const dialog = (property: Property) => getFilterableProperties({ p: property }).length > 0;

describe("one answer to \"can this property be filtered\"", () => {

    for (const type of TYPES) {
        it(`${type}: the header and the dialog agree`, () => {
            const property = propertyOf(type);
            expect(dialog(property)).toBe(header(property));
        });

        it(`array of ${type}: the header and the dialog agree`, () => {
            const property = { type: "array", name: "list", of: propertyOf(type) } as Property;
            expect(dialog(property)).toBe(header(property));
        });
    }

    it("offers no filter on an array of maps, booleans or geopoints", () => {
        for (const type of ["map", "boolean", "geopoint"] as DataType[]) {
            const property = { type: "array", name: "list", of: propertyOf(type) } as Property;
            expect({ type, dialog: dialog(property), header: header(property) }).toEqual({ type, dialog: false, header: false });
            expect(resolveFilterOperators({ property: propertyOf(type), isArray: true })).toEqual([]);
        }
    });

    it("offers array-contains on an array of strings", () => {
        const property = { type: "array", name: "tags", of: propertyOf("string") } as Property;
        expect(dialog(property)).toBe(true);
        expect(header(property)).toBe(true);
    });

    it("follows the developer: no operators left is no filter, a custom filter field is one", () => {
        const narrowedAway = { type: "string", name: "code", admin: { filterOperators: [] } } as unknown as Property;
        expect(header(narrowedAway)).toBe(false);
        expect(dialog(narrowedAway)).toBe(false);

        const custom = { type: "map", name: "address", properties: {}, admin: { Filter: () => null } } as unknown as Property;
        expect(header(custom)).toBe(true);
        expect(dialog(custom)).toBe(true);
    });
});
