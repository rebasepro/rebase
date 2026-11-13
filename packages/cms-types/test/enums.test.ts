import { getLabelOrConfigFrom } from "@rebasepro/cms-types";

describe("enums utils", () => {
    describe("getLabelOrConfigFrom", () => {
        const enumValues = [
            { id: "1",
label: "One" },
            { id: "2",
label: "Two" },
            { id: "strID",
label: "String" }
        ];

        it("should return undefined for null or undefined key", () => {
            expect(getLabelOrConfigFrom(enumValues, undefined)).toBeUndefined();
            // @ts-expect-error a stored null key, which the signature excludes, must find nothing
            expect(getLabelOrConfigFrom(enumValues, null)).toBeUndefined();
        });

        it("should find by string matching", () => {
            expect(getLabelOrConfigFrom(enumValues, "1")).toEqual({ id: "1",
label: "One" });
            expect(getLabelOrConfigFrom(enumValues, "strID")).toEqual({ id: "strID",
label: "String" });
        });

        it("should find by number matching (converting to string internally)", () => {
            expect(getLabelOrConfigFrom(enumValues, 1)).toEqual({ id: "1",
label: "One" });
        });

        it("should return undefined if no match is found", () => {
            expect(getLabelOrConfigFrom(enumValues, "unknown")).toBeUndefined();
            expect(getLabelOrConfigFrom(enumValues, 999)).toBeUndefined();
        });
    });
});
