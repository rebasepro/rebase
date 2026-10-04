import { CollectionConfig } from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";

/**
 * A Firestore collection may declare where its driver stores it.
 *
 * `slug: "fs_diagnosis", path: "diagnosis"` is how one sits beside a Postgres
 * collection that already has the slug `diagnosis`. The admin addresses it by
 * the slug; its rows, and every reference to one, live at the path. The
 * registry knew only slugs and table names, so the rows were read from
 * `fs_diagnosis`, which does not exist, and a reference to `diagnosis/abc`
 * came back as a Postgres row.
 */

const locales: CollectionConfig = {
    name: "Locales",
    slug: "locales",
    engine: "firestore",
    dataSource: "firestore",
    properties: {}
};

/** A subcollection stored under a name of its own. */
const translations: CollectionConfig = {
    name: "Translations",
    slug: "translations",
    path: "i18n",
    engine: "firestore",
    dataSource: "firestore",
    properties: {}
};

const firestoreDiagnosis: CollectionConfig = {
    name: "Diagnosis (Firestore)",
    slug: "fs_diagnosis",
    path: "diagnosis",
    engine: "firestore",
    dataSource: "firestore",
    subcollections: () => [locales, translations],
    properties: {}
};

const postgresDiagnosis: CollectionConfig = {
    name: "Diagnosis",
    slug: "diagnosis",
    table: "diagnosis",
    properties: {}
};

/** A path with slashes of its own, and no collision. */
const joints: CollectionConfig = {
    name: "Joints",
    slug: "medico_joints",
    path: "medico/v2.0.0/joints",
    engine: "firestore",
    dataSource: "firestore",
    subcollections: () => [locales],
    properties: {}
};

/** Stored under its slug: nothing about it may change. */
const exercises: CollectionConfig = {
    name: "Exercises",
    slug: "exercises",
    engine: "firestore",
    dataSource: "firestore",
    subcollections: () => [locales],
    properties: {}
};

const registry = () => new CollectionRegistry([postgresDiagnosis, firestoreDiagnosis, joints, exercises]);

describe("CollectionRegistry and the path a driver stores a collection under", () => {

    describe("get", () => {
        it("finds a collection by the path it declares", () => {
            expect(registry().get("medico/v2.0.0/joints")?.slug).toBe("medico_joints");
        });

        it("keeps the slug ahead of a declared path when nothing says otherwise", () => {
            expect(registry().get("diagnosis")?.slug).toBe("diagnosis");
            expect(registry().get("fs_diagnosis")?.slug).toBe("fs_diagnosis");
        });

        it("prefers the collection of the driver it is asked for", () => {
            // By data source key, and by engine: a reference's `driver` may be either.
            expect(registry().get("diagnosis", "firestore")?.slug).toBe("fs_diagnosis");
            expect(registry().get("diagnosis", "postgres")?.slug).toBe("diagnosis");
            expect(registry().get("diagnosis", "(default)")?.slug).toBe("diagnosis");
            // A preference nothing matches changes nothing.
            expect(registry().get("exercises", "postgres")?.slug).toBe("exercises");
        });

        it("indexes a collection registered one at a time, as the server does", () => {
            const serverRegistry = new CollectionRegistry();
            serverRegistry.register(postgresDiagnosis);
            serverRegistry.register(firestoreDiagnosis);

            expect(serverRegistry.get("diagnosis")?.slug).toBe("diagnosis");
            expect(serverRegistry.get("diagnosis", "firestore")?.slug).toBe("fs_diagnosis");
        });
    });

    describe("resolveDataPath", () => {
        it("hands the driver the declared path, under every record and subcollection", () => {
            expect(registry().resolveDataPath("fs_diagnosis")).toBe("diagnosis");
            expect(registry().resolveDataPath("fs_diagnosis/abc/locales")).toBe("diagnosis/abc/locales");
            expect(registry().resolveDataPath("medico_joints/j1/locales")).toBe("medico/v2.0.0/joints/j1/locales");
        });

        it("translates a subcollection that declares a path of its own", () => {
            expect(registry().resolveDataPath("fs_diagnosis/abc/translations")).toBe("diagnosis/abc/i18n");
        });

        it("leaves a collection stored under its slug alone", () => {
            expect(registry().resolveDataPath("diagnosis")).toBe("diagnosis");
            expect(registry().resolveDataPath("exercises")).toBe("exercises");
            expect(registry().resolveDataPath("exercises/e1/locales")).toBe("exercises/e1/locales");
            expect(registry().resolveDataPath("not_registered/1/nested")).toBe("not_registered/1/nested");
        });
    });

    describe("resolveCollectionPath", () => {
        it("reads a stored reference back as the collection that stores it", () => {
            expect(registry().resolveCollectionPath("diagnosis", "firestore")).toBe("fs_diagnosis");
            expect(registry().resolveCollectionPath("diagnosis/abc/locales", "firestore")).toBe("fs_diagnosis/abc/locales");
            // No collision, so no preference needed.
            expect(registry().resolveCollectionPath("medico/v2.0.0/joints")).toBe("medico_joints");
            expect(registry().resolveCollectionPath("medico/v2.0.0/joints/j1/locales")).toBe("medico_joints/j1/locales");
        });

        it("reads a subcollection that declares a path of its own back to its slug", () => {
            expect(registry().resolveCollectionPath("diagnosis/abc/i18n", "firestore")).toBe("fs_diagnosis/abc/translations");
        });

        it("reads the same string as the Postgres collection's slug without a preference", () => {
            expect(registry().resolveCollectionPath("diagnosis")).toBe("diagnosis");
            expect(registry().resolveCollectionPath("diagnosis", "postgres")).toBe("diagnosis");
        });

        it("leaves a path that already names a collection by its slug alone", () => {
            expect(registry().resolveCollectionPath("fs_diagnosis", "firestore")).toBe("fs_diagnosis");
            expect(registry().resolveCollectionPath("exercises/e1/locales", "firestore")).toBe("exercises/e1/locales");
            expect(registry().resolveCollectionPath("not_registered", "firestore")).toBe("not_registered");
        });

        it("round-trips with resolveDataPath", () => {
            for (const path of ["fs_diagnosis", "fs_diagnosis/abc/locales", "fs_diagnosis/abc/translations", "medico_joints/j1/locales", "exercises/e1/locales"]) {
                expect(registry().resolveCollectionPath(registry().resolveDataPath(path), "firestore")).toBe(path);
            }
        });
    });
});
