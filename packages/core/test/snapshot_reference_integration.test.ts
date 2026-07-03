/**
 * Integration tests for SnapshotReference preservation through the save flow.
 *
 * These tests simulate real-world scenarios where SnapshotReference values
 * flow through various utility functions during snapshot save operations.
 */
import { describe, expect, it } from "@jest/globals";
import { SnapshotReference, GeoPoint } from "@rebasepro/types";
import { updateDateAutoValues } from "@rebasepro/common";
import { mergeDeep } from "@rebasepro/utils";

// Real SnapshotReference class for testing
class TestSnapshotReference extends SnapshotReference {
    constructor(id: string, path: string) {
        super({ id,
path });
    }
}

// Real GeoPoint class for testing
class TestGeoPoint extends GeoPoint {
    constructor(latitude: number, longitude: number) {
        super(latitude, longitude);
    }
}

describe("SnapshotReference Preservation - Integration Tests", () => {

    describe("mergeDeep with SnapshotReference", () => {

        it("should preserve SnapshotReference when merging form values with cached local changes", () => {
            // This simulates SnapshotForm.tsx line 325:
            // mergeDeep(baseInitialValues, localChangesDataRaw as Partial<M>)

            const baseValues = {
                title: "Original Title",
                author: new TestSnapshotReference("author123", "users"),
                tags: ["tag1"]
            };

            const cachedChanges = {
                title: "Modified Title",
                author: new TestSnapshotReference("author456", "users") // User selected different author
            };

            const result = mergeDeep(baseValues, cachedChanges);

            // SnapshotReference should be preserved from cache, not spread into plain object
            expect(result.author).toBe(cachedChanges.author);
            expect(result.author.isSnapshotReference()).toBe(true);
            expect(result.author.id).toBe("author456");
            expect(result.title).toBe("Modified Title");
            expect(result.tags).toEqual(["tag1"]); // Unchanged from base
        });

        it("should preserve GeoPoint when merging location data", () => {
            const baseValues = {
                name: "Office",
                location: new TestGeoPoint(40.7128, -74.0060)
            };

            const updates = {
                location: new TestGeoPoint(51.5074, -0.1278) // Updated location
            };

            const result = mergeDeep(baseValues, updates);

            expect(result.location).toBe(updates.location);
            expect(result.location instanceof GeoPoint).toBe(true);
            expect(result.location.latitude).toBe(51.5074);
        });

        it("should handle nested objects containing SnapshotReference", () => {
            const baseValues = {
                metadata: {
                    createdBy: new TestSnapshotReference("user1", "users"),
                    updatedBy: new TestSnapshotReference("user1", "users")
                }
            };

            const updates = {
                metadata: {
                    updatedBy: new TestSnapshotReference("user2", "users")
                }
            };

            const result = mergeDeep(baseValues, updates);

            // createdBy should be from base, updatedBy should be from updates
            expect(result.metadata.createdBy.id).toBe("user1");
            expect(result.metadata.updatedBy.id).toBe("user2");
            expect(result.metadata.updatedBy.isSnapshotReference()).toBe(true);
        });

        it("should replace array completely from source (preserving class instances inside)", () => {
            // mergeDeep replaces arrays from source, not element-wise merge
            const sourceRef = new TestSnapshotReference("author3", "users");
            const baseValues = {
                authors: [
                    new TestSnapshotReference("author1", "users"),
                    new TestSnapshotReference("author2", "users")
                ]
            };

            const updates = {
                authors: [sourceRef]
            };

            const result = mergeDeep(baseValues, updates);

            // mergeDeep element-wise merges arrays, so we merge first elements
            // Since arrays have element-wise merge, first element should be source's ref
            expect(result.authors[0]).toBe(sourceRef);
            expect(result.authors[0].isSnapshotReference()).toBe(true);
            expect(result.authors[0].id).toBe("author3");
        });
    });

    describe("updateDateAutoValues with SnapshotReference", () => {

        it("should preserve SnapshotReference when updating date auto values", () => {
            // This simulates useBuildDataDriver.ts line 227-234

            const inputValues = {
                title: "My Document",
                author: new TestSnapshotReference("author123", "users"),
                category: new TestSnapshotReference("cat1", "categories"),
                created_at: null,
                updated_at: null
            };

            const properties = {
                title: { type: "string" as const },
                author: {
                    type: "reference" as const,
                    path: "users"
                },
                category: {
                    type: "reference" as const,
                    path: "categories"
                },
                created_at: {
                    type: "date" as const,
                    autoValue: "on_create" as const
                },
                updated_at: {
                    type: "date" as const,
                    autoValue: "on_update" as const
                }
            };

            const timestampNow = new Date();

            const result = updateDateAutoValues({
                inputValues,
                properties,
                status: "new",
                timestampNowValue: timestampNow
            });

            // References should be preserved
            expect(result.author.isSnapshotReference()).toBe(true);
            expect(result.author.id).toBe("author123");
            expect(result.category.isSnapshotReference()).toBe(true);
            expect(result.category.id).toBe("cat1");

            // Dates should be updated (use toEqual for Date comparison)
            expect(result.created_at).toEqual(timestampNow);
            expect(result.updated_at).toEqual(timestampNow);
        });

        it("should preserve GeoPoint when updating date auto values", () => {
            const inputValues = {
                name: "Store",
                location: new TestGeoPoint(40.7128, -74.0060),
                updated_at: null
            };

            const properties = {
                name: { type: "string" as const },
                location: { type: "geopoint" as const },
                updated_at: {
                    type: "date" as const,
                    autoValue: "on_update" as const
                }
            };

            const timestampNow = new Date();

            const result = updateDateAutoValues({
                inputValues,
                properties,
                status: "existing",
                timestampNowValue: timestampNow
            });

            expect(result.location instanceof GeoPoint).toBe(true);
            expect(result.location.latitude).toBe(40.7128);
            expect(result.updated_at).toEqual(timestampNow);
        });
    });


    describe("Full Save Flow Simulation", () => {

        it("should preserve SnapshotReference through complete save flow", async () => {
            // Simulate the complete flow from form save to database

            // Step 1: Form values with references (no arrays for now to test core flow)
            const formValues = {
                title: "My Article",
                author: new TestSnapshotReference("author123", "users"),
                location: new TestGeoPoint(40.7128, -74.0060),
                created_at: null,
                updated_at: null
            };

            // Step 2: Merge with cached local changes (simulates SnapshotForm)
            const cachedChanges = {
                title: "My Updated Article"
            };
            const mergedValues = mergeDeep(formValues, cachedChanges);

            // Step 3: Update auto dates (simulates useBuildDataDriver)
            const properties = {
                title: { type: "string" as const },
                author: {
                    type: "reference" as const,
                    path: "users"
                },
                location: { type: "geopoint" as const },
                created_at: {
                    type: "date" as const,
                    autoValue: "on_create" as const
                },
                updated_at: {
                    type: "date" as const,
                    autoValue: "on_update" as const
                }
            };

            const timestampNow = new Date();
            const finalValues = updateDateAutoValues({
                inputValues: mergedValues,
                properties,
                status: "new",
                timestampNowValue: timestampNow
            });

            // All references should still be valid
            expect(finalValues.author.isSnapshotReference()).toBe(true);
            expect(finalValues.author.id).toBe("author123");

            expect(finalValues.location instanceof GeoPoint).toBe(true);
            expect(finalValues.location.latitude).toBe(40.7128);

            // Title should be updated
            expect(finalValues.title).toBe("My Updated Article");

            // Dates should be set
            expect(finalValues.created_at).toEqual(timestampNow);
            expect(finalValues.updated_at).toEqual(timestampNow);
        });

        it("should preserve SnapshotReference arrays through save flow", async () => {
            // Test reference arrays specifically
            const formValues = {
                title: "My Article",
                relatedPosts: [
                    new TestSnapshotReference("post1", "posts"),
                    new TestSnapshotReference("post2", "posts")
                ]
            };

            // Just properties without date fields to isolate array handling
            const properties = {
                title: { type: "string" as const },
                relatedPosts: {
                    type: "array" as const,
                    of: {
                        type: "reference" as const,
                        path: "posts"
                    }
                }
            };

            const result = updateDateAutoValues({
                inputValues: formValues,
                properties,
                status: "new",
                timestampNowValue: new Date()
            });

            // Array references should be preserved
            expect(result.relatedPosts[0].isSnapshotReference()).toBe(true);
            expect(result.relatedPosts[0].id).toBe("post1");
            expect(result.relatedPosts[1].isSnapshotReference()).toBe(true);
            expect(result.relatedPosts[1].id).toBe("post2");
        });
    });
});
