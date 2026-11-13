import { describe, expect, it } from "@jest/globals";
import { Hono, type MiddlewareHandler } from "hono";
import { col, defineTable, defineView, policy, rel, type TableDescriptor } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import { TableRegistry } from "../src/schema/table-registry";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { createSchemaTablesRoutes, createSchemaTablesService } from "../src/api/schema-tables-routes";
import { redactRule, ruleAppliesTo, schemaViewFor, schemaViewKey, serializeTables, tableReachable } from "../src/api/schema-tables";
import { buildTableInputSchema, buildTableSchema } from "../src/api/openapi-generator";

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

describe("a person without schema:read (schemaTables.persons, security review S-3)", () => {
    const id = () => col.uuid().primaryKey().defaultRandom();
    const reach = (rls: Parameters<typeof defineTable>[1]["rls"], roles: string[]): boolean => {
        const [table] = compileSchemaDefs([defineTable("t", { columns: { id: id(), owner: col.text() }, rls })]).descriptors;
        return tableReachable(table, roles);
    };

    it("is reached by a permissive rule with no roles, whatever it tests per row", () => {
        expect(reach([{ operation: "select", ownerField: "owner" }], [])).toBe(true);
        expect(reach([{ operation: "insert", access: "registered" }], [])).toBe(true);
        expect(reach([{ operation: "select", using: "false" }], [])).toBe(true);
    });

    it("is reached by a rule naming one of the caller's roles, or naming `public`", () => {
        expect(reach([{ operation: "select", roles: ["editor"] }], ["editor"])).toBe(true);
        expect(reach([{ operation: "select", roles: ["editor"] }], ["viewer"])).toBe(false);
        expect(reach([{ operation: "select", roles: ["public"] }], [])).toBe(true);
    });

    it("is not reached by a restrictive rule alone, nor by \"admin-only\" for a non-admin", () => {
        expect(reach([{ operation: "select", mode: "restrictive", ownerField: "owner" }], [])).toBe(false);
        expect(reach("admin-only", ["editor"])).toBe(false);
        expect(reach("admin-only", ["admin"])).toBe(true);
    });

    it("withholds a plain view (no rules of its own) and gates a materialized one by its roles", () => {
        const plain = defineView("plain", { query: "SELECT 1 AS id", columns: { id: col.integer().primaryKey() } });
        const mat = defineView("mat", { query: "SELECT 1 AS id", materialized: true, roles: ["analyst"], columns: { id: col.integer().primaryKey() } });
        const [plainTable, matTable] = compileSchemaDefs([plain, mat]).descriptors;
        expect(tableReachable(plainTable, ["analyst"])).toBe(false);
        expect(tableReachable(matTable, ["analyst"])).toBe(true);
        expect(tableReachable(matTable, ["editor"])).toBe(false);
    });

    it("keeps a rule for everyone and a rule for one of the caller's roles, restrictive ones included", () => {
        expect(ruleAppliesTo({ operation: "select", mode: "restrictive", roles: ["editor"], condition: policy.true() }, ["editor"])).toBe(true);
        expect(ruleAppliesTo({ operation: "select", roles: ["editor"] }, [])).toBe(false);
        expect(ruleAppliesTo({ operation: "select", access: "public" }, [])).toBe(true);
    });

    it("is a granted view keyed on the caller's roles, so the cache never serves one role another's body", () => {
        const viewer = schemaViewFor({ kind: "person", roles: ["viewer"], scopes: [] });
        const editor = schemaViewFor({ kind: "person", roles: ["editor"], scopes: [] });
        if ("refused" in viewer || "refused" in editor) throw new Error("refused");
        expect(viewer.tables).toEqual({ kind: "granted" });
        expect(schemaViewKey(viewer)).not.toBe(schemaViewKey(editor));
        const all = schemaViewFor({ kind: "person", roles: ["viewer"], scopes: [] }, { persons: "all" });
        if ("refused" in all) throw new Error("refused");
        expect(all.tables).toEqual({ kind: "all" });
        expect(schemaViewKey(all)).not.toBe(schemaViewKey(viewer));
    });

    it("leaves a credential's view as it was", () => {
        expect(schemaViewFor({ kind: "credential", roles: [], scopes: ["data:read"] }, { persons: "granted" }))
            .toMatchObject({ tables: { kind: "all" } });
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
        const { descriptors: all } = compileSchemaDefs([authors, posts]);
        const tableRegistry = new TableRegistry();
        tableRegistry.replaceAll(all);
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/schema", createSchemaTablesRoutes({
            service: createSchemaTablesService({ tableRegistry, policySource: () => all }),
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

/**
 * A link is described exactly when its key column is (SEC-FIX-3 D-2): the
 * per-caller schema and the OpenAPI document built from it never describe a
 * `belongsTo` whose key the caller cannot read, nor a key column whose link is
 * withheld from them; the input schema never offers a link whose key nobody
 * writes.
 */
describe("a link and its key column are described together", () => {
    const staff = defineTable("staff", {
        columns: { id: col.serial().primaryKey(), name: col.text() },
        rls: [{ operation: "select", access: "authenticated" }]
    });
    const cases = defineTable("cases", {
        columns: {
            id: col.serial().primaryKey(),
            title: col.text(),
            handlerId: col.integer().access({ read: ["hr"] }),
            informantId: col.integer().private(),
            reviewerId: col.integer().readOnly(),
            ownerId: col.integer()
        },
        relations: {
            handler: rel.belongsTo(() => staff, { localKey: "handler_id" }),
            informant: rel.belongsTo(() => staff, { localKey: "informant_id" }),
            reviewer: rel.belongsTo(() => staff, { localKey: "reviewer_id" }),
            owner: rel.belongsTo(() => staff, { localKey: "owner_id", access: { read: ["hr"] } })
        },
        rls: [{ operation: "select", access: "authenticated" }]
    });
    const tables = () => compileSchemaDefs([staff, cases]).descriptors;
    const casesFor = (roles: string[]) => {
        const view = schemaViewFor({ kind: "person", roles, scopes: [] });
        if ("refused" in view) throw new Error("refused");
        const found = serializeTables(tables(), view).find(table => table.slug === "cases");
        if (!found) throw new Error("cases not served");
        return found;
    };

    it("withholds a link whose key the caller cannot read, and a key whose link is withheld", () => {
        const editor = casesFor(["editor"]);
        expect(editor.relations.map(relation => relation.name).sort()).toEqual(["reviewer"]);
        expect(editor.columns.map(column => column.key)).not.toEqual(expect.arrayContaining(["handlerId"]));
        expect(editor.columns.map(column => column.key)).not.toContain("informantId");
        expect(editor.columns.map(column => column.key)).not.toContain("ownerId");
        const hr = casesFor(["hr"]);
        expect(hr.relations.map(relation => relation.name).sort()).toEqual(["handler", "owner", "reviewer"]);
        expect(hr.columns.map(column => column.key)).toEqual(expect.arrayContaining(["handlerId", "ownerId"]));
    });

    it("the OpenAPI schemas built from that view agree, and the input schema offers no link whose key nobody writes", () => {
        const editor = casesFor(["editor"]);
        const lookup = (slug: string) => tables().find(table => table.slug === slug);
        const row = buildTableSchema(editor, new Set(), lookup);
        const rowKeys = Object.keys((row as { properties?: Record<string, unknown> }).properties ?? {});
        for (const hidden of ["handler", "handlerId", "informant", "informantId", "owner", "ownerId"]) expect(rowKeys).not.toContain(hidden);
        const input = buildTableInputSchema(casesFor(["hr"]), lookup);
        const inputKeys = Object.keys((input as { properties?: Record<string, unknown> }).properties ?? {});
        expect(inputKeys).not.toContain("reviewer");
        expect(inputKeys).not.toContain("reviewerId");
        expect(inputKeys).not.toContain("informant");
    });
});
