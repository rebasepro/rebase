/**
 * @jest-environment jsdom
 */
import { mapPropertyToZod } from "../../src/form/validation";
import { GeoPoint, type GeopointProperty } from "@rebasepro/types";

/**
 * A geopoint out of range. The field showed "Latitude must be between -90 and
 * 90" in red and Save wrote 200 anyway: the schema accepted any object.
 */
const property = { type: "geopoint", name: "Location" } as GeopointProperty;

async function messages(value: unknown): Promise<string[]> {
    const result = await mapPropertyToZod({ property }).safeParseAsync(value);
    return result.success ? [] : result.error.issues.map(issue => issue.message);
}

describe("geopoint range", () => {
    it("accepts a point on the globe, and no point", async () => {
        expect(await messages({ latitude: 41.9, longitude: 12.5 })).toEqual([]);
        expect(await messages({ latitude: -90, longitude: 180 })).toEqual([]);
        expect(await messages(null)).toEqual([]);
    });

    it("refuses a latitude or longitude off the globe", async () => {
        expect(await messages({ latitude: 200, longitude: 12 })).toEqual(["Latitude must be between -90 and 90"]);
        expect(await messages({ latitude: 10, longitude: -181 })).toEqual(["Longitude must be between -180 and 180"]);
        expect(await messages(new GeoPoint(-91, 0))).toEqual(["Latitude must be between -90 and 90"]);
    });
});
