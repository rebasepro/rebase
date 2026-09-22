import { describe, expect, test } from "@jest/globals";
import {
    entryToCSVRow,
    escapeCsvFormula,
    getEntityCSVExportableData,
    getEntityJsonExportableData
} from "../../src/data_export/export/export";
import { Entity, Properties, EntityReference, EntityRelation, GeoPoint } from "@rebasepro/types";

describe("Export Utility Functions", () => {
    const mockProperties: Properties = {
        name: { type: "string" },
        age: { type: "number" },
        birthDate: { type: "date" },
        favoriteUser: { type: "reference", path: "users" }
    };

    const birthDate = new Date("1990-01-01T00:00:00.000Z");
    /**
     * What a `date` column actually looks like in `entity.values` here.
     *
     * The admin reads over REST, and the REST row pipeline does not envelope
     * dates — only the driver/WebSocket path emits `{ __type: "date" }` for
     * `rebaseReviver` to revive. A fixture holding a `Date` is a shape this code
     * never sees on the live path, and it is what let the date export toggle
     * stay dead (`docs/bug-classes.md` class 7).
     */
    const birthDateOnTheWire = birthDate.toISOString();
    const mockReference = new EntityReference({ id: "user-99", path: "users", databaseId: "custom" });

    const mockEntities: Entity<any>[] = [
        {
            id: "entity-1",
            path: "users",
            values: {
                name: "Alice",
                age: 30,
                birthDate: birthDateOnTheWire,
                favoriteUser: mockReference
            }
        },
        {
            id: "entity-2",
            path: "users",
            values: {
                name: "Bob",
                age: 25,
                birthDate: birthDateOnTheWire,
                favoriteUser: null
            }
        }
    ];

    describe("getEntityCSVExportableData", () => {
        test("should format entity values correctly with date as string", () => {
            const headers = [
                { label: "id", key: "id" },
                { label: "name", key: "name" },
                { label: "age", key: "age" },
                { label: "birthDate", key: "birthDate" },
                { label: "favoriteUser", key: "favoriteUser" }
            ];

            const result = getEntityCSVExportableData(
                mockEntities,
                undefined,
                mockProperties,
                headers,
                "string"
            );

            expect(result).toEqual([
                ["entity-1", "Alice", 30, birthDate.toISOString(), "custom:::users/user-99"],
                ["entity-2", "Bob", 25, birthDate.toISOString(), null]
            ]);
        });

        test("should format entity values correctly with date as timestamp", () => {
            const headers = [
                { label: "id", key: "id" },
                { label: "birthDate", key: "birthDate" }
            ];

            const result = getEntityCSVExportableData(
                mockEntities,
                undefined,
                mockProperties,
                headers,
                "timestamp"
            );

            expect(result).toEqual([
                ["entity-1", birthDate.getTime()],
                ["entity-2", birthDate.getTime()]
            ]);
        });

        test("the two date options produce different output on rows from the REST pipeline", () => {
            const headers = [{ label: "birthDate", key: "birthDate" }];

            const asString = getEntityCSVExportableData(mockEntities, undefined, mockProperties, headers, "string");
            const asTimestamp = getEntityCSVExportableData(mockEntities, undefined, mockProperties, headers, "timestamp");

            expect(asString).not.toEqual(asTimestamp);
        });

        test("a Date instance — the driver/WebSocket shape — still converts", () => {
            const headers = [{ label: "birthDate", key: "birthDate" }];
            const drivenEntities: Entity<any>[] = [{
                id: "entity-1",
                path: "users",
                values: { birthDate }
            }];

            expect(getEntityCSVExportableData(drivenEntities, undefined, mockProperties, headers, "timestamp"))
                .toEqual([[birthDate.getTime()]]);
        });

        test("an unreadable date is exported as it arrived, not as a timestamp", () => {
            const headers = [{ label: "birthDate", key: "birthDate" }];
            const entities: Entity<any>[] = [{
                id: "entity-1",
                path: "users",
                values: { birthDate: "not a date" }
            }];

            expect(getEntityCSVExportableData(entities, undefined, mockProperties, headers, "timestamp"))
                .toEqual([["not a date"]]);
        });

        test("should merge additionalData columns correctly", () => {
            const headers = [
                { label: "id", key: "id" },
                { label: "name", key: "name" },
                { label: "extraColumn", key: "extraColumn" }
            ];

            const additionalData = [
                { extraColumn: "ExtraAlice" },
                { extraColumn: "ExtraBob" }
            ];

            const result = getEntityCSVExportableData(
                mockEntities,
                additionalData,
                mockProperties,
                headers,
                "string"
            );

            expect(result).toEqual([
                ["entity-1", "Alice", "ExtraAlice"],
                ["entity-2", "Bob", "ExtraBob"]
            ]);
        });
    });

    describe("getEntityJsonExportableData", () => {
        test("should process and return processed objects array", () => {
            const result = getEntityJsonExportableData(
                mockEntities,
                undefined,
                mockProperties,
                "string"
            );

            expect(result).toEqual([
                {
                    id: "entity-1",
                    name: "Alice",
                    age: 30,
                    birthDate: birthDate.toISOString(),
                    favoriteUser: "custom:::users/user-99"
                },
                {
                    id: "entity-2",
                    name: "Bob",
                    age: 25,
                    birthDate: birthDate.toISOString(),
                    favoriteUser: null
                }
            ]);
        });

        test("should merge additionalData for JSON export", () => {
            const additionalData = [
                { extraJsonField: "data1" },
                { extraJsonField: "data2" }
            ];

            const result = getEntityJsonExportableData(
                mockEntities,
                additionalData,
                mockProperties,
                "string"
            );

            expect(result).toEqual([
                {
                    id: "entity-1",
                    name: "Alice",
                    age: 30,
                    birthDate: birthDate.toISOString(),
                    favoriteUser: "custom:::users/user-99",
                    extraJsonField: "data1"
                },
                {
                    id: "entity-2",
                    name: "Bob",
                    age: 25,
                    birthDate: birthDate.toISOString(),
                    favoriteUser: null,
                    extraJsonField: "data2"
                }
            ]);
        });
    });

    /**
     * The admin's rows carry an `EntityRelation` for every relation — even one
     * nobody included, built from the foreign key — and a geopoint is an
     * object. `toCSVCell` ran `String()` on both, so every such cell in the
     * file read `[object Object]`.
     */
    describe("relations and geopoints", () => {
        const properties: Properties = {
            title: { type: "string" },
            author: { type: "relation", relation: { target: "authors", kind: "belongsTo" } },
            tags: { type: "relation", relation: { target: "tags", kind: "manyToMany" } },
            location: { type: "geopoint" }
        };
        const entities: Entity<any>[] = [{
            id: 1,
            path: "posts",
            values: {
                title: "A",
                author: new EntityRelation(7, "authors"),
                tags: [
                    new EntityRelation(3, "tags", { id: 3, path: "tags", values: { name: "x" } }),
                    new EntityRelation("t-4", "tags")
                ],
                location: new GeoPoint(41.9, 12.5)
            }
        }, {
            id: 2,
            path: "posts",
            values: {
                title: "B",
                author: null,
                tags: [],
                location: { latitude: -33.9, longitude: 18.4 }
            }
        }];
        const headers = ["id", "title", "author", "tags", "location"].map(key => ({ key, label: key }));

        test("a CSV export writes a relation as its id and a geopoint as JSON", () => {
            const rows = getEntityCSVExportableData(entities, undefined, properties, headers, "string");
            const csv = rows.map(row => entryToCSVRow(row)).join("");

            expect(csv).not.toContain("[object Object]");
            expect(csv).toEqual(
                "\"1\",\"A\",\"7\",\"[3,\"\"t-4\"\"]\",\"{\"\"latitude\"\":41.9,\"\"longitude\"\":12.5}\"\r\n"
                + "\"2\",\"B\",,\"[]\",\"{\"\"latitude\"\":-33.9,\"\"longitude\"\":18.4}\"\r\n");
        });

        test("a flattened CSV export writes one id per relation column", () => {
            const flatHeaders = [
                { key: "tags[0]", label: "tags[0]" },
                { key: "tags[1]", label: "tags[1]" }
            ];
            expect(getEntityCSVExportableData(entities, undefined, properties, flatHeaders, "string"))
                .toEqual([[3, "t-4"], [undefined, undefined]]);
        });

        test("a JSON export writes a relation as its id", () => {
            const [first] = getEntityJsonExportableData(entities, undefined, properties, "string");

            expect(first).toEqual({
                id: 1,
                title: "A",
                author: 7,
                tags: [3, "t-4"],
                location: { latitude: 41.9, longitude: 12.5 }
            });
        });

        test("a relation that arrived as its bare foreign key is exported as it is", () => {
            const bare: Entity<any>[] = [{ id: 1, path: "posts", values: { author: 7, tags: [3] } }];
            expect(getEntityJsonExportableData(bare, undefined, properties, "string"))
                .toEqual([{ id: 1, author: 7, tags: [3] }]);
        });

        test("a relation nested in an array property is exported as its id", () => {
            const arrayOfRelations: Properties = {
                tags: { type: "array", of: { type: "relation", relation: { target: "tags", kind: "manyToMany" } } }
            };
            const rows: Entity<any>[] = [{ id: 1, path: "posts", values: { tags: [new EntityRelation(3, "tags")] } }];
            expect(getEntityJsonExportableData(rows, undefined, arrayOfRelations, "string"))
                .toEqual([{ id: 1, tags: [3] }]);
        });

        test("an object in a cell of no declared type is written as JSON, not [object Object]", () => {
            expect(entryToCSVRow([{ a: 1 }])).toEqual("\"{\"\"a\"\":1}\"\r\n");
        });
    });

    describe("CSV formula escaping", () => {

        // Quoting is CSV escaping, not formula escaping: a spreadsheet strips
        // the quotes at parse time and then evaluates the cell.
        test.each([
            ["=HYPERLINK(\"https://evil.tld\",\"Refund\")"],
            ["+1+1"],
            ["-1+1"],
            ["@SUM(A1)"],
            ["\tcmd"],
            ["\rcmd"]
        ])("neutralises a cell starting with %j", (payload) => {
            expect(escapeCsvFormula(payload)).toEqual("'" + payload);
            expect(entryToCSVRow([payload])).toEqual("\"'" + payload.replaceAll("\"", "\"\"") + "\"\r\n");
        });

        test("leaves ordinary values, and negative numbers, alone", () => {
            expect(escapeCsvFormula("Alice")).toEqual("Alice");
            expect(escapeCsvFormula("-5")).toEqual("-5");
            expect(escapeCsvFormula("-12.5")).toEqual("-12.5");
            expect(entryToCSVRow([-5, "Alice"])).toEqual("\"-5\",\"Alice\"\r\n");
        });

        test("still escapes quotes, and escapes a formula inside an array cell", () => {
            expect(entryToCSVRow(["say \"hi\""])).toEqual("\"say \"\"hi\"\"\"\r\n");
            expect(entryToCSVRow([null, undefined])).toEqual(",\r\n");
        });
    });
});
