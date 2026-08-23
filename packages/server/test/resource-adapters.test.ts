/**
 * The graph translated into the shapes the data and storage layers take, and
 * the refusal of the keys it replaced.
 */
import {
    assertNoReplacedResourceConfig,
    graphToDataSources,
    graphToStorageSources,
    graphTopics,
    replacedResourceConfigKeys
} from "../src/boot/resource-adapters";
import {
    DEFAULT_DATA_SOURCE_KEY,
    DEFAULT_STORAGE_SOURCE_KEY,
    buildResourceGraph,
    bucket,
    database,
    resetDeclaredResources,
    topic
} from "@rebasepro/types";

beforeEach(() => resetDeclaredResources());

describe("translating", () => {
    it("maps databases, keeping engine, transport and databaseId", () => {
        database("analytics", { databaseId: "reporting", label: "Reporting" });
        expect(graphToDataSources(buildResourceGraph())).toEqual([
            { key: "analytics", engine: "postgres", transport: "server", databaseId: "reporting", label: "Reporting" }
        ]);
    });

    it("maps buckets", () => {
        bucket("media", { engine: "s3", transport: "direct" });
        expect(graphToStorageSources(buildResourceGraph())).toEqual([
            { key: "media", engine: "s3", transport: "direct" }
        ]);
    });

    it("spells the default key the way each subsystem spells it", () => {
        // Three separate constants that happen to agree today. Mapped
        // explicitly so a future divergence is a compile error rather than a
        // default database that silently fails to bind.
        database();
        bucket();
        expect(graphToDataSources(buildResourceGraph())[0].key).toBe(DEFAULT_DATA_SOURCE_KEY);
        expect(graphToStorageSources(buildResourceGraph())[0].key).toBe(DEFAULT_STORAGE_SOURCE_KEY);
    });

    it("keeps the kinds apart", () => {
        database("main");
        bucket("media");
        topic("signups");
        const graph = buildResourceGraph();
        expect(graphToDataSources(graph)).toHaveLength(1);
        expect(graphToStorageSources(graph)).toHaveLength(1);
        expect(graphTopics(graph).map(t => t.key)).toEqual(["signups"]);
    });

    it("is empty for a project that declares nothing of that kind", () => {
        database("main");
        expect(graphToStorageSources(buildResourceGraph())).toEqual([]);
    });
});

describe("the clean break", () => {
    it("refuses dataSources, naming the replacement", () => {
        expect(() => assertNoReplacedResourceConfig({ dataSources: [] }))
            .toThrow(/`dataSources` is no longer read.*database\("<key>"\).*rebase resources --write/s);
    });

    it("refuses storageSources, naming the replacement", () => {
        expect(() => assertNoReplacedResourceConfig({ storageSources: [] }))
            .toThrow(/`storageSources` is no longer read.*bucket\("<key>"\)/s);
    });

    it("says why it refuses rather than ignoring", () => {
        // The old storage path accepted a `storageSources` export, merged it
        // with rebase.json and discarded whichever engine lost. Leaving the key
        // readable but inert would reproduce that with better intentions.
        expect(() => assertNoReplacedResourceConfig({ storageSources: [] }))
            .toThrow(/accepted and then does nothing is the failure this replaced/);
    });

    it("refuses an empty array too, because declaring nothing is still declaring", () => {
        expect(() => assertNoReplacedResourceConfig({ dataSources: [] })).toThrow();
    });

    it("passes a config carrying neither", () => {
        expect(() => assertNoReplacedResourceConfig({ collections: [], auth: {} })).not.toThrow();
    });

    it("pins the list, so removing a refusal is a deliberate edit", () => {
        expect(replacedResourceConfigKeys().sort()).toEqual(["dataSources", "storageSources"]);
    });
});
