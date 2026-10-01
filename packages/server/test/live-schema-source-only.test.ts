/**
 * "Edit source only" commits, through the same door as every other change.
 *
 * It used to write the collection through the source-only editor and stop: the
 * file (and, under `rebase dev`, the regenerated schema) were left uncommitted,
 * so the next "Commit and apply" on any collection was refused with 409
 * SCHEMA_EDIT_DIRTY_TREE naming them — and the dialog never said so. Now it is
 * a commit with no DDL, whose message names what the database keeps.
 */
import { Hono } from "hono";
import type { CollectionConfig, DatabaseAdmin, SchemaChangePlan } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createLiveSchemaRoutes } from "../src/api/live-schema-routes";
import type { SchemaEditRepository } from "../src/schema-edit/apply-schema-change";

const REMOVAL = {
    kind: "remove-property" as const,
    verdict: "needs-migration" as const,
    collection: "products",
    property: "sku",
    detail: "\"sku\" was removed, which would drop column \"sku\" and the data in it.",
    sourceOnly: "column \"sku\" stays in the database.",
    kept: "column products.sku kept"
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
    const admin = {
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
        executeSql: async () => { events.push("sql"); return { rows: [] }; }
    } as unknown as DatabaseAdmin;

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("user", { uid: "u_1", roles: ["admin"], email: "ada@example.com" } as never);
        await next();
    });
    app.route("/api/schema", createLiveSchemaRoutes({
        getCollections: () => [{
            slug: "products", name: "Products",
            properties: { title: { type: "string" }, sku: { type: "string" } }
        } as unknown as CollectionConfig],
        getAdmin: () => admin,
        getRepository: () => repository,
        writeSource: async () => { events.push("write-source"); return []; }
    }));
    const apply = (body: unknown) => app.fetch(new Request("http://localhost/api/schema/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));
    return { apply, events, planned };
}

const patch = [{ op: "remove", path: ["properties", "sku"] }];

describe("Edit source only", () => {
    it("commits the source and the generated schema, and runs no SQL", async () => {
        const { apply, events, planned } = harness();
        const response = await apply({ collectionId: "products", patch, sourceOnly: true });
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
        expect(body.summary).toMatch(/source only/i);
        expect(body.summary).toMatch(/column products\.sku kept/);
    });

    it("is still refused as an apply", async () => {
        const { apply, events } = harness();
        const response = await apply({ collectionId: "products", patch });
        expect(response.status).toBe(400);
        expect(events).toEqual([]);
    });

    it("is refused for a change that may not be written to the source alone", async () => {
        const { apply, events } = harness({ ...REMOVAL, kind: "change-primary-key" as never, sourceOnly: undefined as never, kept: undefined as never });
        const response = await apply({ collectionId: "products", patch, sourceOnly: true });
        expect(response.status).toBe(400);
        expect(await response.text()).toMatch(/source alone/);
        expect(events).toEqual([]);
    });
});

describe("deleting a collection through the live door", () => {
    it("plans the set without it and hands the writer a removal", async () => {
        const planned: unknown[][] = [];
        const written: unknown[] = [];
        const admin = {
            planSchemaChange: async (_b: unknown, after: unknown[], options?: { sourceOnly?: boolean }) => {
                planned.push(after);
                const change = {
                    kind: "remove-collection", verdict: "needs-migration", collection: "products",
                    detail: "Collection \"products\" was removed.",
                    sourceOnly: "Table \"products\" and every row in it stay in the database, and nothing serves them.",
                    kept: "table products kept"
                };
                const classified = { changes: [change], verdict: "needs-migration", applicable: false };
                if (!options?.sourceOnly) throw Object.assign(new Error("x"), { classified });
                return { files: [{ path: "backend/src/schema.generated.ts", contents: "x" }], statements: [], classified, message: "chore(schema): remove the products collection (source only — table products kept)\n" };
            },
            executeSql: async () => ({ rows: [] })
        } as unknown as DatabaseAdmin;
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => { c.set("user", { uid: "u_1", roles: ["admin"] } as never); await next(); });
        app.route("/api/schema", createLiveSchemaRoutes({
            getCollections: () => [{ slug: "products", name: "Products", properties: {} } as unknown as CollectionConfig],
            getAdmin: () => admin,
            getRepository: () => ({
                root: "/tmp/p", currentBranch: async () => "main", dirtyPaths: async () => [],
                writeFiles: async () => undefined, commit: async () => "abc123def456"
            }),
            writeSource: async (change) => { written.push(change); return []; }
        }));
        const response = await app.fetch(new Request("http://localhost/api/schema/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collectionId: "products", remove: true, sourceOnly: true })
        }));
        const body = await response.json() as { summary: string };
        expect(response.status).toBe(200);
        expect(planned[0]).toEqual([]);
        expect(written).toEqual([{ collectionId: "products", remove: true }]);
        expect(body.summary).toMatch(/table products kept/);
    });
});
