import { describe, it, expect } from "@jest/globals";
import { col, defineTable, json } from "@rebasepro/types";
import { generateOpenApiSpec } from "../src/api/openapi-generator";
import { compileTables } from "./helpers/tables";
import { openApiDocument, schemaOf } from "./helpers/server-b-g1-openapi";

/**
 * What the OpenAPI document states for the column rules the legacy collection
 * shape could not carry: read from the descriptor, each is now expressible.
 */
const items = defineTable("items", {
    columns: {
        id: col.text().primaryKey(),
        status: col.text({ enum: ["draft", "live"] }),
        tags: col.text().array().validate({ uniqueItems: true }),
        headline: col.jsonb(json.string().validate({ max: 5 })),
        block: col.jsonb(json.oneOf({ text: json.string(), any: json.unknown() })),
        doc: col.jsonb(json.object({ extra: json.unknown(), title: json.string().required() }))
    },
    rls: "admin-only"
});

const spec = openApiDocument(generateOpenApiSpec(compileTables([items]).descriptors));
const properties = schemaOf(spec, "Item").properties ?? {};

describe("the read schema of rules the descriptor carries", () => {
    it("states a text column's `.oneOf()` as an enum", () => {
        expect(properties.status).toMatchObject({ type: "string", enum: ["draft", "live"] });
    });

    it("states `uniqueItems`", () => {
        expect(properties.tags).toMatchObject({ type: "array", uniqueItems: true, items: { type: "string" } });
    });

    it("states a document whose top is a scalar as that scalar", () => {
        expect(properties.headline).toMatchObject({ type: "string", maxLength: 5 });
    });

    it("states a document whose top is a typed block as its variants, an untyped one open", () => {
        expect(properties.block).toMatchObject({
            oneOf: [
                { type: "object", properties: { type: { enum: ["text"] }, value: { type: "string" } }, required: ["type", "value"] },
                { type: "object", properties: { type: { enum: ["any"] }, value: {} } }
            ]
        });
    });

    it("states a `json.unknown()` field as an open schema, and a required one as required", () => {
        expect(properties.doc).toMatchObject({ type: "object", properties: { extra: {}, title: { type: "string" } }, required: ["title"] });
    });
});
