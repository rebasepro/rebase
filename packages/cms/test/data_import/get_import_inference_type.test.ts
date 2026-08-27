import { describe, expect, test } from "@jest/globals";
import { getInferenceType } from "../../src/data_import/utils/get_import_inference_type";

describe("getInferenceType utility function", () => {
    test("should infer number type correctly", () => {
        expect(getInferenceType(42)).toBe("number");
        expect(getInferenceType(3.14)).toBe("number");
        expect(getInferenceType(-10)).toBe("number");
    });

    test("should infer string type correctly", () => {
        expect(getInferenceType("hello")).toBe("string");
        expect(getInferenceType("")).toBe("string");
    });

    test("should infer boolean type correctly", () => {
        expect(getInferenceType(true)).toBe("boolean");
        expect(getInferenceType(false)).toBe("boolean");
    });

    test("should infer date type correctly", () => {
        expect(getInferenceType(new Date())).toBe("date");
    });

    test("should infer array type correctly", () => {
        expect(getInferenceType([])).toBe("array");
        expect(getInferenceType([1, 2, 3])).toBe("array");
    });

    test("should infer map type for objects", () => {
        expect(getInferenceType({})).toBe("map");
        expect(getInferenceType({ key: "value" })).toBe("map");
    });

    test("should not infer a missing value as a map", () => {
        // An empty CSV cell arrives as null. `typeof null === "object"` used to
        // carry it past every check and out the "map" fallthrough, so a column
        // of blanks was offered to the user as a nested object.
        expect(getInferenceType(null)).toBe("string");
        expect(getInferenceType(undefined)).toBe("string");
    });
});
