import { describe, expect, test } from "@jest/globals";
import { getSnapshotCSVExportableData, getSnapshotJsonExportableData } from "../../src/data_export/export/export";
import { Snapshot, Properties, SnapshotReference } from "@rebasepro/types";

describe("Export Utility Functions", () => {
    const mockProperties: Properties = {
        name: { type: "string" },
        age: { type: "number" },
        birthDate: { type: "date" },
        favoriteUser: { type: "reference", path: "users" }
    };

    const birthDate = new Date("1990-01-01T00:00:00.000Z");
    const mockReference = new SnapshotReference({ id: "user-99", path: "users", databaseId: "custom" });

    const mockSnapshots: Snapshot<any>[] = [
        {
            id: "snapshot-1",
            path: "users",
            values: {
                name: "Alice",
                age: 30,
                birthDate: birthDate,
                favoriteUser: mockReference
            }
        },
        {
            id: "snapshot-2",
            path: "users",
            values: {
                name: "Bob",
                age: 25,
                birthDate: birthDate,
                favoriteUser: null
            }
        }
    ];

    describe("getSnapshotCSVExportableData", () => {
        test("should format snapshot values correctly with date as string", () => {
            const headers = [
                { label: "id", key: "id" },
                { label: "name", key: "name" },
                { label: "age", key: "age" },
                { label: "birthDate", key: "birthDate" },
                { label: "favoriteUser", key: "favoriteUser" }
            ];

            const result = getSnapshotCSVExportableData(
                mockSnapshots,
                undefined,
                mockProperties,
                headers,
                "string"
            );

            expect(result).toEqual([
                ["snapshot-1", "Alice", 30, birthDate.toISOString(), "custom:::users/user-99"],
                ["snapshot-2", "Bob", 25, birthDate.toISOString(), null]
            ]);
        });

        test("should format snapshot values correctly with date as timestamp", () => {
            const headers = [
                { label: "id", key: "id" },
                { label: "birthDate", key: "birthDate" }
            ];

            const result = getSnapshotCSVExportableData(
                mockSnapshots,
                undefined,
                mockProperties,
                headers,
                "timestamp"
            );

            expect(result).toEqual([
                ["snapshot-1", birthDate.getTime()],
                ["snapshot-2", birthDate.getTime()]
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

            const result = getSnapshotCSVExportableData(
                mockSnapshots,
                additionalData,
                mockProperties,
                headers,
                "string"
            );

            expect(result).toEqual([
                ["snapshot-1", "Alice", "ExtraAlice"],
                ["snapshot-2", "Bob", "ExtraBob"]
            ]);
        });
    });

    describe("getSnapshotJsonExportableData", () => {
        test("should process and return processed objects array", () => {
            const result = getSnapshotJsonExportableData(
                mockSnapshots,
                undefined,
                mockProperties,
                "string"
            );

            expect(result).toEqual([
                {
                    id: "snapshot-1",
                    name: "Alice",
                    age: 30,
                    birthDate: birthDate.toISOString(),
                    favoriteUser: "custom:::users/user-99"
                },
                {
                    id: "snapshot-2",
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

            const result = getSnapshotJsonExportableData(
                mockSnapshots,
                additionalData,
                mockProperties,
                "string"
            );

            expect(result).toEqual([
                {
                    id: "snapshot-1",
                    name: "Alice",
                    age: 30,
                    birthDate: birthDate.toISOString(),
                    favoriteUser: "custom:::users/user-99",
                    extraJsonField: "data1"
                },
                {
                    id: "snapshot-2",
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
