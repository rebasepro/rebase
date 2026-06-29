import { resolveDataSource, createDataSourceRegistry } from "../src/data/resolveDataSource";
import { DataSourceDefinition } from "@rebasepro/types";

describe("resolveDataSource", () => {

    it("defaults to the '(default)' server Postgres source for a bare collection", () => {
        const r = resolveDataSource({});
        expect(r.key).toBe("(default)");
        expect(r.engine).toBe("postgres");
        expect(r.transport).toBe("server");
        expect(r.capabilities.supportsRelations).toBe(true);
    });

    it("treats legacy `driver` as both engine and routing key (back-compat)", () => {
        const r = resolveDataSource({ driver: "firestore" });
        expect(r.key).toBe("firestore");
        expect(r.engine).toBe("firestore");
        // No registry → transport defaults to server (engine still firestore).
        expect(r.transport).toBe("server");
        expect(r.capabilities.supportsSubcollections).toBe(true);
    });

    it("prefers `dataSource` over legacy `driver` for the routing key", () => {
        const r = resolveDataSource({ dataSource: "analytics", driver: "firestore" });
        expect(r.key).toBe("analytics");
    });

    it("pulls engine/transport/databaseId from a registered definition", () => {
        const registry = createDataSourceRegistry([
            { key: "analytics", engine: "firestore", transport: "direct", databaseId: "metrics" }
        ]);
        const r = resolveDataSource({ dataSource: "analytics" }, registry);
        expect(r.key).toBe("analytics");
        expect(r.engine).toBe("firestore");
        expect(r.transport).toBe("direct");
        expect(r.databaseId).toBe("metrics");
        expect(r.capabilities.supportsReferences).toBe(true);
    });

    it("lets the collection's databaseId override the definition's", () => {
        const registry = createDataSourceRegistry([
            { key: "shards", engine: "postgres", transport: "server", databaseId: "shard_default" }
        ]);
        const r = resolveDataSource({ dataSource: "shards", databaseId: "shard_7" }, registry);
        expect(r.databaseId).toBe("shard_7");
    });

    it("two postgres data sources share postgres capabilities", () => {
        const registry = createDataSourceRegistry([
            { key: "(default)", engine: "postgres", transport: "server" },
            { key: "reporting", engine: "postgres", transport: "server", databaseId: "reporting_db" }
        ]);
        const a = resolveDataSource({}, registry);
        const b = resolveDataSource({ dataSource: "reporting" }, registry);
        expect(a.engine).toBe("postgres");
        expect(b.engine).toBe("postgres");
        expect(b.capabilities).toEqual(a.capabilities);
        expect(b.databaseId).toBe("reporting_db");
    });

    it("synthesizes engine from a custom key when no definition and no driver", () => {
        const r = resolveDataSource({ dataSource: "myEngine" });
        expect(r.key).toBe("myEngine");
        expect(r.engine).toBe("myEngine");
    });

    it("falls back to server transport for a dataSource key absent from the registry", () => {
        const registry = createDataSourceRegistry([
            { key: "analytics", engine: "firestore", transport: "direct" }
        ]);
        // "reporting" is not registered → engine from key, transport server.
        const r = resolveDataSource({ dataSource: "reporting" }, registry);
        expect(r.key).toBe("reporting");
        expect(r.transport).toBe("server");
        expect(r.engine).toBe("reporting");
    });

    it("surfaces a custom transport from the definition", () => {
        const registry = createDataSourceRegistry([
            { key: "legacy", engine: "postgres", transport: "custom" }
        ]);
        const r = resolveDataSource({ dataSource: "legacy" }, registry);
        expect(r.transport).toBe("custom");
        expect(r.engine).toBe("postgres");
    });

    it("passes through the collection databaseId without a registry", () => {
        const r = resolveDataSource({ driver: "postgres", databaseId: "tenant_42" });
        expect(r.key).toBe("postgres");
        expect(r.engine).toBe("postgres");
        expect(r.databaseId).toBe("tenant_42");
    });

    it("handles an undefined collection (defaults)", () => {
        const r = resolveDataSource(undefined);
        expect(r.key).toBe("(default)");
        expect(r.engine).toBe("postgres");
        expect(r.transport).toBe("server");
    });

    it("an explicit driver but no dataSource and no registry keys by driver", () => {
        const r = resolveDataSource({ driver: "mongodb" });
        expect(r.key).toBe("mongodb");
        expect(r.engine).toBe("mongodb");
        expect(r.capabilities.supportsDocumentAdmin).toBe(true);
    });
});
