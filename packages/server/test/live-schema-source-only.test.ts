/**
 * "Edit source only" commits, through the same door as every other change.
 *
 * It is a commit with no DDL, whose message names what the database keeps —
 * so the next "Commit and apply" does not meet its leftovers as somebody
 * else's work in progress.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import path from "node:path";
import type { DatabaseAdmin, PostgresCollectionConfig, SchemaChange, SchemaChangeFile, SchemaChangePlan, TablePatch } from "@rebasepro/types";
import type { CompiledTable } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createLiveSchemaRoutes, type PreviewedSource } from "../src/api/live-schema-routes";
import { TableSourceEditor } from "../src/api/table-source-editor";
import type { SchemaEditRepository } from "../src/schema-edit/apply-schema-change";
import { writeSchemaFixture } from "./helpers/schema-source-fixture";

const REMOVAL: SchemaChange = {
    kind: "remove-property",
    verdict: "needs-migration",
    collection: "products",
    property: "sku",
    detail: "\"sku\" was removed, which would drop column \"sku\" and the data in it.",
    sourceOnly: "column \"sku\" stays in the database.",
    kept: "column products.sku kept"
};

const products: PostgresCollectionConfig = {
    slug: "products", name: "Products",
    properties: { title: { type: "string" }, sku: { type: "string" } }
};

function harness(change = REMOVAL) {
    const events: string[] = [];
    const planned: { sourceOnly?: boolean }[] = [];
    const repository: SchemaEditRepository = {
        root: "/tmp/project",
        currentBranch: async () => "main",
        dirtyPaths: async () => [],
        writeFiles: async () => { events.push("write-generated"); },
        commit: async (_paths, message) => { events.push(`commit:${message.split("\n")[0]}`); return "abc123def456"; }
    };
    const admin: DatabaseAdmin = {
        planSchemaChange: async (_b: unknown, _a: unknown, options?: { sourceOnly?: boolean }) => {
            planned.push(options ?? {});
            const classified = { changes: [change], verdict: change.verdict, applicable: false };
            if (!options?.sourceOnly) throw Object.assign(new Error("cannot be applied"), { classified });
            return {
                files: [{ path: "backend/src/schema.generated.ts", contents: "x" }],
                statements: [],
                classified,
                message: "chore(schema): remove sku from products (source only — column products.sku kept)\n"
            } satisfies SchemaChangePlan;
        },
        executeSql: async () => { events.push("sql"); return []; }
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("user", { uid: "u_1", roles: ["admin"], email: "ada@example.com" });
        await next();
    });
    app.route("/api/schema", createLiveSchemaRoutes({
        getCollections: () => [products],
        getCompiledTables: () => [],
        getAdmin: () => admin,
        getRepository: () => repository,
        previewSource: async () => ({
            files: [{ path: "backend/schema/products.ts", contents: "…" }],
            schema: { defs: [], descriptors: [], collections: [{ ...products, properties: { title: { type: "string" } } }] }
        }),
        writeSource: async (source) => { events.push("write-source"); return source.files; },
        onApplied: () => { events.push("served"); }
    }));
    const apply = (body: unknown) => app.fetch(new Request("http://localhost/api/schema/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));
    return { apply, events, planned };
}

const patches: TablePatch[] = [{ op: "removeColumn", table: "products", key: "sku" }];

describe("Edit source only", () => {
    it("commits the source and the generated schema, runs no SQL, and serves nothing new", async () => {
        const { apply, events, planned } = harness();
        const response = await apply({ patches, sourceOnly: true });
        const body = await response.json() as { applied: boolean; sourceOnly?: boolean; summary: string };

        expect(response.status).toBe(200);
        expect(planned).toEqual([{ paths: undefined, sourceOnly: true }]);
        expect(events).toEqual([
            "write-source",
            "write-generated",
            "commit:chore(schema): remove sku from products (source only — column products.sku kept)"
        ]);
        expect(body.sourceOnly).toBe(true);
        expect(body.applied).toBe(false);
        expect(body.summary).toMatch(/column products\.sku kept/);
    });

    it("is still refused as an apply", async () => {
        const { apply, events } = harness();
        expect((await apply({ patches })).status).toBe(400);
        expect(events).toEqual([]);
    });

    it("is refused for a change that may not be written to the source alone", async () => {
        const { apply, events } = harness({ ...REMOVAL, kind: "change-primary-key", sourceOnly: undefined, kept: undefined });
        const response = await apply({ patches, sourceOnly: true });
        expect(response.status).toBe(400);
        expect(await response.text()).toMatch(/source alone/);
        expect(events).toEqual([]);
    });
});

describe("deleting a table through the live door", () => {
    let fixture: ReturnType<typeof writeSchemaFixture>;
    beforeEach(() => { fixture = writeSchemaFixture(); });
    afterEach(() => fixture.cleanup());

    it("plans the schema without it and commits its file as deleted, with the index", async () => {
        const editor = new TableSourceEditor(fixture.dir);
        const planned: (readonly CompiledTable[])[] = [];
        const committed: SchemaChangeFile[] = [];
        const admin: DatabaseAdmin = {
            planSchemaChange: async (_b: unknown, after: readonly CompiledTable[], options?: { sourceOnly?: boolean }) => {
                planned.push(after);
                const change: SchemaChange = {
                    kind: "remove-collection", verdict: "needs-migration", collection: "tags",
                    detail: "Table \"tags\" was removed.",
                    sourceOnly: "Table \"tags\" and every row in it stay in the database, and nothing serves them.",
                    kept: "table tags kept"
                };
                const classified: SchemaChangePlan["classified"] = { changes: [change], verdict: "needs-migration", applicable: false };
                if (!options?.sourceOnly) throw Object.assign(new Error("x"), { classified });
                return { files: [{ path: "backend/src/schema.generated.ts", contents: "x" }], statements: [], classified, message: "chore(schema): remove the tags table (source only — table tags kept)\n" };
            },
            executeSql: async () => []
        };
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => { c.set("user", { uid: "u_1", roles: ["admin"] }); await next(); });
        app.route("/api/schema", createLiveSchemaRoutes({
            getCollections: () => [],
            getCompiledTables: () => [],
            getAdmin: () => admin,
            getRepository: () => ({
                root: fixture.root, currentBranch: async () => "main", dirtyPaths: async () => [],
                writeFiles: async (files) => { committed.push(...files); }, commit: async () => "abc123def456"
            }),
            previewSource: async (edits): Promise<PreviewedSource> => {
                const edit = await editor.preview(edits);
                return {
                    files: edit.files.map(file => ({ path: path.relative(fixture.root, file.path), contents: file.contents, ...(file.deleted ? { deleted: true } : {}) })),
                    schema: edit.schema
                };
            },
            writeSource: async (source) => source.files
        }));
        const response = await app.fetch(new Request("http://localhost/api/schema/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patches: [{ op: "deleteTable", table: "tags" }], sourceOnly: true })
        }));
        const body = await response.json() as { summary: string };
        expect(response.status).toBe(200);
        expect(planned[0].map(each => each.descriptor.slug))
            .toEqual(["users", "posts", "archived"]);
        expect(committed.filter(file => file.path.startsWith("backend/schema")).map(file => `${file.path}${file.deleted ? " (deleted)" : ""}`))
            .toEqual(["backend/schema/index.ts", "backend/schema/tags.ts (deleted)"]);
        expect(body.summary).toMatch(/table tags kept/);
    });
});
