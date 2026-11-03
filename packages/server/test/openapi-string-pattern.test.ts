import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";

/**
 * A string's `validation.matches` as the spec's `pattern`.
 *
 * A JSON Schema pattern is a regex's source: no slashes, no flags. The spec
 * wrote `String(matches)`, so `/^[A-Z]{3}$/` became the pattern `/^[A-Z]{3}$/`
 * — slashes a value had to contain — and a client generated from the spec
 * refused every value the server accepts.
 */
const codes = {
    slug: "codes", name: "Codes", singularName: "Code", table: "codes",
    properties: {
        id: { type: "string", isId: true },
        literal: { type: "string", validation: { matches: /^[A-Z]{3}$/ } },
        serialized: { type: "string", validation: { matches: "/^[A-Z]{3}$/" } },
        plain: { type: "string", validation: { matches: "^[0-9]+$" } },
        caseless: { type: "string", validation: { matches: /^[a-z]{2}$/i } }
    }
} as unknown as CollectionConfig;

function propertySchemas(): Record<string, { pattern?: string }> {
    const spec = generateOpenApiSpec([codes]) as { components: { schemas: Record<string, { properties?: Record<string, { pattern?: string }> }> } };
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
