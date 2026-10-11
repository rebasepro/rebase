/**
 * @jest-environment jsdom
 */
import { mapPropertyToZod } from "../../src/form/validation";
import { EntityRelation, type Property } from "@rebasepro/types";

/** Small form-validation mismatches (CMS-FORMS-27). */
async function messages(property: Property, value: unknown): Promise<string[]> {
    const result = await mapPropertyToZod({ property, name: "field" }).safeParseAsync(value);
    return result.success ? [] : result.error.issues.map(issue => issue.message);
}

describe("an integer column", () => {
    it("refuses a fraction without validation.integer, as the column would", async () => {
        const property = { type: "number", name: "Stock", columnType: "integer" } as Property;
        expect(await messages(property, 1.5)).toEqual(["Stock must be an integer"]);
        expect(await messages(property, 2)).toEqual([]);
    });

    it("leaves a numeric column alone", async () => {
        expect(await messages({ type: "number", name: "Price", columnType: "numeric" } as Property, 1.5)).toEqual([]);
    });
});

describe("a date bound", () => {
    const property = {
        type: "date",
        name: "Day",
        columnType: "date",
        validation: { min: new Date("2020-01-01T00:00:00Z"), max: new Date("2020-12-31T00:00:00Z") }
    } as Property;

    it("is inclusive, and says so, with the day written plainly", async () => {
        expect(await messages(property, new Date("2020-01-01T00:00:00Z"))).toEqual([]);
        expect(await messages(property, new Date("2019-12-31T00:00:00Z"))).toEqual(["Day must not be before 2020-01-01"]);
        expect(await messages(property, new Date("2021-01-01T00:00:00Z"))).toEqual(["Day must not be after 2020-12-31"]);
    });
});

describe("uniqueInArray over relations", () => {
    const property = {
        type: "array",
        name: "Tags",
        validation: { uniqueInArray: true },
        of: { type: "reference", path: "tags" }
    } as unknown as Property;

    it("reports the same row linked twice", async () => {
        const twice = [new EntityRelation("t-1", "tags"), new EntityRelation("t-1", "tags")];
        expect(await messages(property, twice)).toEqual(["Tags should have unique values within the array"]);
    });

    it("accepts two different rows", async () => {
        expect(await messages(property, [new EntityRelation("t-1", "tags"), new EntityRelation("t-2", "tags")])).toEqual([]);
    });
});
