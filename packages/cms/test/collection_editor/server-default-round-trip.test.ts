import { describe, expect, it } from "@jest/globals";
import type { ColumnDescriptor } from "@rebasepro/types";
import { propertyFromColumn } from "../../src/tables";
import { wireColumnFromProperty, wireColumnOfDescriptor } from "../../src/collection_editor/property_column";

/**
 * A `.serverDefault()` column survives the schema editor.
 *
 * The panel reads `default: { kind: "server" }` as `admin.filledByServer`; the
 * editor writes the property back as a column. Without carrying the default
 * across, editing anything else about the column (its label, its validation)
 * would drop `.serverDefault()` and make the form require the field again.
 */
const slug: ColumnDescriptor = {
    key: "slug",
    column: "slug",
    type: { kind: "text" },
    nullable: false,
    unique: true,
    default: { kind: "server" }
};

describe("a .serverDefault() column in the schema editor", () => {
    it("is written back with its server default", () => {
        const property = propertyFromColumn(slug, { primaryKey: [] });
        if (!property) throw new Error("slug projected to nothing");
        const written = wireColumnFromProperty("slug", property, wireColumnOfDescriptor(slug));
        expect(written).toMatchObject({ notNull: true, unique: true, default: { kind: "server" } });
    });

    it("loses it when the form no longer says the server fills it", () => {
        const property = propertyFromColumn(slug, { primaryKey: [] });
        if (!property) throw new Error("slug projected to nothing");
        const written = wireColumnFromProperty("slug", { ...property, admin: { ...property.admin, filledByServer: false } }, wireColumnOfDescriptor(slug));
        expect(written.default).toBeUndefined();
    });
});
