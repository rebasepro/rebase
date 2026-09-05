import type { CollectionConfig } from "@rebasepro/types";
import { collectionsStoredBy } from "../src/boot/provision";
import type { InitializedDataSource } from "../src/boot/driver";

/**
 * Which collections boot hands to a data source's bootstrapper.
 *
 * A bundle's collections directory holds every collection the project declares,
 * whatever engine serves it. Boot used to hand all of them to the primary
 * source, so a project with Postgres collections and Firestore collections side
 * by side booted with empty Postgres tables — and RLS policies — named after
 * its Firestore documents.
 */

const source = (key: string, engine: string): InitializedDataSource =>
    ({ key, engine } as unknown as InitializedDataSource);

const collection = (slug: string, routing: { engine?: string; dataSource?: string } = {}): CollectionConfig =>
    ({ slug, name: slug, properties: {}, ...routing } as unknown as CollectionConfig);

describe("collectionsStoredBy", () => {
    const postgres = source("(default)", "postgres");

    it("keeps a collection that declares no routing at all", () => {
        // The engine `resolveDataSource` falls back to is a default, not a
        // declaration — it must not exclude anything by itself.
        const collections = [collection("users")];
        expect(collectionsStoredBy(collections, postgres, [postgres])).toEqual(collections);
    });

    it("drops a collection declaring another engine", () => {
        const collections = [collection("users"), collection("exercises", { engine: "firestore" })];
        expect(collectionsStoredBy(collections, postgres, [postgres]).map(c => c.slug)).toEqual(["users"]);
    });

    it("drops a collection routed by dataSource key alone", () => {
        const collections = [collection("users"), collection("articles", { dataSource: "firestore" })];
        expect(collectionsStoredBy(collections, postgres, [postgres]).map(c => c.slug)).toEqual(["users"]);
    });

    it("hands a second source on the same engine its own collections, and nothing else", () => {
        // Two Postgres databases are two stores. Filtering by engine used to
        // hand `events` to the default, which created its table in the
        // default database and left the analytics one empty — every query
        // routed there then failed on a missing relation.
        const analytics = source("analytics", "postgres");
        const collections = [collection("users"), collection("events", { dataSource: "analytics" })];

        expect(collectionsStoredBy(collections, postgres, [postgres, analytics]).map(c => c.slug))
            .toEqual(["users"]);
        expect(collectionsStoredBy(collections, analytics, [postgres, analytics]).map(c => c.slug))
            .toEqual(["events"]);
    });

    it("a source of another engine never takes a collection that names a different one", () => {
        // `dataSource: "warehouse"` routes to the warehouse source; a
        // collection there that also declares `engine: "mongodb"` is not a
        // warehouse table whatever key it names.
        const warehouse = source("warehouse", "postgres");
        const collections = [
            collection("facts", { dataSource: "warehouse" }),
            collection("docs", { dataSource: "warehouse", engine: "mongodb" })
        ];

        expect(collectionsStoredBy(collections, warehouse, [postgres, warehouse]).map(c => c.slug))
            .toEqual(["facts"]);
        expect(collectionsStoredBy(collections, postgres, [postgres, warehouse])).toEqual([]);
    });

    it("hands a Mongo primary its own collections", () => {
        const mongo = source("(default)", "mongodb");
        const collections = [collection("users"), collection("logs", { engine: "mongodb" }), collection("rows", { engine: "postgres" })];

        expect(collectionsStoredBy(collections, mongo, [mongo]).map(c => c.slug)).toEqual(["users", "logs"]);
    });
});
