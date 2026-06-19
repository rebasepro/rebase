import { describe, expect, test } from "@jest/globals";
import { getEntityCSVExportableData, getEntityJsonExportableData } from "../../src/data_export/export/export";
import { Entity, Properties, EntityReference } from "@rebasepro/types";

describe("Export Utility Functions", () => {
    const mockProperties: Properties = {
        name: { type: "string" },
        age: { type: "number" },
        birthDate: { type: "date" },
        favoriteUser: { type: "reference", path: "users" }
    };

    const birthDate = new Date("1990-01-01T00:00:00.000Z");
    const mockReference = new EntityReference({ id: "user-99", path: "users", databaseId: "custom" });

    const mockEntities: Entity<any>[] = [
        {
            id: "entity-1",
            path: "users",
            values: {
                name: "Alice",
                age: 30,
                birthDate: birthDate,
                favoriteUser: mockReference
            }
        },
        {
            id: "entity-2",
            path: "users",
            values: {
                name: "Bob",
                age: 25,
                birthDate: birthDate,
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
});
