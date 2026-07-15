import { buildValidation } from "../../src/builders/validation_builder";
import type { ValuesCountEntry } from "../../src/types";

function makeValuesResult(count: number): ValuesCountEntry {
    const values = Array.from({ length: count }, (_, i) => `value_${i}`);
    const valuesCount = new Map<unknown, number>();
    for (const v of values) {
        valuesCount.set(v, 1);
    }
    return { values,
valuesCount };
}

describe("buildValidation", () => {
    it("returns required: true when all docs have the field", () => {
        const result = buildValidation({
            name: "title",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(10)
        });
        expect(result).toEqual({ required: true });
    });

    it("returns undefined when not all docs have the field", () => {
        const result = buildValidation({
            name: "subtitle",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(7)
        });
        expect(result).toBeUndefined();
    });

    it("returns undefined when valuesResult is undefined", () => {
        const result = buildValidation({
            name: "optional",
            totalDocsCount: 10
        });
        expect(result).toBeUndefined();
    });

    it("returns required for single document with single value", () => {
        const result = buildValidation({
            name: "id",
            totalDocsCount: 1,
            valuesResult: makeValuesResult(1)
        });
        expect(result).toEqual({ required: true });
    });

    it("returns undefined when zero values exist", () => {
        const result = buildValidation({
            name: "empty",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(0)
        });
        expect(result).toBeUndefined();
    });
});
