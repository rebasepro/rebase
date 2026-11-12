import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";
import { openApiDocument, type JsonSchema } from "./helpers/server-b-g1-openapi";
import { tablesFromCollections } from "./helpers/tables";

/**
 * A string's `validation.matches` as the spec's `pattern`.
 *
 * A JSON Schema pattern is a regex's source: no slashes, no flags. The spec
 * wrote `String(matches)`, so `/^[A-Z]{3}$/` became the pattern `/^[A-Z]{3}$/`
 * — slashes a value had to contain — and a client generated from the spec
 * refused every value the server accepts.
 */
const codes: CollectionConfig = {
    slug: "codes", name: "Codes", singularName: "Code", table: "codes",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        literal: { name: "Literal", type: "string", validation: { matches: /^[A-Z]{3}$/ } },
        serialized: { name: "Serialized", type: "string", validation: { matches: "/^[A-Z]{3}$/" } },
        plain: { name: "Plain", type: "string", validation: { matches: "^[0-9]+$" } },
        caseless: { name: "Caseless", type: "string", validation: { matches: /^[a-z]{2}$/i } }
    }
};

function propertySchemas(): Record<string, JsonSchema> {
    const spec = openApiDocument(generateOpenApiSpec(tablesFromCollections([codes]).descriptors));
    const schema = Object.values(spec.components.schemas).find(s => s.properties?.literal);
    if (!schema?.properties) throw new Error("no schema holds the codes properties");
    return schema.properties;
}

describe("a string's matches in the OpenAPI spec", () => {
    it("is the regex's source, however the config spells it", () => {
        const properties = propertySchemas();
        expect(properties.literal.pattern).toBe("^[A-Z]{3}$");
        expect(properties.serialized.pattern).toBe("^[A-Z]{3}$");
        expect(properties.plain.pattern).toBe("^[0-9]+$");
    });

    it("is left out when a flag changes what the source matches", () => {
        expect(propertySchemas().caseless.pattern).toBeUndefined();
    });
});
