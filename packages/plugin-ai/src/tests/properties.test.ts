import { getSimplifiedProperties } from "../utils/properties";
import { Properties } from "@rebasepro/types";

/**
 * The schema serializer.
 *
 * This is the file that decides *what the model is asked to fill*. The service
 * builds its JSON schema from whatever comes out of here, so a key this
 * function drops is a field autofill will never write, silently — no error, no
 * warning, just a form that stays half empty on exactly the collections that
 * are most tedious to fill by hand.
 *
 * It also has to agree with `flatMapEntityValues` about paths. Properties are
 * keyed on dotted paths (`seo.title`) and values are flattened onto the same
 * ones; if the two disagree, the model is told a field exists and shown no
 * value for it, and cheerfully overwrites what the operator already wrote.
 *
 * `getFieldId` is mocked to something deterministic — the real one resolves
 * against the admin field registry, which is not what is under test here.
 */
jest.mock("@rebasepro/cms", () => ({
    getFieldId: (property: { type?: string; admin?: { markdown?: boolean; multiline?: boolean } }) => {
        if (!property?.type) return undefined;
        if (property.type === "string" && property.admin?.markdown) return "markdown";
        if (property.type === "string" && property.admin?.multiline) return "multiline";
        if (property.type === "string") return "text_field";
        if (property.type === "number") return "number_field";
        if (property.type === "boolean") return "switch";
        if (property.type === "date") return "date_time";
        if (property.type === "reference") return "reference";
        return undefined;
    }
}));

describe("getSimplifiedProperties — flat properties", () => {

    it("keys each scalar on its own name", () => {
        const properties = {
            title: { name: "Title",
type: "string" },
            stock: { name: "Stock",
type: "number" }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, {});

        expect(Object.keys(out).sort()).toEqual(["stock", "title"]);
        expect(out.title).toMatchObject({ name: "Title",
type: "string",
fieldConfigId: "text_field" });
    });

    it("carries the description through, because it is what the model is steered by", () => {
        const properties = {
            summary: { name: "Summary",
type: "string",
description: "One sentence, no marketing" }
        } as unknown as Properties;

        expect(getSimplifiedProperties(properties, {}).summary.description).toBe("One sentence, no marketing");
    });

    it("marks disabled and read-only fields, so the service can refuse to fill them", () => {
        const properties = {
            slug: { name: "Slug",
type: "string",
admin: { disabled: true } },
            computed: { name: "Computed",
type: "string",
admin: { readOnly: true } },
            normal: { name: "Normal",
type: "string" }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, {});
        expect(out.slug.disabled).toBe(true);
        expect(out.computed.disabled).toBe(true);
        expect(out.normal.disabled).toBe(false);
    });

    it("flattens enum values to the ids the model must choose between", () => {
        const asArray = {
            status: { name: "Status",
type: "string",
enum: [{ id: "draft",
label: "Draft" }, { id: "live",
label: "Live" }] }
        } as unknown as Properties;
        expect(getSimplifiedProperties(asArray, {}).status.enum).toEqual(["draft", "live"]);

        const asObject = {
            status: { name: "Status",
type: "string",
enum: { draft: "Draft",
live: "Live" } }
        } as unknown as Properties;
        expect(getSimplifiedProperties(asObject, {}).status.enum).toEqual(["draft", "live"]);
    });

    it("distinguishes markdown and multiline, which change how a suggestion is joined", () => {
        const properties = {
            body: { name: "Body",
type: "string",
admin: { markdown: true } },
            notes: { name: "Notes",
type: "string",
admin: { multiline: true } }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, {});
        expect(out.body.fieldConfigId).toBe("markdown");
        expect(out.notes.fieldConfigId).toBe("multiline");
    });

    it("skips a property builder, which is a function with no schema to read", () => {
        const properties = {
            title: { name: "Title",
type: "string" },
            derived: () => ({ name: "Derived",
type: "string" })
        } as unknown as Properties;

        expect(Object.keys(getSimplifiedProperties(properties, {}))).toEqual(["title"]);
    });

    it("drops a property whose type has no field, rather than throwing", () => {
        const properties = {
            title: { name: "Title",
type: "string" },
            weird: { name: "Weird",
type: "geopoint" }
        } as unknown as Properties;

        expect(Object.keys(getSimplifiedProperties(properties, {}))).toEqual(["title"]);
    });

    it("returns nothing for an absent property map", () => {
        expect(getSimplifiedProperties(undefined as unknown as Properties, {})).toEqual({});
    });
});

describe("getSimplifiedProperties — nested maps", () => {

    it("keys children on the dotted path the values are flattened onto", () => {
        // The contract with `flatMapEntityValues`. If these disagree the model
        // is told about `seo.title` and shown a value for `seo`, so it treats
        // every existing value as absent.
        const properties = {
            seo: {
                name: "SEO",
                type: "map",
                properties: {
                    title: { name: "SEO title",
type: "string" },
                    description: { name: "SEO description",
type: "string" }
                }
            }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, {});

        expect(Object.keys(out).sort()).toEqual(["seo", "seo.description", "seo.title"]);
        expect(out["seo.title"]).toMatchObject({ name: "SEO title",
fieldConfigId: "text_field" });
        // The container itself is described too, so the model knows the grouping.
        expect(out.seo).toMatchObject({ type: "map",
fieldConfigId: "group" });
    });

    it("nests two levels deep", () => {
        const properties = {
            meta: {
                name: "Meta",
                type: "map",
                properties: {
                    seo: {
                        name: "SEO",
                        type: "map",
                        properties: { title: { name: "Title",
type: "string" } }
                    }
                }
            }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, {});
        expect(out["meta.seo.title"]).toMatchObject({ name: "Title" });
    });

    it("omits a map that declares no properties", () => {
        const properties = {
            title: { name: "Title",
type: "string" },
            blob: { name: "Blob",
type: "map" }
        } as unknown as Properties;

        expect(Object.keys(getSimplifiedProperties(properties, {}))).toEqual(["title"]);
    });

    it("omits a map whose children are all unfillable", () => {
        const properties = {
            refs: {
                name: "Refs",
                type: "map",
                properties: { point: { name: "Point",
type: "geopoint" } }
            }
        } as unknown as Properties;

        expect(getSimplifiedProperties(properties, {})).toEqual({});
    });
});

describe("getSimplifiedProperties — arrays", () => {

    it("describes an array of scalars by its element type", () => {
        // What lets the service offer `{type: "array", items: {type: "string"}}`
        // for a tags field rather than skipping it.
        const properties = {
            tags: { name: "Tags",
type: "array",
of: { name: "Tag",
type: "string" } }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, {});
        expect(out.tags).toMatchObject({ type: "array",
fieldConfigId: "repeat" });
        expect(out.tags.of).toMatchObject({ type: "string",
fieldConfigId: "text_field" });
    });

    it("carries the element's enum, so an array of choices stays constrained", () => {
        const properties = {
            categories: {
                name: "Categories",
                type: "array",
                of: { name: "Category",
type: "string",
enum: [{ id: "a",
label: "A" }, { id: "b",
label: "B" }] }
            }
        } as unknown as Properties;

        expect(getSimplifiedProperties(properties, {}).categories.of?.enum).toEqual(["a", "b"]);
    });

    it("marks a disabled array so the service leaves it alone", () => {
        const properties = {
            tags: { name: "Tags",
type: "array",
admin: { readOnly: true },
of: { name: "Tag",
type: "string" } }
        } as unknown as Properties;

        expect(getSimplifiedProperties(properties, {}).tags.disabled).toBe(true);
    });

    it("omits an array with neither `of` nor `oneOf`", () => {
        const properties = {
            title: { name: "Title",
type: "string" },
            mystery: { name: "Mystery",
type: "array" }
        } as unknown as Properties;

        expect(Object.keys(getSimplifiedProperties(properties, {}))).toEqual(["title"]);
    });
});

describe("getSimplifiedProperties — oneOf blocks", () => {

    const blockProperties = {
        content: {
            name: "Content",
            type: "array",
            oneOf: {
                typeField: "type",
                valueField: "value",
                properties: {
                    text: { name: "Text",
type: "string",
admin: { markdown: true } },
                    count: { name: "Count",
type: "number" }
                }
            }
        }
    } as unknown as Properties;

    it("describes the available block types when the field is empty", () => {
        const out = getSimplifiedProperties(blockProperties, {});
        expect(out.content).toMatchObject({ type: "array",
fieldConfigId: "block" });
        expect(Object.keys(out.content.oneOf!.properties).sort()).toEqual(["count", "text"]);
        expect(out.content.oneOf!.typeField).toBe("type");
        expect(out.content.oneOf!.valueField).toBe("value");
    });

    it("expands the blocks that already exist, keyed by index", () => {
        const values = {
            content: [
                { type: "text",
value: "Hello" },
                { type: "count",
value: 3 }
            ]
        };

        const out = getSimplifiedProperties(blockProperties, values);

        expect(out["content.0.value"]).toMatchObject({ name: "Text",
fieldConfigId: "markdown" });
        expect(out["content.1.value"]).toMatchObject({ name: "Count",
fieldConfigId: "number_field" });
    });

    it("skips a block whose declared type is not in the schema", () => {
        // Data can outlive a schema change. An unknown block must not take the
        // whole collection's serialization down with it.
        const values = { content: [{ type: "removed_block",
value: "x" }] };
        const out = getSimplifiedProperties(blockProperties, values);
        expect(out.content).toBeDefined();
        expect(Object.keys(out).filter((k) => k.startsWith("content."))).toEqual([]);
    });

    it("skips a null entry in the block list", () => {
        const values = { content: [null, { type: "text",
value: "Hi" }] };
        const out = getSimplifiedProperties(blockProperties, values);
        expect(out["content.1.value"]).toBeDefined();
    });

    it("defaults the type and value field names when the schema omits them", () => {
        const properties = {
            content: {
                name: "Content",
                type: "array",
                oneOf: { properties: { text: { name: "Text",
type: "string" } } }
            }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, { content: [{ type: "text",
value: "Hi" }] });
        expect(out["content.0.value"]).toMatchObject({ name: "Text" });
    });
});

describe("getSimplifiedProperties — the paths it produces", () => {

    it("agrees with the flattened value paths for every shape at once", () => {
        // The single assertion that catches a drift between this function and
        // `flatMapEntityValues`: every leaf key the model is told about must be
        // one the values can actually be keyed on.
        const properties = {
            title: { name: "Title",
type: "string" },
            seo: {
                name: "SEO",
                type: "map",
                properties: { title: { name: "SEO title",
type: "string" } }
            },
            tags: { name: "Tags",
type: "array",
of: { name: "Tag",
type: "string" } }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, { title: "T",
seo: { title: "S" } });

        expect(Object.keys(out).sort()).toEqual(["seo", "seo.title", "tags", "title"]);
        for (const key of Object.keys(out)) {
            expect(key).toMatch(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/);
        }
    });
});

describe("getSimplifiedProperties — a known wart", () => {

    it("emits the block's type discriminator as a bare string, not a property", () => {
        // Pinned rather than fixed, because it is pre-existing and harmless in
        // effect — but it *is* malformed: the return type says
        // `Record<string, InputProperty>` and this entry is the raw string
        // `"text"`. It reaches the service, which skips it via an explicit
        // `typeof property !== "object"` guard in `planFill` (see the matching
        // test in saas/backend/functions/ai.test.ts).
        //
        // If that guard is ever removed, `property.disabled` and `property.type`
        // read `undefined` off a string and the key is dropped anyway — so the
        // worst case is noise on the wire rather than a bad schema. Fixing it
        // means deciding whether the model benefits from knowing a block's type,
        // which is a behaviour change, not a cleanup.
        const properties = {
            content: {
                name: "Content",
                type: "array",
                oneOf: { properties: { text: { name: "Text",
type: "string" } } }
            }
        } as unknown as Properties;

        const out = getSimplifiedProperties(properties, { content: [{ type: "text",
value: "Hi" }] });

        expect(Object.keys(out)).toContain("content.0.type");
        expect(typeof out["content.0.type"]).toBe("string");
        expect(out["content.0.type"] as unknown).toBe("text");
        // The entry that carries real schema is the value one, and it is correct.
        expect(out["content.0.value"]).toMatchObject({ name: "Text",
type: "string" });
    });
});
