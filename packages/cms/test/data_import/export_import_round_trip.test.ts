/**
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
    DataType,
    Entity,
    EntityReference,
    EntityRelation,
    GeoPoint,
    Properties,
    Property,
    Vector
} from "@rebasepro/types";
import { downloadEntitiesExport, entryToCSVRow, getEntityCSVExportableData } from "../../src/data_export/export/export";
import { parseCsvToObjects } from "../../src/data_import/utils/csv";
import { mapJsonParse, unflattenObject } from "../../src/data_import/utils/transforms";
import { convertDataToEntity, convertImportData, ImportConversionProblem } from "../../src/data_import/utils/data";
import { convertFileToJson } from "../../src/data_import/utils/file_to_json";
import { buildHeadersMappingFromData } from "../../src/data_import/utils/import_columns";
import { guessIdColumn } from "../../src/data_import/utils/id_column";
import { getPropertyInPath } from "../../src/util";
import { DEFAULT_FIELD_CONFIGS, getDefaultFieldId } from "../../src/components/field_configs";
import type { DefaultFieldConfig } from "../../src/types/fields";

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
} satisfies Properties;

const stored = {
    name: "Rome",
    location: { latitude: 41.9, longitude: 12.5 },
    attrs: { color: "red", size: "L" },
    links: [{ label: "A", url: "https://a.example" }, { label: "B", url: "https://b.example" }],
    price: 0
};

const noAuth = {} as Parameters<typeof convertDataToEntity>[0];
const noCollections = { getCollection: () => undefined } as unknown as Parameters<typeof convertDataToEntity>[1];

function roundTrip(values: Record<string, unknown>) {
    const entity: Entity<Record<string, unknown>> = { id: "1", path: "places", values };
    const headers = ["id", ...Object.keys(properties)].map(key => ({ key, label: key }));
    const rows = getEntityCSVExportableData([entity], undefined, properties, headers, "string");
    const csv = entryToCSVRow(headers.map(h => h.label)) + rows.map(r => entryToCSVRow(r)).join("");
    const parsed = parseCsvToObjects(csv).data.map(mapJsonParse).map(unflattenObject);
    const mapping = Object.fromEntries(Object.keys(properties).map(key => [key, key]));
    const problems: Omit<ImportConversionProblem, "row">[] = [];
    const imported = convertDataToEntity(noAuth, noCollections,
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
        const properties2 = { location: { type: "geopoint" }, attrs: { type: "map" } } satisfies Properties;
        const problems: Omit<ImportConversionProblem, "row">[] = [];
        const imported = convertDataToEntity(noAuth, noCollections,
            { location: "41.9, 12.5", attrs: "red" }, undefined, { location: "location", attrs: "attrs" },
            properties2, "places", {}, (p) => problems.push(p));
        expect(imported.values).toEqual({});
        expect(problems.map(p => [p.property, p.reason])).toEqual([["location", "not_a_geopoint"], ["attrs", "not_a_map"]]);
    });
});

/**
 * Every kind of field the admin offers, exported in every way the export
 * dialog offers and imported back with the import's own reader, mapping and
 * conversion — and the record that comes back is the one that went out.
 *
 * The encoder and the decoder were written apart (bug class 69), and this is
 * the round trip nobody ran: a JSON import dropped every geopoint, key-value
 * map and vector without a word, because the reader split
 * `location: { latitude, longitude }` into `location.latitude` and
 * `location.longitude` columns that no property holds.
 *
 * The cases are keyed by the admin's field ids, and checked against
 * `DEFAULT_FIELD_CONFIGS`: a field added to the admin without a case here
 * fails this file, and so does a property type no case reaches.
 */
type RoundTripCase = {
    property: Property;
    /** The value as the admin holds it, which is what the export is given. */
    value: unknown;
    /** What the import writes back, when it is not `value` itself. */
    imported?: unknown;
};

const author = (id: string) => new EntityReference({ id, path: "authors" });

const fieldCases = {
    text_field: { property: { type: "string" }, value: "Rome, \"the eternal\" city; =1+1 stays text" },
    multiline: { property: { type: "string", admin: { multiline: true } }, value: "line one\nline two, with a comma" },
    markdown: { property: { type: "string", admin: { markdown: true } }, value: "# Title\n\n- a \"quoted\" item\n- 'another'" },
    url: { property: { type: "string", admin: { urlPreview: true } }, value: "https://example.com/a?b=1,2" },
    email: { property: { type: "string", email: true }, value: "ada@example.com" },
    switch: { property: { type: "boolean" }, value: false },
    select: { property: { type: "string", enum: { draft: "Draft", published: "Published" } }, value: "draft" },
    multi_select: {
        property: { type: "array", of: { type: "string", enum: { news: "News", sports: "Sports" } } },
        value: ["news", "sports"]
    },
    user_select: { property: { type: "string", userSelect: true }, value: "user_8a1f" },
    number_input: { property: { type: "number" }, value: -12.5 },
    number_select: { property: { type: "number", enum: { 1: "One", 2: "Two" } }, value: 2 },
    multi_number_select: {
        property: { type: "array", of: { type: "number", enum: { 1: "One", 2: "Two" } } },
        value: [1, 2]
    },
    file_upload: { property: { type: "string", storage: { storagePath: "images" } }, value: "images/photo 1.png" },
    multi_file_upload: {
        property: { type: "array", of: { type: "string", storage: { storagePath: "images" } } },
        value: ["images/a.png", "images/b.png"]
    },
    reference: { property: { type: "reference", path: "authors" }, value: author("42") },
    multi_references: {
        property: { type: "array", of: { type: "reference", path: "authors" } },
        value: [author("42"), author("43")]
    },
    // The export writes a relation as the id it points at, and that id is
    // what the import writes back.
    relation: { property: { type: "relation" }, value: new EntityRelation(7, "authors"), imported: 7 },
    date_time: { property: { type: "date", mode: "date_time" }, value: new Date("2024-03-05T10:20:30.000Z") },
    group: {
        property: {
            type: "map",
            properties: { city: { type: "string" }, founded: { type: "date" }, location: { type: "geopoint" } }
        },
        value: { city: "Rome", founded: new Date("2024-04-21T00:00:00.000Z"), location: new GeoPoint(41.9, 12.5) }
    },
    key_value: { property: { type: "map", keyValue: true }, value: { color: "red", size: "L", dims: { w: 2, h: 3 } } },
    repeat: {
        property: { type: "array", of: { type: "map", properties: { label: { type: "string" }, at: { type: "date" } } } },
        value: [
            { label: "A", at: new Date("2024-01-05T09:00:00.000Z") },
            { label: "B, \"second\"", at: new Date("2024-02-06T10:00:00.000Z") }
        ]
    },
    custom_array: {
        property: { type: "array", of: [{ type: "string" }, { type: "date" }] },
        value: ["a", new Date("2024-05-06T07:08:09.000Z")]
    },
    block: {
        property: {
            type: "array",
            oneOf: { properties: { text: { type: "string" }, image: { type: "string", storage: { storagePath: "images" } } } }
        },
        value: [{ type: "text", value: "Hello, world" }, { type: "image", value: "images/a.png" }]
    },
    vector_input: { property: { type: "vector", dimensions: 3 }, value: new Vector([0.25, -0.5, 1]) },
    geopoint: { property: { type: "geopoint" }, value: new GeoPoint(-33.8688, 151.2093) },
    binary: { property: { type: "binary" }, value: "aGVsbG8gd29ybGQ=" }
} satisfies Record<DefaultFieldConfig, RoundTripCase>;

/** Shapes of the same fields that a cell has misread before. */
const edgeCases = {
    date_only: { property: { type: "date", mode: "date" }, value: new Date("2024-03-05T00:00:00.000Z") },
    time_of_day: { property: { type: "date", columnType: "time" }, value: new Date("1970-01-01T12:30:00.000Z") },
    zero: { property: { type: "number" }, value: 0 },
    switch_on: { property: { type: "boolean" }, value: true },
    digits_as_text: { property: { type: "string" }, value: "00123" },
    number_as_text: { property: { type: "string" }, value: "12" },
    boolean_as_text: { property: { type: "string" }, value: "true" },
    relations: {
        property: { type: "relation" },
        value: [new EntityRelation(7, "authors"), new EntityRelation(8, "authors")],
        imported: [7, 8]
    },
    nested_key_value: {
        property: { type: "map", properties: { title: { type: "string" }, extra: { type: "map", keyValue: true } } },
        value: { title: "Nested", extra: { a: "1", b: { c: true } } }
    }
} satisfies Record<string, RoundTripCase>;

const cases: Record<string, RoundTripCase> = { ...fieldCases, ...edgeCases };
const collectionProperties: Properties = Object.fromEntries(
    Object.entries(cases).map(([key, { property }]) => [key, property]));
const original = Object.fromEntries(Object.entries(cases).map(([key, { value }]) => [key, value]));
const expected = Object.fromEntries(Object.entries(cases)
    .map(([key, roundTripCase]) => [key, "imported" in roundTripCase ? roundTripCase.imported : roundTripCase.value]));

/** Every `type` a property can have; the compiler refuses this list when one is added. */
const DATA_TYPES = {
    string: true, number: true, boolean: true, date: true, geopoint: true, reference: true,
    relation: true, array: true, map: true, vector: true, binary: true
} satisfies Record<DataType, true>;

type ExportOptions = {
    exportType: "csv" | "json";
    flattenArrays: boolean;
    dateExportType: "timestamp" | "string";
};

let exported: Blob | undefined;

beforeEach(() => {
    exported = undefined;
    // The export hands its file to the browser as a download; this is where
    // the test picks it up.
    Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: (blob: Blob) => {
            exported = blob;
            return "blob:export";
        }
    });
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    jest.spyOn(console, "debug").mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

/** The file the export dialog downloads for this record, written by the export itself. */
function exportFile(entity: Entity<Record<string, unknown>>, options: ExportOptions): File {
    downloadEntitiesExport({
        data: [entity],
        additionalData: undefined,
        properties: collectionProperties,
        propertiesOrder: undefined,
        name: "places",
        additionalHeaders: undefined,
        ...options
    });
    if (!exported) throw new Error("the export wrote no file");
    return new File([exported], `places.${options.exportType}`, { type: exported.type });
}

/** What the admin's Import action does with that file, up to the rows it would write. */
async function importFile(file: File) {
    const { data } = await convertFileToJson(file);
    const headersMapping = buildHeadersMappingFromData(data, collectionProperties);
    const idColumn = guessIdColumn(Object.keys(headersMapping), headersMapping, collectionProperties);
    const { entities, problems } = convertImportData(noAuth, noCollections, data, idColumn, headersMapping,
        collectionProperties, "places", {});
    return { headersMapping, idColumn, entities, problems };
}

function describeValue(value: unknown): string {
    const name = value !== null && typeof value === "object" && !Array.isArray(value) ? value.constructor?.name : undefined;
    const json = JSON.stringify(value);
    return name && name !== "Object" ? `${name} ${json}` : String(json);
}

const exportOptions: ExportOptions[] = [
    { exportType: "csv", flattenArrays: true, dateExportType: "string" },
    { exportType: "csv", flattenArrays: true, dateExportType: "timestamp" },
    { exportType: "csv", flattenArrays: false, dateExportType: "string" },
    { exportType: "csv", flattenArrays: false, dateExportType: "timestamp" },
    { exportType: "json", flattenArrays: false, dateExportType: "string" },
    { exportType: "json", flattenArrays: false, dateExportType: "timestamp" }
];

describe("a record of every field type, exported and imported back", () => {

    test("there is a case for every field the admin offers, and every property type", () => {
        expect(Object.keys(fieldCases).sort()).toEqual(Object.keys(DEFAULT_FIELD_CONFIGS).sort());
        for (const [fieldId, { property }] of Object.entries(fieldCases)) {
            expect([fieldId, getDefaultFieldId(property)]).toEqual([fieldId, fieldId]);
        }
        const reached = new Set(Object.values(cases).map(({ property }) => property.type));
        expect([...reached].sort()).toEqual(Object.keys(DATA_TYPES).sort());
    });

    test.each(exportOptions)("$exportType, arrays flattened: $flattenArrays, dates as $dateExportType", async (options) => {
        const entity: Entity<Record<string, unknown>> = { id: "1", path: "places", values: original };
        const { headersMapping, idColumn, entities, problems } = await importFile(exportFile(entity, options));

        expect(idColumn).toBe("id");
        expect(entities).toHaveLength(1);
        expect(entities[0].id).toBe("1");

        // Each column the mapping step lists lands in a property of the
        // collection, so none is offered that the import cannot place.
        const unplaced = Object.entries(headersMapping)
            .filter(([column, target]) => column !== idColumn && (!target || !getPropertyInPath(collectionProperties, target)))
            .map(([column]) => column);

        const values = entities[0].values;
        const differs = Object.keys(expected).filter(key => {
            try {
                expect(values[key]).toStrictEqual(expected[key]);
                return false;
            } catch {
                return true;
            }
        });
        // One list, so a failure names every field that did not come back.
        expect([
            ...problems.map(p => `${p.column}: refused as ${p.reason}: ${describeValue(p.value)}`),
            ...unplaced.map(column => `${column}: a column no property holds`),
            ...differs.map(key => `${key}: ${describeValue(expected[key])} came back as ${describeValue(values[key])}`)
        ]).toEqual([]);
        expect(values).toStrictEqual(expected);
    });
});

describe("the mapping step", () => {
    // A nested key was mapped under its parent's name in the file, not under
    // the property that name was matched to, so a `Home Address` object found
    // `home_address` and then put `Street Name` in `Home Address.street_name`,
    // which no property holds.
    test("maps the fields of an object under the map its key was matched to", () => {
        const mapProperties = {
            home_address: { type: "map", properties: { street_name: { type: "string" }, location: { type: "geopoint" } } }
        } satisfies Properties;
        const row = { "Home Address": { "Street Name": "Main St", location: { latitude: 59.9, longitude: 10.7 } } };
        const headersMapping = buildHeadersMappingFromData([row], mapProperties);
        expect(headersMapping).toEqual({
            "Home Address": "home_address",
            "Home Address.Street Name": "home_address.street_name",
            "Home Address.location": "home_address.location"
        });
        const { entities, problems } = convertImportData(noAuth, noCollections, [row], undefined, headersMapping,
            mapProperties, "places", {});
        expect(problems).toEqual([]);
        expect(entities[0].values).toStrictEqual({
            home_address: { street_name: "Main St", location: new GeoPoint(59.9, 10.7) }
        });
    });

    // Only a value the export writes as an object is taken whole. An object
    // that lands on a text property is still read key by key, so its keys
    // can be mapped onto properties of their own.
    test("lists the keys of an object that lands on a property holding no objects", () => {
        const textProperties = { name: { type: "string" }, first_name: { type: "string" } } satisfies Properties;
        const row = { name: { first: "Ada", last: "Lovelace" } };
        const headersMapping = buildHeadersMappingFromData([row], textProperties);
        expect(headersMapping).toEqual({ name: "name", "name.first": "name.first", "name.last": "name.last" });
        const { entities } = convertImportData(noAuth, noCollections, [row], undefined,
            { ...headersMapping, "name.first": "first_name" }, textProperties, "people", {});
        expect(entities[0].values).toStrictEqual({ first_name: "Ada" });
    });
});
