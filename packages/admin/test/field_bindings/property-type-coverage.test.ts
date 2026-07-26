import type { Property } from "@rebasepro/types";

import { DEFAULT_FIELD_CONFIGS, getDefaultFieldId } from "../../src/components/field_configs";
import { supportedFieldsIds } from "../../src/collection_editor/ui/collection_editor/utils/supported_fields";
import { updatePropertyFromWidget } from "../../src/collection_editor/ui/collection_editor/utils/update_property_for_widget";

/**
 * Every property type the model defines must reach a widget, and every widget
 * offered in the picker must exist.
 *
 * `geopoint` used to reach nothing at all: it was absent from the widget lookup
 * chain, so the lookup fell off the end, logged to the console and returned
 * undefined — the field never rendered on a form, and the property dialog
 * opened blank. `binary` reached `text_field`, which renders a string input and
 * whose editor merges `type: "string"`, so touching its widget rewrote the
 * property's type.
 */

/** Every `type` a Property can have. */
const ALL_PROPERTY_TYPES = [
    "string", "number", "boolean", "date", "map", "array",
    "geopoint", "reference", "relation", "vector", "binary"
] as const;

const sample = (type: string): Property => {
    switch (type) {
        case "array": return { type: "array", of: { type: "string" } } as unknown as Property;
        case "map": return { type: "map", properties: {} } as unknown as Property;
        case "vector": return { type: "vector", dimensions: 3 } as unknown as Property;
        default: return { type } as unknown as Property;
    }
};

describe("every property type reaches a widget", () => {
    it.each(ALL_PROPERTY_TYPES)("%s resolves to a registered widget", (type) => {
        const id = getDefaultFieldId(sample(type));
        expect(id).toBeDefined();
        expect(DEFAULT_FIELD_CONFIGS[id as keyof typeof DEFAULT_FIELD_CONFIGS]).toBeDefined();
    });

    it("routes geopoint and binary to their own widgets, not to a text field", () => {
        expect(getDefaultFieldId(sample("geopoint"))).toBe("geopoint");
        expect(getDefaultFieldId(sample("binary"))).toBe("binary");
    });

    it("gives geopoint and binary a field component to render", () => {
        for (const id of ["geopoint", "binary"] as const) {
            expect(DEFAULT_FIELD_CONFIGS[id].property.admin?.Field).toBeDefined();
        }
    });
});

describe("the widget picker", () => {
    it("offers only widgets that exist", () => {
        for (const id of supportedFieldsIds) {
            expect(DEFAULT_FIELD_CONFIGS[id as keyof typeof DEFAULT_FIELD_CONFIGS]).toBeDefined();
        }
    });

    it("can create every property type it can render", () => {
        // A type that renders but cannot be picked is a type you can only get
        // by writing code — which was true of vector, geopoint and binary.
        for (const type of ALL_PROPERTY_TYPES) {
            const id = getDefaultFieldId(sample(type));
            expect(supportedFieldsIds).toContain(id);
        }
    });
});

describe("changing a property's widget", () => {
    it("sets the type the widget is for", () => {
        const updated = updatePropertyFromWidget(
            { name: "Where", type: "string" },
            "geopoint",
            DEFAULT_FIELD_CONFIGS as never
        );
        expect(updated.type).toBe("geopoint");
    });

    it("keeps the name, description and column across the change", () => {
        // The generic branch used to return the config's property alone, which
        // blanked the label of any property switched to one of these widgets.
        const updated = updatePropertyFromWidget(
            { name: "Where", description: "Office location", columnName: "office_at", type: "string" },
            "geopoint",
            DEFAULT_FIELD_CONFIGS as never
        );
        expect(updated).toMatchObject({
            type: "geopoint",
            name: "Where",
            description: "Office location",
            columnName: "office_at"
        });
    });

    it("does not carry a previous type's settings onto the new one", () => {
        const updated = updatePropertyFromWidget(
            { name: "Status", type: "string", enum: [{ id: "a", label: "A" }] },
            "binary",
            DEFAULT_FIELD_CONFIGS as never
        );
        expect(updated.type).toBe("binary");
        expect(updated).not.toHaveProperty("enum");
    });
});

describe("a relation inside an array", () => {
    it("reports the problem instead of throwing during render", () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const arrayOfRelations = { type: "array", of: { type: "relation" } } as unknown as Property;

        // Used to throw, which took down the property dialog via the error
        // boundary rather than saying which property was at fault.
        expect(() => getDefaultFieldId(arrayOfRelations)).not.toThrow();
        expect(getDefaultFieldId(arrayOfRelations)).toBeUndefined();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("a relation is a join"), expect.anything());

        spy.mockRestore();
    });
});
