import { buildReferenceProperty } from "../../src/builders/reference_property_builder";
import type { InferencePropertyBuilderProps, ValuesCountEntry } from "../../src/types";
import type { ReferenceProperty } from "@rebasepro/types";

function makeRefValues(paths: string[]): ValuesCountEntry {
    const valuesCount = new Map<unknown, number>();
    for (const v of paths) {
        valuesCount.set(v, (valuesCount.get(v) || 0) + 1);
    }
    return { values: paths,
valuesCount };
}

describe("buildReferenceProperty", () => {
    it("returns type: reference", () => {
        const result = buildReferenceProperty({
            name: "author",
            totalDocsCount: 10,
            valuesResult: makeRefValues([
                "users/a", "users/b", "users/c",
                "users/d", "users/e", "users/f",
                "users/g", "users/h", "users/i", "users/j"
            ])
        });
        expect(result.type).toBe("reference");
    });

    it("extracts common path from reference values", () => {
        const result = buildReferenceProperty({
            name: "author",
            totalDocsCount: 10,
            valuesResult: makeRefValues([
                "users/a", "users/b", "users/c",
                "users/d", "users/e", "users/f",
                "users/g", "users/h", "users/i", "users/j"
            ])
        }) as ReferenceProperty;
        expect(result.path).toBe("users");
    });

    it("falls back to !!!FIX_ME!!! when no common path found", () => {
        const result = buildReferenceProperty({
            name: "ref",
            totalDocsCount: 3,
            valuesResult: makeRefValues(["a/1", "b/2", "c/3"])
        }) as ReferenceProperty;
        expect(result.path).toBe("!!!FIX_ME!!!");
    });

    it("falls back to !!!FIX_ME!!! when no valuesResult", () => {
        const result = buildReferenceProperty({
            name: "ref",
            totalDocsCount: 10
        }) as ReferenceProperty;
        expect(result.path).toBe("!!!FIX_ME!!!");
    });

    it("name defaults to empty string when not provided", () => {
        // `name` is required by the type but the builder still guards it with
        // `?? ""`, because callers reach it through untyped inference input.
        // Passing "" explicitly tested the caller, not the guard.
        const result = buildReferenceProperty({
            totalDocsCount: 5
        } as InferencePropertyBuilderProps);
        expect(result.name).toBe("");
    });

    it("sets the name correctly", () => {
        const result = buildReferenceProperty({
            name: "category",
            totalDocsCount: 5,
            valuesResult: makeRefValues([
                "categories/a", "categories/b", "categories/c",
                "categories/d", "categories/e"
            ])
        });
        expect(result.name).toBe("category");
    });
});
