/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { EntityReference, type CollectionConfig } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { CollectionScopeProvider } from "@rebasepro/app";
import { useBuildCollectionRegistryController } from "../../src/hooks/navigation/useBuildCollectionRegistryController";
import { CollectionRegistryContext } from "../../src/hooks/navigation/contexts/CollectionRegistryContext";
import { useReferencePaths } from "../../src/hooks/useReferencePaths";

/**
 * A reference stores where its driver keeps the record; the admin looks the
 * collection up, lists and fetches by the slug.
 *
 * `fs_diagnosis` is stored at `diagnosis`, beside a Postgres collection whose
 * slug is `diagnosis`. A reference picked in a form was stored as
 * `fs_diagnosis/abc`, which the Firestore driver wrote as a reference to a
 * collection that does not exist, and one read back as `diagnosis/abc` was
 * previewed from the Postgres table.
 */

const firestoreDiagnosis: CollectionConfig = {
    name: "Diagnosis (Firestore)",
    slug: "fs_diagnosis",
    path: "diagnosis",
    engine: "firestore",
    dataSource: "firestore",
    properties: {}
};

const postgresDiagnosis: CollectionConfig = {
    name: "Diagnosis",
    slug: "diagnosis",
    table: "diagnosis",
    properties: {}
};

const exercises: CollectionConfig = {
    name: "Exercises",
    slug: "exercises",
    engine: "firestore",
    dataSource: "firestore",
    properties: {}
};

const firestoreSymptoms: CollectionConfig = {
    name: "Symptoms (Firestore)",
    slug: "fs_symptoms",
    path: "symptoms",
    engine: "firestore",
    dataSource: "firestore",
    properties: {}
};

function renderReferencePaths(scope?: CollectionConfig) {
    const registry = renderHook(() => useBuildCollectionRegistryController({}));
    act(() => {
        registry.result.current.collectionRegistryRef.current.registerMultiple([postgresDiagnosis, firestoreDiagnosis, exercises, firestoreSymptoms]);
    });
    registry.rerender();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CollectionRegistryContext.Provider value={registry.result.current}>
            <CollectionScopeProvider collection={scope as AdminCollection | undefined}>{children}</CollectionScopeProvider>
        </CollectionRegistryContext.Provider>
    );
    return {
        controller: registry.result.current,
        paths: renderHook(() => useReferencePaths(), { wrapper }).result.current
    };
}

describe("useReferencePaths", () => {

    it("reads a stored path as the collection in the scope's store", () => {
        // A reference read from a Firestore record points into Firestore.
        const { paths, controller } = renderReferencePaths(exercises);

        expect(paths.toCollectionPath("diagnosis")).toBe("fs_diagnosis");
        expect(controller.getCollection(paths.toCollectionPath("diagnosis"))?.name).toBe("Diagnosis (Firestore)");
        // A property's `path` written as the slug reads the same.
        expect(paths.toCollectionPath("fs_diagnosis")).toBe("fs_diagnosis");
    });

    it("reads it as the Postgres collection outside a Firestore scope", () => {
        expect(renderReferencePaths(postgresDiagnosis).paths.toCollectionPath("diagnosis")).toBe("diagnosis");
        expect(renderReferencePaths().paths.toCollectionPath("diagnosis")).toBe("diagnosis");
    });

    it("lets a reference's own driver decide over the scope", () => {
        expect(renderReferencePaths(postgresDiagnosis).paths.toCollectionPath("diagnosis", "firestore")).toBe("fs_diagnosis");
    });

    it("stores a picked record under the path its driver keeps it at", () => {
        const { paths } = renderReferencePaths(exercises);

        const reference = paths.referenceTo({ id: "abc", path: "fs_diagnosis", values: {} });
        expect(reference).toBeInstanceOf(EntityReference);
        expect(reference.pathWithId).toBe("diagnosis/abc");
        expect(paths.referenceTo({ id: "e1", path: "exercises", values: {} }).pathWithId).toBe("exercises/e1");
    });

    it("hands a path back exactly as given when there is nothing to translate", () => {
        const { controller } = renderReferencePaths();

        expect(controller.resolveDataPath("/fs_diagnosis/")).toBe("diagnosis");
        expect(controller.resolveDataPath("/exercises/")).toBe("/exercises/");
        expect(controller.resolveCollectionPath("/diagnosis/", "firestore")).toBe("fs_diagnosis");
        expect(controller.resolveCollectionPath("/diagnosis/")).toBe("/diagnosis/");
    });

    it("reads a reference property's path as the slug of its target, on any data source", () => {
        // A Firestore field targeting `diagnosis` means the Postgres
        // collection, even though a Firestore collection is stored there:
        // a property names its target the way the admin addresses it.
        const { paths } = renderReferencePaths(exercises);

        expect(paths.targetPath("diagnosis")).toBe("diagnosis");
        expect(paths.targetPath("fs_diagnosis")).toBe("fs_diagnosis");
        // A store path no collection has as its slug still finds its collection.
        expect(paths.targetPath("symptoms")).toBe("fs_symptoms");
        // While the same string read back from a Firestore record is a Firestore path.
        expect(paths.toCollectionPath("diagnosis")).toBe("fs_diagnosis");
    });

    it("marks a picked record of another data source with that source, so it routes there and is stored as its id", () => {
        const { paths } = renderReferencePaths(exercises);

        const toPostgres = paths.referenceTo({ id: "abc", path: "diagnosis", values: {} });
        expect(toPostgres.driver).toBe("(default)");
        expect(toPostgres.pathWithId).toBe("diagnosis/abc");
        // Read back with that driver, it is the Postgres collection, not the
        // Firestore one stored at the same path.
        expect(paths.toCollectionPath(toPostgres.path, toPostgres.driver)).toBe("diagnosis");

        // Within the scope's own source nothing changes.
        expect(paths.referenceTo({ id: "abc", path: "fs_diagnosis", values: {} }).driver).toBeUndefined();

        // From a Postgres form, a Firestore record is the other source.
        const toFirestore = renderReferencePaths(postgresDiagnosis).paths.referenceTo({ id: "abc", path: "fs_diagnosis", values: {} });
        expect(toFirestore.driver).toBe("firestore");
        expect(toFirestore.pathWithId).toBe("diagnosis/abc");
    });
});
