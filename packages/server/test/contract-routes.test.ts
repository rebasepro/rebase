import { Hono } from "hono";
import { col, computeSchemaVersion, defineTable, rel, SCHEMA_VERSION_HEADER, type TableDescriptor } from "@rebasepro/types";

// `computeSchemaVersion` is the expensive call the routes cache, and counting it
// is the only way to observe that cache. The barrel re-exports it as a getter,
// which `jest.spyOn` cannot redefine, so the whole module is wrapped instead —
// every export keeps its real behaviour, this one just also counts.
jest.mock("@rebasepro/types", () => {
    const actual = jest.requireActual("@rebasepro/types") as Record<string, unknown>;
    return {
        ...actual,
        computeSchemaVersion: jest.fn(actual.computeSchemaVersion as (...args: unknown[]) => unknown)
    };
});
import { compileSchemaDefs } from "../src/schema/load-schema";
import { TableRegistry } from "../src/schema/table-registry";
import { createContractRoutes } from "../src/api/contract-routes";
import { createSchemaTablesService } from "../src/api/schema-tables-routes";
import type { HonoEnv } from "../src/api/types";

/**
 * The contract endpoint and its cheap sibling.
 *
 * `/contract` is a full map of the schema — `{ schemaVersion, runtime, tables }`,
 * the tables as `GET /api/schema/tables` serves an administrator — and is gated
 * by the caller (see create-backend). `/schema-version` is deliberately open,
 * because a version stamp stands for a schema without describing it — so a CI
 * job can ask "is my generated client stale?" with no credentials.
 */

const authors = defineTable("authors", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name: col.text(),
        apiSecret: col.text().private()
    },
    rls: [{ operation: "select", using: "rebase.uid() IS NOT NULL" }],
    hooks: { beforeSave: ({ values }) => values }
});
const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
    relations: { author: rel.belongsTo(() => authors) },
    rls: "admin-only"
});

function served(defs: Parameters<typeof compileSchemaDefs>[0]) {
    const { descriptors, collections } = compileSchemaDefs(defs);
    const tableRegistry = new TableRegistry();
    tableRegistry.replaceAll(descriptors);
    return { tableRegistry, collections };
}

function mount(defs: Parameters<typeof compileSchemaDefs>[0], options: { schemaVersion?: string; runtimeVersion?: string } = {}) {
    const { tableRegistry, collections } = served(defs);
    const schemaTables = createSchemaTablesService({
        tableRegistry,
        policySource: () => collections,
        schemaVersion: options.schemaVersion
    });
    const app = new Hono<HonoEnv>();
    app.route("/api/meta", createContractRoutes({ schemaTables, runtimeVersion: options.runtimeVersion }));
    return { app, tableRegistry };
}

describe("contract routes", () => {
    it("serves the version recorded at build time", async () => {
        const { app } = mount([authors, posts], { schemaVersion: "v1:deadbeefdeadbeef" });

        const response = await app.request("/api/meta/schema-version");
        const body = await response.json() as { schemaVersion: string };

        expect(response.status).toBe(200);
        expect(body.schemaVersion).toBe("v1:deadbeefdeadbeef");
        expect(response.headers.get(SCHEMA_VERSION_HEADER)).toBe("v1:deadbeefdeadbeef");
    });

    it("computes the version from the compiled tables when the build recorded none", async () => {
        // A source boot (`rebase dev`) built nothing, so there is no recorded
        // stamp to quote: the version is computed from the descriptors.
        const { app, tableRegistry } = mount([authors, posts], { schemaVersion: "" });

        const body = await (await app.request("/api/meta/schema-version")).json() as { schemaVersion: string };
        expect(body.schemaVersion).toBe(computeSchemaVersion(tableRegistry.list()));
        expect(body.schemaVersion).not.toBe(computeSchemaVersion([]));
    });

    it("computes the version once per registry revision, not per request", async () => {
        // `/schema-version` is unauthenticated and meant to be polled. The
        // cache is only observable by counting the hashing itself.
        const hash = jest.mocked(computeSchemaVersion);
        const { app } = mount([authors, posts]);
        hash.mockClear();

        const first = await (await app.request("/api/meta/schema-version")).json() as { schemaVersion: string };
        const second = await (await app.request("/api/meta/schema-version")).json() as { schemaVersion: string };
        await app.request("/api/meta/contract");

        expect(second.schemaVersion).toBe(first.schemaVersion);
        expect(hash).toHaveBeenCalledTimes(1);
    });

    it("follows the registry when it changes, instead of serving the boot-time answer forever", async () => {
        // The routes used to cache the version for the life of the process, so
        // a registry replaced after boot kept being described as it was.
        const { app, tableRegistry } = mount([authors, posts], { schemaVersion: "v1:recorded-at-build" });
        const before = await (await app.request("/api/meta/contract")).json() as { schemaVersion: string; tables: TableDescriptor[] };
        expect(before.schemaVersion).toBe("v1:recorded-at-build");

        tableRegistry.replaceAll(compileSchemaDefs([authors]).descriptors);

        const after = await (await app.request("/api/meta/contract")).json() as { schemaVersion: string; tables: TableDescriptor[] };
        // The recorded stamp described the registry as built; this one is not.
        expect(after.schemaVersion).toBe(computeSchemaVersion(tableRegistry.list()));
        expect(after.tables.map(table => table.slug)).toEqual(["authors"]);
        const version = await (await app.request("/api/meta/schema-version")).json() as { schemaVersion: string };
        expect(version.schemaVersion).toBe(after.schemaVersion);
    });

    it("names the runtime on the unauthenticated route, not only the gated one", async () => {
        // `runtime.version` decides whether a caller's wire format is
        // understood at all; the clients that need it hold no admin credential.
        const { app } = mount([authors], { schemaVersion: "v1:deadbeefdeadbeef", runtimeVersion: "0.17.3" });

        const response = await app.request("/api/meta/schema-version");
        const body = await response.json() as { schemaVersion: string; runtime: { version: string; contract: number } };

        expect(response.status).toBe(200);
        expect(body.runtime.version).toBe("0.17.3");
        expect(typeof body.runtime.contract).toBe("number");
    });

    it("serves { schemaVersion, runtime, tables }: every table as an administrator is served it", async () => {
        const { app } = mount([authors, posts], { schemaVersion: "v1:0000000000000000", runtimeVersion: "1.2.3" });

        const response = await app.request("/api/meta/contract");
        const body = await response.json() as Record<string, unknown> & { tables: TableDescriptor[] };

        expect(Object.keys(body).sort()).toEqual(["runtime", "schemaVersion", "tables"]);
        expect(body.tables.map(table => table.slug)).toEqual(["authors", "posts"]);
        const authorsTable = body.tables[0];
        // Private columns never leave the server, administrators included.
        expect(authorsTable.columns.map(column => column.key)).toEqual(["id", "name"]);
        expect(JSON.stringify(body)).not.toContain("apiSecret");
        // Hooks are presence flags: their code never leaves the server.
        expect(authorsTable.hooks).toEqual({ beforeSave: true });
        // The admin-level view: raw SQL and the compiled policies.
        expect(authorsTable.rls.rules).toEqual([{ operation: "select", using: "rebase.uid() IS NOT NULL" }]);
        expect(authorsTable.rls.policies?.length).toBeGreaterThan(0);
        expect(response.headers.get(SCHEMA_VERSION_HEADER)).toBe("v1:0000000000000000");
    });
});
