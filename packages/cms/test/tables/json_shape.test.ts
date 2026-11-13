/**
 * A `jsonb` column with a `json` shape gets the structured form built from the
 * shape: an object is a group of fields, an array repeats its item, a `oneOf`
 * in an array is a list of typed blocks, and the leaves are ordinary fields.
 */
import { describe, expect, it } from "@jest/globals";
import type { JsonShape } from "@rebasepro/types";
import type { Property } from "@rebasepro/cms-types";
import { getDefaultFieldId } from "../../src/components/field_ids";
import { propertyFromColumn } from "../../src/tables";
import { column } from "./fixtures";

const projectShape = (json: JsonShape, kind: "json" | "jsonb" = "jsonb"): Property => {
    const property = propertyFromColumn(column("doc", { kind }, { json }), { primaryKey: [] });
    if (!property) throw new Error("projected to nothing");
    return property;
};

describe("json shapes", () => {
    it("an object is a group of named fields, in declaration order", () => {
        const property = projectShape({
            kind: "object",
            fields: {
                seoTitle: { kind: "string", validate: { max: 60 }, required: true },
                canonicalUrl: { kind: "string", validate: { url: true } },
                views: { kind: "number", default: 0 },
                featured: { kind: "boolean" }
            }
        });
        expect(getDefaultFieldId(property)).toBe("group");
        expect(property).toEqual({
            type: "map",
            name: "Doc",
            columnType: "jsonb",
            propertiesOrder: ["seoTitle", "canonicalUrl", "views", "featured"],
            properties: {
                seoTitle: { type: "string", name: "Seo Title", validation: { max: 60, required: true } },
                canonicalUrl: { type: "string", name: "Canonical URL", url: true },
                views: { type: "number", name: "Views", defaultValue: 0 },
                featured: { type: "boolean", name: "Featured" }
            }
        });
    });

    it("an array repeats its item", () => {
        const property = projectShape({ kind: "array", of: { kind: "string" }, validate: { maxItems: 3 } });
        expect(getDefaultFieldId(property)).toBe("repeat");
        expect(property).toMatchObject({ type: "array", columnType: "jsonb", of: { type: "string" }, validation: { max: 3 } });
    });

    it("an array of a oneOf is typed blocks with their type and value fields", () => {
        const property = projectShape({
            kind: "array",
            of: {
                kind: "oneOf",
                typeField: "kind",
                valueField: "data",
                variants: {
                    text: { kind: "string" },
                    image: { kind: "string", storage: { path: "posts/content/", accept: ["image/*"] } }
                }
            }
        });
        expect(getDefaultFieldId(property)).toBe("block");
        expect(property).toMatchObject({
            type: "array",
            oneOf: {
                typeField: "kind",
                valueField: "data",
                propertiesOrder: ["text", "image"],
                properties: {
                    text: { type: "string", name: "Text" },
                    image: { type: "string", name: "Image", storage: { storagePath: "posts/content/", acceptedFiles: ["image/*"] } }
                }
            }
        });
    });

    it("nested storage is an upload field, nested dates are pickers, nested sets are selects", () => {
        const property = projectShape({
            kind: "object",
            fields: {
                cover: { kind: "string", storage: { path: "covers/" } },
                reviewedAt: { kind: "date" },
                stampedAt: { kind: "date", stamp: "update" },
                tier: { kind: "string", oneOf: ["free", "pro"] },
                rating: { kind: "number", oneOf: [1, 2, 3] },
                where: { kind: "geopoint" }
            }
        });
        if (property.type !== "map" || !property.properties) throw new Error("not a group");
        const fields = property.properties;
        expect(getDefaultFieldId(fields.cover)).toBe("file_upload");
        expect(getDefaultFieldId(fields.reviewedAt)).toBe("date_time");
        expect(fields.reviewedAt).toMatchObject({ type: "date", mode: "date_time" });
        expect(fields.stampedAt).toMatchObject({ autoValue: "on_update", admin: { readOnly: true } });
        expect(getDefaultFieldId(fields.tier)).toBe("select");
        expect(fields.tier).toMatchObject({ enum: [{ id: "free", label: "Free" }, { id: "pro", label: "Pro" }] });
        expect(getDefaultFieldId(fields.rating)).toBe("number_select");
        expect(getDefaultFieldId(fields.where)).toBe("geopoint");
    });

    it("objects nest", () => {
        const property = projectShape({
            kind: "object",
            fields: { address: { kind: "object", fields: { city: { kind: "string" } } } }
        }, "json");
        expect(property).toMatchObject({
            columnType: "json",
            properties: { address: { type: "map", name: "Address", properties: { city: { type: "string", name: "City" } } } }
        });
    });

    it("a lone oneOf and an unknown value fall back to the free-form editor", () => {
        expect(getDefaultFieldId(projectShape({ kind: "unknown" }))).toBe("key_value");
        expect(getDefaultFieldId(projectShape({ kind: "oneOf", typeField: "type", valueField: "value", variants: { a: { kind: "string" } } })))
            .toBe("key_value");
    });

    it("a node's description is its help text", () => {
        const property = projectShape({ kind: "object", fields: { a: { kind: "string", description: "Shown under the field" } } });
        expect(property).toMatchObject({ properties: { a: { description: "Shown under the field" } } });
    });
});
