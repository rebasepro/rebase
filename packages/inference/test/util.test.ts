import type { EnumValues } from "@rebasepro/types";

import { extractEnumFromValues, resolveEnumValues } from "../src/util";

describe("extractEnumFromValues", () => {
    it("converts string values to sorted enum configs", () => {
        const result = extractEnumFromValues(["banana", "apple", "cherry"]);
        expect(result).toHaveLength(3);
        expect(result[0].id).toBe("apple");
        expect(result[1].id).toBe("banana");
        expect(result[2].id).toBe("cherry");
    });

    it("unslugifies labels", () => {
        const result = extractEnumFromValues(["my_value", "another_value"]);
        // Labels should differ from the raw id (unslugified)
        const myVal = result.find(e => e.id === "my_value");
        expect(myVal).toBeDefined();
        expect(myVal!.label).not.toBe("my_value");
        expect(myVal!.label.length).toBeGreaterThan(0);
    });

    it("filters out non-string values", () => {
        const result = extractEnumFromValues(["hello", 42, null, undefined, "world"]);
        expect(result).toHaveLength(2);
        expect(result.map(e => e.id)).toEqual(expect.arrayContaining(["hello", "world"]));
    });

    it("returns empty array for empty input", () => {
        expect(extractEnumFromValues([])).toEqual([]);
    });

    it("returns empty array for non-array input", () => {
        expect(extractEnumFromValues("not-an-array" as unknown as unknown[])).toEqual([]);
    });

    it("handles single string value", () => {
        const result = extractEnumFromValues(["only_one"]);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("only_one");
    });

    it("sorts enum values alphabetically by label", () => {
        const result = extractEnumFromValues(["zebra", "alpha", "middle"]);
        // localeCompare returns negative if a < b
        expect(result[0].label.localeCompare(result[1].label)).toBeLessThan(0);
        expect(result[1].label.localeCompare(result[2].label)).toBeLessThan(0);
    });
});

describe("resolveEnumValues", () => {
    it("returns array input as-is", () => {
        const input = [
            { id: "a",
label: "A" },
            { id: "b",
label: "B" }
        ];
        expect(resolveEnumValues(input)).toEqual(input);
    });

    it("converts object with string values to array", () => {
        const input = {
            active: "Active",
            inactive: "Inactive"
        };
        const result = resolveEnumValues(input);
        expect(result).toHaveLength(2);
        expect(result).toEqual(expect.arrayContaining([
            { id: "active",
label: "Active" },
            { id: "inactive",
label: "Inactive" }
        ]));
    });

    it("converts object with EnumValueConfig values to array", () => {
        // Annotated rather than inferred: left alone, `color` widens to `string`,
        // which `ColorKey | ColorScheme` does not accept — so the fixture named
        // in this test's title was never an `EnumValues` at all.
        const input: EnumValues = {
            active: { id: "active",
label: "Active",
color: "green" },
            inactive: { id: "inactive",
label: "Inactive",
color: "red" }
        };
        const result = resolveEnumValues(input);
        expect(result).toHaveLength(2);
    });

    it("returns undefined for null", () => {
        expect(resolveEnumValues(null as unknown as never)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
        expect(resolveEnumValues(undefined as unknown as never)).toBeUndefined();
    });

    it("returns undefined for primitive values", () => {
        expect(resolveEnumValues("string" as unknown as never)).toBeUndefined();
        expect(resolveEnumValues(42 as unknown as never)).toBeUndefined();
    });

    it("handles empty object", () => {
        const result = resolveEnumValues({});
        expect(result).toEqual([]);
    });

    it("handles empty array", () => {
        const result = resolveEnumValues([]);
        expect(result).toEqual([]);
    });
});
