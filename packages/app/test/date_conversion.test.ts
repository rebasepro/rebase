/**
 * Test to reproduce the Date-to-string conversion bug.
 *
 * The bug occurs when saving a entity with a date field that has autoValue.
 * The date gets converted to an ISO string at some point, causing validation
 * to fail with: "updated_on must be a `object` type, but the final value was: `2026-01-26T12:40:43.083Z`"
 *
 * This test simulates the save flow to identify where the conversion happens.
 */
import { describe, expect, it } from "@jest/globals";
import { updateDateAutoValues, traverseValuesProperties } from "@rebasepro/common";
import { Properties, DateProperty, EntityReference, GeoPoint } from "@rebasepro/types";
import { mergeDeep, removeFunctions, removeUndefined } from "@rebasepro/utils";
import { getEntityFromCache, saveEntityToCache } from "../src/util/entity_cache";

// Helper to create a date property with autoValue
function createAutoDateProperty(autoValue: "on_create" | "on_update"): DateProperty {
    return {
        type: "date",
        name: autoValue === "on_create" ? "Created On" : "Updated On",
        autoValue,
        readOnly: true,
        validation: { required: true }
    } as DateProperty;
}

describe("Date-to-String Conversion Bug", () => {

    describe("updateDateAutoValues preserves Date objects", () => {
        it("should return Date objects, not ISO strings", () => {
            const inputValues = {
                title: "Test Document",
                created_on: null,
                updated_on: null
            };

            const properties: Properties = {
                title: { type: "string" as const },
                created_on: createAutoDateProperty("on_create"),
                updated_on: createAutoDateProperty("on_update")
            };

            const timestampNow = new Date();

            const result = updateDateAutoValues({
                inputValues,
                properties,
                status: "new",
                timestampNowValue: timestampNow
            });

            // Dates should be Date objects, not strings. `toBeInstanceOf(Date)`
            // already rules out a string, so the value itself is what is worth
            // pinning: both auto-values are stamped with the supplied "now".
            expect(result.created_on).toBeInstanceOf(Date);
            expect(result.updated_on).toBeInstanceOf(Date);
            expect(result.created_on).toEqual(timestampNow);
            expect(result.updated_on).toEqual(timestampNow);
        });

        it("should preserve Date objects when updating existing entities", () => {
            const existingDate = new Date("2025-01-01T10:00:00Z");
            const inputValues = {
                title: "Existing Document",
                created_on: existingDate,
                updated_on: existingDate
            };

            const properties: Properties = {
                title: { type: "string" as const },
                created_on: createAutoDateProperty("on_create"),
                updated_on: createAutoDateProperty("on_update")
            };

            const timestampNow = new Date();

            const result = updateDateAutoValues({
                inputValues,
                properties,
                status: "existing",
                timestampNowValue: timestampNow
            });

            // created_on should preserve original Date (on_create only sets on new)
            expect(result.created_on).toBeInstanceOf(Date);
            expect(result.created_on).toEqual(existingDate);

            // updated_on should be updated to new Date
            expect(result.updated_on).toBeInstanceOf(Date);
            expect(result.updated_on).toEqual(timestampNow);
        });
    });

    describe("mergeDeep preserves Date objects", () => {
        it("should not convert Date objects to strings", () => {
            const baseValues = {
                title: "Document",
                updated_on: new Date("2025-01-01T10:00:00Z")
            };

            const updates = {
                title: "Updated Document"
            };

            const result = mergeDeep(baseValues, updates);

            expect(result.updated_on).toBeInstanceOf(Date);
            expect(typeof result.updated_on).not.toBe("string");
        });

        it("should preserve Date when source has a new Date", () => {
            const now = new Date();
            const baseValues = {
                updated_on: null
            };

            const updates = {
                updated_on: now
            };

            const result = mergeDeep(baseValues, updates);

            expect(result.updated_on).toBeInstanceOf(Date);
            expect(result.updated_on).toEqual(now); // Should have the same timestamp
        });
    });

    describe("removeFunctions preserves Date objects", () => {
        it("should not convert Date objects to strings", () => {
            const values = {
                title: "Document",
                updated_on: new Date("2025-01-01T10:00:00Z"),
                callback: () => console.log("test")
            };

            const result = removeFunctions(values);

            expect(result.updated_on).toBeInstanceOf(Date);
            expect(typeof result.updated_on).not.toBe("string");
            expect(result.callback).toBeUndefined(); // Function should be removed
        });
    });

    describe("removeUndefined preserves Date objects", () => {
        it("should not convert Date objects to strings", () => {
            const values = {
                title: "Document",
                updated_on: new Date("2025-01-01T10:00:00Z"),
                empty: undefined
            };

            const result = removeUndefined(values);

            expect(result.updated_on).toBeInstanceOf(Date);
            expect(typeof result.updated_on).not.toBe("string");
            expect(result.empty).toBeUndefined(); // empty key should be removed from result
            expect("empty" in result).toBe(false);
        });
    });

    describe("Full save flow simulation (without validation)", () => {
        it("should preserve Date objects through the complete save flow", () => {
            // Step 1: Initial form values (simulating what comes from the form)
            const formValues = {
                title: "My Document",
                created_on: null,
                updated_on: null
            };

            const properties: Properties = {
                title: { type: "string" as const,
name: "Title" },
                created_on: createAutoDateProperty("on_create"),
                updated_on: createAutoDateProperty("on_update")
            };

            // Step 2: Apply date auto values (simulates useBuildDataDriver)
            const timestampNow = new Date();
            const valuesWithDates = updateDateAutoValues({
                inputValues: formValues,
                properties,
                status: "new",
                timestampNowValue: timestampNow
            });

            // Verify dates are Date objects at this point
            expect(valuesWithDates.created_on).toBeInstanceOf(Date);
            expect(valuesWithDates.updated_on).toBeInstanceOf(Date);

            // Step 3: Merge with any cached changes
            const cachedChanges = { title: "My Updated Document" };
            const mergedValues = mergeDeep(valuesWithDates, cachedChanges);

            // Verify dates are still Date objects after merge
            expect(mergedValues.created_on).toBeInstanceOf(Date);
            expect(mergedValues.updated_on).toBeInstanceOf(Date);

            // Step 4: Remove functions (cleanup for saving)
            const cleanedValues = removeFunctions(mergedValues);

            // Verify dates are still Date objects after cleanup
            expect(cleanedValues.created_on).toBeInstanceOf(Date);
            expect(cleanedValues.updated_on).toBeInstanceOf(Date);
        });

        it("should preserve Date objects when updating an existing entity", () => {
            const existingCreatedOn = new Date("2024-01-01T10:00:00Z");

            // Existing entity values (simulating what comes from the database)
            const existingValues = {
                title: "Existing Document",
                created_on: existingCreatedOn,
                updated_on: existingCreatedOn
            };

            const properties: Properties = {
                title: { type: "string" as const,
name: "Title" },
                created_on: createAutoDateProperty("on_create"),
                updated_on: createAutoDateProperty("on_update")
            };

            // Form values with an update
            const formValues = {
                ...existingValues,
                title: "Updated Title"
            };

            // Apply date auto values for existing entity
            const timestampNow = new Date();
            const valuesWithDates = updateDateAutoValues({
                inputValues: formValues,
                properties,
                status: "existing",
                timestampNowValue: timestampNow
            });

            // created_on should remain the original Date
            expect(valuesWithDates.created_on).toBeInstanceOf(Date);
            expect(valuesWithDates.created_on).toEqual(existingCreatedOn);

            // updated_on should be the new Date
            expect(valuesWithDates.updated_on).toBeInstanceOf(Date);
            expect(valuesWithDates.updated_on).toEqual(timestampNow);
        });
    });

    // The entity cache is the one place in this package that puts values
    // through JSON, which is where a Date would silently degrade to an ISO
    // string. It defends itself with a replacer/reviver pair — that pair is
    // what this block exercises.
    describe("entity cache round-trip preserves Date objects", () => {

        it("revives a Date saved to the cache as a Date, not an ISO string", () => {
            const updatedOn = new Date("2025-01-01T10:00:00Z");
            saveEntityToCache("products/date-round-trip", { updated_on: updatedOn });

            const cached = getEntityFromCache("products/date-round-trip") as { updated_on: Date };

            expect(cached.updated_on).toBeInstanceOf(Date);
            expect(cached.updated_on.toISOString()).toBe("2025-01-01T10:00:00.000Z");
        });

        it("revives nested Date objects, not just top-level ones", () => {
            saveEntityToCache("products/nested-date", {
                metadata: {
                    history: [{ at: new Date("2024-06-30T23:59:59Z") }]
                }
            });

            const cached = getEntityFromCache("products/nested-date") as {
                metadata: { history: { at: Date }[] }
            };

            expect(cached.metadata.history[0].at).toBeInstanceOf(Date);
            expect(cached.metadata.history[0].at.toISOString()).toBe("2024-06-30T23:59:59.000Z");
        });

        it("keeps a plain ISO string a string, so the reviver cannot over-reach", () => {
            saveEntityToCache("products/string-date", { note: "2025-01-01T10:00:00.000Z" });

            const cached = getEntityFromCache("products/string-date") as { note: unknown };

            expect(typeof cached.note).toBe("string");
        });
    });
});
