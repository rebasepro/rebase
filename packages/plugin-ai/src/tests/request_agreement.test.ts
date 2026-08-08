import { Properties } from "@rebasepro/types";
import { getValueInPath } from "@rebasepro/utils";

import { getSimplifiedProperties } from "../utils/properties";
import { flatMapEntityValues, omitDisabledValues } from "../utils/values";
import { InputProperty } from "../types/data_enhancement_controller";

/**
 * The two halves of an autofill request have to be keyed the same way.
 *
 * "Autofill only fills blanks" is not enforced anywhere in this package. It is
 * enforced on the service, by omitting already-filled fields from the JSON
 * schema the model answers into — and the service decides a field is filled by
 * looking up `values[key]` for each `key` of `properties`. So the guard is only
 * as true as the agreement between the two maps this file checks.
 *
 * That is why these tests build *both* maps from one record and then replay the
 * service's own decision over them, rather than testing either map alone. Every
 * assertion here passed against a client that flattened `tags: ["a","b"]` into
 * `tags.0`/`tags.1` and dropped `Date` values entirely — as long as it was the
 * flattener, or the property map, that was looked at in isolation.
 *
 * `getFieldId` is mocked deterministically; the real one resolves against the
 * admin field registry, which is not what is under test.
 */
jest.mock("@rebasepro/admin", () => ({
    getFieldId: (property: { type?: string }) => {
        if (!property?.type) return undefined;
        if (property.type === "string") return "text_field";
        if (property.type === "number") return "number_field";
        if (property.type === "boolean") return "switch";
        if (property.type === "date") return "date_time";
        return undefined;
    }
}));

// ---------------------------------------------------------------------------
// The service's side of the contract, reproduced.
//
// Copied from `saas/backend/functions/ai.ts` (`alreadyFilled`, `scalarSchema`,
// `propertySchema`, `planFill`). It lives in another repository and cannot be
// imported, so it is mirrored — and mirrored *including* the JSON round trip,
// because the difference between a `Date` object and the ISO string a `Date`
// serialises to is exactly the difference between "this field is empty" and
// "this field is filled" over there.
// ---------------------------------------------------------------------------

function alreadyFilled(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as object).length > 0;
    return true;
}

function scalarSchema(property: InputProperty): object | undefined {
    if (property.enum && property.enum.length > 0) return { type: "string",
enum: property.enum };
    switch (property.type) {
        case "string":
            return { type: "string" };
        case "number":
            return { type: "number" };
        case "boolean":
            return { type: "boolean" };
        case "date":
            return { type: "string",
format: "date-time" };
        default:
            return undefined;
    }
}

function propertySchema(property: InputProperty): object | undefined {
    if (property.disabled) return undefined;
    if (property.type === "array") {
        const items = property.of ? scalarSchema(property.of) : undefined;
        return items ? { type: "array",
items } : undefined;
    }
    return scalarSchema(property);
}

/** The keys the service would offer the model, given one request body. */
function plannedFillKeys(request: { properties: Record<string, InputProperty>, values: Record<string, unknown> }): string[] {
    // As the service receives it: JSON, not the client's live objects.
    const values = JSON.parse(JSON.stringify(request.values)) as Record<string, unknown>;
    return Object.entries(request.properties)
        .filter(([key, property]) => {
            if (!property || typeof property !== "object") return false;
            if (alreadyFilled(values[key])) return false;
            return Boolean(propertySchema(property));
        })
        .map(([key]) => key);
}

/** What the client puts on the wire, built the way the provider builds it. */
function requestFor(properties: Properties, record: Record<string, unknown>) {
    const simplified = getSimplifiedProperties(properties, record);
    return {
        properties: simplified,
        values: omitDisabledValues(flatMapEntityValues(record), simplified)
    };
}

const POST_PROPERTIES: Properties = {
    title: { name: "Title",
type: "string" },
    summary: { name: "Summary",
type: "string" },
    tags: {
        name: "Tags",
        type: "array",
        of: { name: "Tag",
type: "string" }
    },
    published_at: { name: "Published at",
type: "date" },
    seo: {
        name: "SEO",
        type: "map",
        properties: {
            title: { name: "SEO title",
type: "string" },
            description: { name: "SEO description",
type: "string" }
        }
    },
    internal_notes: {
        name: "Internal notes",
        type: "string",
        admin: { readOnly: true }
    }
} as Properties;

/** A published post: five tags, a publication date, one genuinely empty field. */
const PUBLISHED_POST = {
    title: "Hello",
    tags: ["news", "launch"],
    published_at: new Date("2026-01-01T00:00:00.000Z"),
    seo: { title: "Hello — SEO" },
    internal_notes: "written by a backend hook"
};

describe("the request the client sends", () => {

    it("keys an array and a date exactly as the property map names them", () => {
        const { properties, values } = requestFor(POST_PROPERTIES, PUBLISHED_POST);

        expect(Object.keys(properties)).toEqual(expect.arrayContaining(["tags", "published_at"]));
        expect(values.tags).toEqual(["news", "launch"]);
        expect(values.published_at).toEqual(new Date("2026-01-01T00:00:00.000Z"));
        // The whole key set, because the old shapes — `tags.0`, `tags.1`, and no
        // `published_at` at all — are absences a per-key assertion would miss.
        expect(Object.keys(values).sort()).toEqual(["published_at", "seo.title", "tags", "title"]);
    });

    it("still descends into a map, which is the one container with its own fields", () => {
        const { properties, values } = requestFor(POST_PROPERTIES, PUBLISHED_POST);
        expect(Object.keys(properties)).toContain("seo.title");
        expect(values["seo.title"]).toBe("Hello — SEO");
    });

    it("offers the model only the fields that are actually empty", () => {
        // The whole invariant, end to end. `tags` and `published_at` used to be
        // in this list, so a populated tag list and a set publication date
        // arrived in the review pre-ticked for replacement.
        expect(plannedFillKeys(requestFor(POST_PROPERTIES, PUBLISHED_POST)))
            .toEqual(["summary", "seo.description"]);
    });

    it("offers every field of an empty record", () => {
        // The other direction: the agreement must not be bought by hiding
        // fillable fields. `internal_notes` is absent because it is read-only,
        // and `seo` because a map is a container, not a field.
        expect(plannedFillKeys(requestFor(POST_PROPERTIES, {})))
            .toEqual(["title", "summary", "tags", "published_at", "seo.title", "seo.description"]);
    });

    it("carries a value for every fillable property the record has filled", () => {
        // The drift check, stated as a rule rather than a list: whatever a
        // future property type does to either map, a value the operator can see
        // in the form must reach the service under the key the service will
        // look it up by.
        const { properties, values } = requestFor(POST_PROPERTIES, PUBLISHED_POST);
        const onTheWire = JSON.parse(JSON.stringify(values)) as Record<string, unknown>;

        for (const [key, property] of Object.entries(properties)) {
            if (!propertySchema(property)) continue; // not a field the service fills
            if (!alreadyFilled(getValueInPath(PUBLISHED_POST, key))) continue;
            expect({ key,
filled: alreadyFilled(onTheWire[key]) }).toEqual({ key,
filled: true });
        }
    });

    it("does not transmit the value of a read-only property", () => {
        // `disabled` already means "the service may not fill this". It has to
        // mean "and it is not context either": the prompt includes every value
        // it is given, so a field owned by a backend hook was being pasted into
        // it verbatim.
        const { values } = requestFor(POST_PROPERTIES, PUBLISHED_POST);
        expect(values).not.toHaveProperty("internal_notes");
        expect(JSON.stringify(values)).not.toContain("backend hook");
    });

    it("takes the children of a disabled map with it", () => {
        const properties = {
            audit: {
                name: "Audit",
                type: "map",
                admin: { disabled: true },
                properties: {
                    author: { name: "Author",
type: "string" }
                }
            }
        } as Properties;
        const { values } = requestFor(properties, { audit: { author: "root" } });
        expect(values).toEqual({});
    });
});

describe("omitDisabledValues", () => {

    it("leaves a record alone when nothing is disabled", () => {
        const values = { a: 1,
b: 2 };
        expect(omitDisabledValues(values, { a: { type: "number",
fieldConfigId: "number_field" } })).toBe(values);
    });

    it("survives a property map carrying a non-object at a path", () => {
        // `getSimplifiedProperty` writes a raw type string at
        // `${path}.${i}.${typeField}` for `oneOf` arrays, and `"disabled" in
        // aString` throws.
        const properties = { "blocks.0.type": "images" } as unknown as Record<string, InputProperty>;
        expect(() => omitDisabledValues({ "blocks.0.type": "images" }, properties)).not.toThrow();
    });
});
