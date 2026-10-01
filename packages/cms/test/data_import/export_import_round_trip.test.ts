import { describe, expect, test } from "@jest/globals";
import type { Entity, Properties } from "@rebasepro/types";
import { entryToCSVRow, getEntityCSVExportableData } from "../../src/data_export/export/export";
import { parseCsvToObjects } from "../../src/data_import/utils/csv";
import { mapJsonParse, unflattenObject } from "../../src/data_import/utils/transforms";
import { convertDataToEntity, ImportConversionProblem } from "../../src/data_import/utils/data";

/**
 * A CSV the admin exported reads back into the values it was written from.
 *
 * The export writes a geopoint, a key-value map and each item of an array of
 * maps as JSON text in its cell; the import read none of them back. A
 * geopoint arrived as a string and the server refused the whole batch, a map
 * was stored as a JSON *string*, and an array of maps as an array of strings
 * that the form then showed as blank items — each accepted with a 201.
 */
const properties = {
    name: { type: "string" },
    location: { type: "geopoint" },
    attrs: { type: "map" },
    links: { type: "array", of: { type: "map", properties: { label: { type: "string" }, url: { type: "string" } } } },
    price: { type: "number" }
} as unknown as Properties;

const stored = {
    name: "Rome",
    location: { latitude: 41.9, longitude: 12.5 },
    attrs: { color: "red", size: "L" },
    links: [{ label: "A", url: "https://a.example" }, { label: "B", url: "https://b.example" }],
    price: 0
};

function roundTrip(values: Record<string, unknown>) {
    const entity = { id: "1", path: "places", values } as Entity<Record<string, unknown>>;
    const headers = ["id", ...Object.keys(properties)].map(key => ({ key, label: key }));
    const rows = getEntityCSVExportableData([entity], undefined, properties as never, headers, "string");
    const csv = entryToCSVRow(headers.map(h => h.label)) + rows.map(r => entryToCSVRow(r)).join("");
    const parsed = parseCsvToObjects(csv).data.map(mapJsonParse).map(unflattenObject);
    const mapping = Object.fromEntries(Object.keys(properties).map(key => [key, key]));
    const problems: Omit<ImportConversionProblem, "row">[] = [];
    const imported = convertDataToEntity({} as never, { getCollection: () => undefined } as never,
        parsed[0], "id", mapping, properties, "places", {}, (p) => problems.push(p));
    return { values: imported.values, problems };
}

describe("export → import of a CSV", () => {
    test("reads back a geopoint, a key-value map and an array of maps", () => {
        const { values, problems } = roundTrip(stored);
        expect(problems).toEqual([]);
        expect(values).toEqual(stored);
    });

    test("reports a geopoint or map cell that is not one, instead of storing the text", () => {
        const properties2 = { location: { type: "geopoint" }, attrs: { type: "map" } } as unknown as Properties;
        const problems: Omit<ImportConversionProblem, "row">[] = [];
        const imported = convertDataToEntity({} as never, { getCollection: () => undefined } as never,
            { location: "41.9, 12.5", attrs: "red" }, undefined, { location: "location", attrs: "attrs" },
            properties2, "places", {}, (p) => problems.push(p));
        expect(imported.values).toEqual({});
        expect(problems.map(p => [p.property, p.reason])).toEqual([["location", "not_a_geopoint"], ["attrs", "not_a_map"]]);
    });
});
