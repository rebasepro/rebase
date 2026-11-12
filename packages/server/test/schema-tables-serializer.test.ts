import { describe, expect, it } from "@jest/globals";
import { Hono, type MiddlewareHandler } from "hono";
import { col, defineTable, policy, rel, type TableDescriptor } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import { TableRegistry } from "../src/schema/table-registry";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { createSchemaTablesRoutes, createSchemaTablesService } from "../src/api/schema-tables-routes";
import { redactRule, schemaViewFor, serializeTables } from "../src/api/schema-tables";

/**
 * The serializer on its own — the MCP caller class, which reaches it in
 * process rather than over HTTP, and the rule redaction's corners — and the
 * route's cache following the registry when it changes.
 */

const authors = defineTable("authors", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text() },
    rls: [{ operation: "select", access: "authenticated" }]
});
const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text(), note: col.text().access({ read: ["editor"] }) },
    relations: { author: rel.belongsTo(() => authors) },
    rls: [{ operation: "select", condition: policy.existsIn({ table: "authors", where: policy.raw("{id} IS NOT NULL") }) }]
});
const descriptors = (): TableDescriptor[] => compileSchemaDefs([authors, posts]).descriptors;

describe("the MCP caller class (a credential holding scopes)", () => {
    it("with schema:read is served every table at the privileged level", () => {
        const view = schemaViewFor({ kind: "credential", roles: ["editor"], scopes: ["schema:read"] });
        expect(view).toMatchObject({ privileged: true, tables: { kind: "all" } });
    });

    it("with data:read is served every table, without SQL", () => {
        const view = schemaViewFor({ kind: "credential", roles: [], scopes: ["data:read"] });
        expect(view).toMatchObject({ privileged: false, tables: { kind: "all" } });
    });

    it("with data:write:posts is served posts alone, and no relation out of it", () => {
        const view = schemaViewFor({ kind: "credential", roles: [], scopes: ["data:write:posts"] });
        if ("refused" in view) throw new Error("refused");
        const tables = serializeTables(descriptors(), view);
        expect(tables.map(table => table.slug)).toEqual(["posts"]);
        expect(tables[0].relations).toEqual([]);
        expect(tables[0].columns.map(column => column.key)).not.toContain("note");
    });

    it("with only storage or function scopes is refused", () => {
        expect(schemaViewFor({ kind: "credential", roles: [], scopes: ["storage:read", "functions:invoke"] }))
            .toMatchObject({ refused: "scope" });
    });
});

describe("rule redaction", () => {
    it("finds a raw node anywhere inside a structured condition", () => {
        expect(redactRule({ operation: "select", condition: policy.existsIn({ table: "a", where: policy.raw("true") }) }))
            .toEqual({ operation: "select", redacted: true });
    });

    it("keeps a structured rule, the shorthand form and an already-redacted marker as they are", () => {
        const rules = [
            { operation: "select" as const, condition: { status: "published" } },
            { operation: "update" as const, ownerField: "author_id" },
            { operation: "delete" as const, roles: ["admin"], redacted: true as const }
        ];
        for (const rule of rules) expect(redactRule(rule)).toBe(rule);
    });

    it("withholds a check-only raw rule, keeping whom it concerns", () => {
        expect(redactRule({ operation: "insert", mode: "restrictive", roles: ["editor"], withCheck: "owner_id = rebase.uid()" }))
            .toEqual({ operation: "insert", mode: "restrictive", roles: ["editor"], redacted: true });
    });
});

describe("the route's cache follows the registry", () => {
    const anyone: MiddlewareHandler<HonoEnv> = async (c, next) => {
        c.set("user", { uid: "u-1", roles: [] });
        return next();
    };

    it("changes the ETag when the registry changes, and an old tag no longer answers 304", async () => {
        const { descriptors: all, collections } = compileSchemaDefs([authors, posts]);
        const tableRegistry = new TableRegistry();
        tableRegistry.replaceAll(all);
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/schema", createSchemaTablesRoutes({
            service: createSchemaTablesService({ tableRegistry, policySource: () => collections }),
            available: true,
            authenticate: [anyone]
        }));

        const first = await app.request("/api/schema/tables");
        const tag = first.headers.get("etag") ?? "";
        expect((await app.request("/api/schema/tables", { headers: { "if-none-match": tag } })).status).toBe(304);

        tableRegistry.replaceAll(compileSchemaDefs([authors]).descriptors);

        const after = await app.request("/api/schema/tables", { headers: { "if-none-match": tag } });
        expect(after.status).toBe(200);
        expect(after.headers.get("etag")).not.toBe(tag);
        expect((await after.json() as TableDescriptor[]).map(table => table.slug)).toEqual(["authors"]);
    });
});
