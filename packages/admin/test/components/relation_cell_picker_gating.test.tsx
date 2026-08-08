/**
 * @jest-environment jsdom
 */
import { describe, expect, it } from "@jest/globals";
import { NumberProperty, Property, RelationProperty, StringProperty } from "@rebasepro/types";

/**
 * A table cell is not an open picker.
 *
 * `getTableBindingForProperty` decides what a cell renders, and it is called
 * once per visible row. The number and string editors are gated on the cell
 * being `selected` for exactly that reason; the relation branch was not, so an
 * inline `RelationSelector` — which fetches the *target* collection on mount,
 * or subscribes to it where the client has a socket — was mounted for every
 * row of every table with a relation column. Nothing of what it loaded was
 * shown until someone clicked a cell.
 *
 * Inline editing is on by default, so this was the ordinary case, not an
 * unusual configuration.
 */

import {
    getTableBindingForProperty
} from "../../src/components/CollectionTableBinding/table_bindings";

const relationProperty = {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => ({ slug: "tags" }) }
} as unknown as RelationProperty;

const dialogRelationProperty = {
    ...relationProperty,
    admin: { widget: "dialog" }
} as unknown as RelationProperty;

describe("the relation cell only mounts its picker when the cell is selected", () => {

    it("renders no editor for an unselected relation cell", () => {
        expect(getTableBindingForProperty(relationProperty as Property, false)).toBeUndefined();
    });

    it("renders the inline picker once the cell is selected", () => {
        const binding = getTableBindingForProperty(relationProperty as Property, true);
        expect(binding).toBeDefined();
        expect(typeof binding!.Component).toBe("function");
    });

    it("gates the relation cell exactly like the number and string cells beside it", () => {
        // The comparison the finding rests on: these two were already gated,
        // and the relation branch sat one block below them ungated.
        const number = { type: "number" } as NumberProperty;
        const string = { type: "string" } as StringProperty;
        expect(getTableBindingForProperty(number, false)).toBeUndefined();
        expect(getTableBindingForProperty(string, false)).toBeUndefined();
        expect(getTableBindingForProperty(number, true)).toBeDefined();
        expect(getTableBindingForProperty(string, true)).toBeDefined();
    });

    it("still renders the dialog widget unselected, which opens nothing on mount", () => {
        // The dialog variant is a button plus a preview: it reads no list until
        // the dialog is opened, so it is left as it was.
        expect(getTableBindingForProperty(dialogRelationProperty as Property, false)).toBeDefined();
    });
});
