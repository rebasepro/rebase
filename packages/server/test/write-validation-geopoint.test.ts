import { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { assertWriteValuesValid, type WriteViolation } from "../src/api/rest/write-validation";
import { tableFrom } from "./helpers/tables";

/** A latitude of 200 is not a place; it was stored as one. */
const places: LegacyCollectionConfig = {
    slug: "places",
    name: "Places",
    table: "places",
    properties: {
        id: { type: "string", isId: "uuid" },
        location: { type: "geopoint" }
    }
};

function violationsOf(values: Record<string, unknown>): WriteViolation[] {
    try {
        assertWriteValuesValid(values, tableFrom(places));
    } catch (error) {
        return ((error as { details?: { violations?: WriteViolation[] } }).details?.violations) ?? [];
    }
    return [];
}

describe("geopoint coordinates are on the globe", () => {
    it("accepts a point in range", () => {
        expect(violationsOf({ location: { latitude: 41.9, longitude: 12.5 } })).toEqual([]);
        expect(violationsOf({ location: { latitude: 90, longitude: -180 } })).toEqual([]);
    });

    it("refuses a latitude or longitude out of range", () => {
        expect(violationsOf({ location: { latitude: 200, longitude: 12 } }).map(v => [v.field, v.code]))
            .toEqual([["location", "geopoint_range"]]);
        expect(violationsOf({ location: { latitude: 1, longitude: 540 } }).map(v => v.code)).toEqual(["geopoint_range"]);
    });

    it("leaves a malformed point to the shape check", () => {
        expect(violationsOf({ location: "nowhere" })).toEqual([]);
    });
});
