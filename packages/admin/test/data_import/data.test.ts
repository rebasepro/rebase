import { describe, expect, test, jest } from "@jest/globals";
import { flattenEntry, processValueMapping, convertDataToEntity } from "../../src/data_import/utils/data";
import { CollectionRegistryController, EntityReference, Property, Properties, Vector, CollectionConfig } from "@rebasepro/types";
import { AuthController } from "@rebasepro/admin-types";

describe("Data Import Utility Functions", () => {
    const mockAuth = {} as AuthController;
    const mockNavigation = {
        getCollection: jest.fn().mockImplementation((path: string) => {
            if (path === "users") {
                return { databaseId: "custom-db" } as CollectionConfig<any>;
            }
            return undefined;
        })
    } as unknown as CollectionRegistryController;

    describe("flattenEntry", () => {
        test("should not modify flat objects", () => {
            const input = { a: 1, b: "string", c: true };
            expect(flattenEntry(input)).toEqual(input);
        });

        test("should flatten nested objects using dot notation", () => {
            const input = {
                a: 1,
                b: {
                    c: 2,
                    d: {
                        e: 3
                    }
                }
            };
            expect(flattenEntry(input)).toEqual({
                a: 1,
                "b.c": 2,
                "b.d.e": 3
            });
        });

        test("should not flatten arrays or Dates", () => {
            const date = new Date();
            const input = {
                arr: [1, 2, { a: 1 }],
                date: date,
                nested: {
                    date: date,
                    arr: [3, 4]
                }
            };
            expect(flattenEntry(input)).toEqual({
                arr: [1, 2, { a: 1 }],
                date: date,
                "nested.date": date,
                "nested.arr": [3, 4]
            });
        });
    });

    describe("processValueMapping", () => {
        test("should return null if value is null", () => {
            expect(processValueMapping(mockAuth, null, mockNavigation)).toBeNull();
        });

        test("should return value as-is if property is undefined", () => {
            expect(processValueMapping(mockAuth, "someValue", mockNavigation, undefined)).toBe("someValue");
        });

        test("should map vector type from array, string with brackets, or comma separated string", () => {
            const vectorProp: Property = { type: "vector" };

            // 1. From object with value field
            const result1 = processValueMapping(mockAuth, { value: [1.2, 3.4] }, mockNavigation, vectorProp);
            expect(result1).toBeInstanceOf(Vector);
            expect(result1.value).toEqual([1.2, 3.4]);

            // 2. From array
            const result2 = processValueMapping(mockAuth, [5.6, 7.8], mockNavigation, vectorProp);
            expect(result2).toBeInstanceOf(Vector);
            expect(result2.value).toEqual([5.6, 7.8]);

            // 3. From bracketed string
            const result3 = processValueMapping(mockAuth, "[9.0, 10.1]", mockNavigation, vectorProp);
            expect(result3).toBeInstanceOf(Vector);
            expect(result3.value).toEqual([9.0, 10.1]);

            // 4. From comma string
            const result4 = processValueMapping(mockAuth, "11.2, 12.3", mockNavigation, vectorProp);
            expect(result4).toBeInstanceOf(Vector);
            expect(result4.value).toEqual([11.2, 12.3]);
        });

        test("should map reference type correctly", () => {
            const refProp: Property = { type: "reference", path: "users" };

            // Reference with explicit DB name
            const ref1 = processValueMapping(mockAuth, "my-db:::users/user-1", mockNavigation, refProp) as EntityReference;
            expect(ref1).toBeInstanceOf(EntityReference);
            expect(ref1.id).toBe("user-1");
            expect(ref1.path).toBe("users");
            expect(ref1.databaseId).toBe("my-db");

            // Reference without DB name, resolving via navigation controller
            const ref2 = processValueMapping(mockAuth, "users/user-2", mockNavigation, refProp) as EntityReference;
            expect(ref2).toBeInstanceOf(EntityReference);
            expect(ref2.id).toBe("user-2");
            expect(ref2.path).toBe("users");
            expect(ref2.databaseId).toBe("custom-db");

            // Reference pointing to default DB or fallback
            const ref3 = processValueMapping(mockAuth, "(default):::posts/post-1", mockNavigation, refProp) as EntityReference;
            expect(ref3).toBeInstanceOf(EntityReference);
            expect(ref3.id).toBe("post-1");
            expect(ref3.path).toBe("posts");
            expect(ref3.databaseId).toBeUndefined();
        });

        // `Number("")` is 0 and `Number("n/a")` is NaN, so a spreadsheet column
        // mapped to a number used to import blanks as real zeros and typos as
        // NaN. A cell nobody filled in is absent, not nought.
        test("maps an empty or unreadable number cell to null, not to zero", () => {
            const number: Property = { type: "number" };
            expect(processValueMapping(mockAuth, "", mockNavigation, number)).toBeNull();
            expect(processValueMapping(mockAuth, "   ", mockNavigation, number)).toBeNull();
            expect(processValueMapping(mockAuth, "n/a", mockNavigation, number)).toBeNull();
            expect(processValueMapping(mockAuth, "—", mockNavigation, number)).toBeNull();
        });

        test("still reads the number cells that do carry a value", () => {
            const number: Property = { type: "number" };
            expect(processValueMapping(mockAuth, "0", mockNavigation, number)).toBe(0);
            expect(processValueMapping(mockAuth, " 42 ", mockNavigation, number)).toBe(42);
            expect(processValueMapping(mockAuth, "-3.5", mockNavigation, number)).toBe(-3.5);
            expect(processValueMapping(mockAuth, "1e3", mockNavigation, number)).toBe(1000);
        });

        test("should perform basic type conversions", () => {
            expect(processValueMapping(mockAuth, "123", mockNavigation, { type: "number" })).toBe(123);
            expect(processValueMapping(mockAuth, "true", mockNavigation, { type: "boolean" })).toBe(true);
            expect(processValueMapping(mockAuth, "false", mockNavigation, { type: "boolean" })).toBe(false);
            expect(processValueMapping(mockAuth, 1, mockNavigation, { type: "boolean" })).toBe(true);
            expect(processValueMapping(mockAuth, true, mockNavigation, { type: "number" })).toBe(1);
            expect(processValueMapping(mockAuth, false, mockNavigation, { type: "number" })).toBe(0);
            expect(processValueMapping(mockAuth, true, mockNavigation, { type: "string" })).toBe("true");
            expect(processValueMapping(mockAuth, 456, mockNavigation, { type: "string" })).toBe("456");
            expect(processValueMapping(mockAuth, "a, b, c", mockNavigation, { type: "array" })).toEqual(["a", "b", "c"]);

            const dateStr = "2026-06-19T11:00:00.000Z";
            const dateObj = processValueMapping(mockAuth, dateStr, mockNavigation, { type: "date" }) as Date;
            expect(dateObj).toBeInstanceOf(Date);
            expect(dateObj.toISOString()).toBe(dateStr);

            const timestamp = 1781866800000;
            const dateObjFromNum = processValueMapping(mockAuth, timestamp, mockNavigation, { type: "date" }) as Date;
            expect(dateObjFromNum).toBeInstanceOf(Date);
            expect(dateObjFromNum.getTime()).toBe(timestamp);
        });

        test("should map arrays of items", () => {
            const arrayProp: Property = {
                type: "array",
                of: { type: "number" }
            };
            const result = processValueMapping(mockAuth, "1,2,3", mockNavigation, arrayProp);
            expect(result).toEqual([1, 2, 3]);
        });
    });

    describe("convertDataToEntity", () => {
        test("should map raw data into Entity structure and merge defaults", () => {
            const properties: Properties = {
                firstName: { type: "string" },
                age: { type: "number" },
                isActive: { type: "boolean" }
            };

            const rawData = {
                "custom_id_col": "12345",
                "first_name_raw": "John",
                "age_raw": "30"
            };

            const headersMapping = {
                "first_name_raw": "firstName",
                "age_raw": "age"
            };

            const defaultValues = {
                isActive: true
            };

            const entity = convertDataToEntity(
                mockAuth,
                mockNavigation,
                rawData,
                "custom_id_col",
                headersMapping,
                properties,
                "users",
                defaultValues
            );

            expect(entity.id).toBe("12345");
            expect(entity.path).toBe("users");
            expect(entity.values).toEqual({
                firstName: "John",
                age: 30,
                isActive: true
            });
        });
    });
});
