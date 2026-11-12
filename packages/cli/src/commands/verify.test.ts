/**
 * `rebase verify` — the checks an agent's schema edit is held to.
 *
 * Each fixture is a project on disk, laid out as `rebase init` lays one out —
 * `backend/schema/*.ts`, `backend/package.json`, `backend/drizzle/migrations`
 * — because loading the files is half of what is under test: a verifier that
 * answered from a stale module cache, or from objects a test constructed in
 * memory, would pass here and miss the edit the hook ran for. The schema files
 * are printed by the shared fixture helper, as the codemod prints them.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { col, defineAuthTable, defineTable, rel, type AnyTableDef, type DefaultRls } from "@rebasepro/types";

import { createRebaseApp, type TemplatePreset } from "./init";
import { authRequiredFrom, pendingMigrations, runVerify, verifyCommand, type VerifyReport } from "./verify";
import { compareMigrationVersions, migrationVersionOf } from "@rebasepro/server-postgres";
import { scaffoldProject, workspaceModuleAliases, writeTableModules } from "../../test/helpers/project";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const ALIASES = workspaceModuleAliases();

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-verify-"));
    scaffoldProject({ root, backendDependencies: false });
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

const SCHEMA = () => path.join(root, "backend", "schema");

/** Write the project's schema: one module per table and the index. */
function schema(tables: AnyTableDef[], defaultRls?: DefaultRls): void {
    writeTableModules(SCHEMA(), tables, defaultRls);
}

const PUBLIC_READ_ADMIN_WRITE = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
] as const;

const notes = (columns: Parameters<typeof defineTable>[1]["columns"] = {
    id: col.uuid().primaryKey().defaultRandom(),
    title: col.text()
}) => defineTable("notes", { columns, rls: PUBLIC_READ_ADMIN_WRITE });

function verify(options: { backend?: boolean; live?: boolean } = {}): Promise<VerifyReport> {
    return runVerify({
        projectRoot: root,
        schemaDir: SCHEMA(),
        backendDir: options.backend ? path.join(root, "backend") : null,
        live: options.live ?? false,
        moduleAliases: ALIASES
    });
}

describe("rebase verify: table definitions", () => {
    it("passes a well-formed table", async () => {
        schema([notes()]);
        const report = await verify();
        expect(report.findings).toEqual([]);
        expect(report.ok).toBe(true);
        expect(report.schemaDir).toBe(path.join("backend", "schema"));
        expect(report.steps.map(s => [s.id, s.status])).toEqual([
            ["schema", "passed"],
            ["rls", "passed"],
            ["cms", "skipped"],
            ["migrations", "skipped"],
            ["live", "skipped"]
        ]);
    });

    it("reports every problem the backend would refuse to boot on, one finding each, naming the table and its file", async () => {
        // `rls: "inherit"` with no `defaultRls`, and a relation to a table the
        // index does not export: two problems, both the loader's.
        const authors = defineTable("authors", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
        const posts = defineTable("posts", {
            columns: { id: col.uuid().primaryKey() },
            relations: { author: rel.belongsTo(() => authors) },
            rls: "inherit"
        });
        schema([posts]);
        fs.writeFileSync(path.join(SCHEMA(), "authors.ts"), [
            "import { defineTable, col } from \"@rebasepro/server/schema\";",
            "export const authors = defineTable(\"authors\", { columns: { id: col.uuid().primaryKey() }, rls: \"admin-only\" });",
            ""
        ].join("\n"));
        void authors;
        const report = await verify();
        expect(report.ok).toBe(false);
        const schemaFindings = report.findings.filter(f => f.step === "schema");
        expect(schemaFindings.length).toBeGreaterThanOrEqual(1);
        expect(schemaFindings.every(f => f.check === "schema-definition" && f.severity === "error")).toBe(true);
        expect(schemaFindings.find(f => f.table === "authors")).toMatchObject({ file: path.join("backend", "schema", "authors.ts") });
        expect(report.steps.find(s => s.id === "schema")?.status).toBe("failed");
        // Nothing to check coverage or migrations on until the schema compiles.
        expect(report.steps.find(s => s.id === "rls")).toMatchObject({ status: "skipped" });
        expect(report.steps.find(s => s.id === "migrations")).toMatchObject({ status: "skipped" });
    });

    it("reports a table with no rls as the boot refuses it", async () => {
        fs.mkdirSync(SCHEMA(), { recursive: true });
        fs.writeFileSync(path.join(SCHEMA(), "index.ts"), "export { tags } from \"./tags\";\n");
        fs.writeFileSync(path.join(SCHEMA(), "tags.ts"), [
            "import { defineTable, col } from \"@rebasepro/server/schema\";",
            "export const tags = defineTable(\"tags\", { columns: { id: col.uuid().primaryKey() } });",
            ""
        ].join("\n"));
        const report = await verify();
        expect(report.ok).toBe(false);
        // `defineTable` refuses it as the module is evaluated, so it surfaces
        // as the index failing to import, with the builder's sentence in it.
        expect(report.findings).toEqual([expect.objectContaining({ step: "schema", check: "schema-load" })]);
        expect(report.findings[0].message).toContain("has no usable `rls`");
    });

    it("reports a module that does not load instead of crashing", async () => {
        schema([notes()]);
        fs.writeFileSync(path.join(SCHEMA(), "broken.ts"), "export const broken = { columns: { ");
        const report = await verify();
        expect(report.ok).toBe(false);
        expect(report.findings[0]).toMatchObject({ step: "schema", check: "schema-load", file: path.join("backend", "schema", "broken.ts") });
    });

    it("refuses a project still on the collections layout, naming the codemod", async () => {
        schema([notes()]);
        fs.mkdirSync(path.join(root, "config", "collections"), { recursive: true });
        const report = await verify();
        expect(report.ok).toBe(false);
        expect(report.findings[0]).toMatchObject({ step: "schema", check: "schema-load" });
        expect(report.findings[0].message).toContain("rebase migrate collections-to-tables");
    });

    it("skips every step for a project with no schema directory — its API is introspected", async () => {
        const report = await verify();
        expect(report.ok).toBe(true);
        expect(report.steps.every(step => step.status === "skipped")).toBe(true);
        expect(report.steps[0].detail).toContain("no schema directory");
    });
});

describe("rebase verify: RLS coverage", () => {
    const tenants = defineTable("tenants", { columns: { id: col.uuid().primaryKey(), label: col.text() }, rls: "admin-only" });

    it("fails a tenant_id table that inherits a read of every row from defaultRls", async () => {
        // The leak this check exists for: a new tenant-scoped table that quietly
        // inherits "everyone reads every row" from the index.
        const invoices = defineTable("invoices", {
            columns: { id: col.uuid().primaryKey(), tenantId: col.text(), total: col.integer() },
            rls: "inherit"
        });
        schema([invoices], [{ operation: "select", access: "public" }]);
        const report = await verify();
        expect(report.ok).toBe(false);
        expect(report.findings).toEqual([expect.objectContaining({
            step: "rls",
            check: "rls-inherited-tenant-read",
            severity: "error",
            table: "invoices",
            file: path.join("backend", "schema", "invoices.ts"),
            path: "invoices.rls"
        })]);
        expect(report.findings[0].message).toContain("tenant_id");
        expect(report.findings[0].message).toContain("defaultRls");
        expect(report.findings[0].fix).toContain("tenant");
    });

    it("reads a belongsTo's derived column the way the compiler names it", async () => {
        // `rel.belongsTo(() => tenants)` named `tenant` derives `tenant_id`,
        // which no `columns` entry spells.
        const invoices = defineTable("invoices", {
            columns: { id: col.uuid().primaryKey() },
            relations: { tenant: rel.belongsTo(() => tenants) },
            rls: "inherit"
        });
        schema([tenants, invoices], [{ operation: "select", access: "public" }]);
        const report = await verify();
        expect(report.findings.map(f => f.check)).toEqual(["rls-inherited-tenant-read"]);
        expect(report.findings[0].message).toContain("tenant_id");
    });

    it("accepts a tenant-scoped table: the tenant policy filters before any rule", async () => {
        const invoices = defineTable("invoices", {
            columns: { id: col.uuid().primaryKey(), tenantId: col.text() },
            tenant: { field: "tenantId", from: { claim: "tenant_id" } },
            rls: "inherit"
        });
        schema([invoices], [{ operation: "select", access: "public" }]);
        expect((await verify()).findings).toEqual([]);
    });

    it("accepts a table that inherits defaultRls and has no owner column", async () => {
        const tags = defineTable("tags", { columns: { id: col.uuid().primaryKey(), label: col.text() }, rls: "inherit" });
        schema([tags], [{ operation: "select", access: "public" }]);
        expect((await verify()).ok).toBe(true);
    });

    it("accepts an admin-only table with an owner column: the posture is said on purpose", async () => {
        const orders = defineTable("orders", { columns: { id: col.uuid().primaryKey(), userId: col.text() }, rls: "admin-only" });
        schema([orders]);
        expect((await verify()).findings).toEqual([]);
    });

    it("warns, without failing, when a user_id table inherits a read of every row", async () => {
        // An author list or a public profile: often intended, so said, not failed.
        const authors = defineTable("authors", { columns: { id: col.uuid().primaryKey(), userId: col.text() }, rls: "inherit" });
        schema([authors], [{ operation: "select", access: "public" }]);
        const report = await verify();
        expect(report.ok).toBe(true);
        expect(report.findings).toEqual([expect.objectContaining({ check: "rls-inherited-read", severity: "warning" })]);
    });

    it("warns when a role reads every row of a table with a user_id", async () => {
        const orders = defineTable("orders", {
            columns: { id: col.uuid().primaryKey(), userId: col.text() },
            rls: [{ operation: "select", roles: ["support"] }, { operation: "all", ownerField: "user_id" }]
        });
        schema([orders]);
        const report = await verify();
        // A warning: it may be intended, and it must not fail the hook.
        expect(report.ok).toBe(true);
        expect(report.findings).toEqual([expect.objectContaining({
            check: "rls-unfiltered-read",
            severity: "warning",
            path: "orders.rls[0]"
        })]);
    });

    it("leaves the auth table alone: the framework gives it a self-read and an admin write gate", async () => {
        const users = defineAuthTable("users", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), ownerId: col.text() },
            rls: [{ operation: "select", roles: ["support"] }]
        });
        schema([users]);
        expect((await verify()).findings.filter(f => f.step === "rls")).toEqual([]);
    });
});

describe("rebase verify: migration freshness", () => {
    function postgresBackend(migrations: Record<string, string>): void {
        const dir = path.join(root, "backend", "drizzle", "migrations");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(root, "backend", "package.json"), JSON.stringify({
            name: "backend",
            dependencies: { "@rebasepro/server-postgres": "workspace:*" }
        }));
        for (const [file, sql] of Object.entries(migrations)) fs.writeFileSync(path.join(dir, file), sql);
    }

    const NOTES = () => notes({ id: col.uuid().primaryKey(), title: col.text(), body: col.text() });

    it("names a column the schema declares and no migration adds", async () => {
        schema([NOTES()]);
        postgresBackend({
            "20260101000000_init.sql": `CREATE TABLE "public"."notes" ("id" uuid NOT NULL, "title" text NULL, PRIMARY KEY ("id"));`
        });
        const report = await verify({ backend: true });
        expect(report.ok).toBe(false);
        expect(report.findings).toEqual([expect.objectContaining({
            step: "migrations",
            check: "migration-missing",
            table: "notes",
            file: path.join("backend", "schema", "notes.ts")
        })]);
        expect(report.findings[0].message).toContain("public.notes.body");
        expect(report.findings[0].fix).toContain("rebase db generate");
    });

    it("passes when the migrations build every declared column", async () => {
        schema([NOTES()]);
        postgresBackend({
            "20260101000000_init.sql": `CREATE TABLE "public"."notes" ("id" uuid NOT NULL, "title" text NULL, PRIMARY KEY ("id"));`,
            "20260102000000_body.sql": `ALTER TABLE "public"."notes" ADD COLUMN "body" text NULL;`
        });
        const report = await verify({ backend: true });
        expect(report.findings).toEqual([]);
        expect(report.steps.find(s => s.id === "migrations")?.status).toBe("passed");
    });

    it("is skipped, not failed, for a project that has no migrations yet", async () => {
        schema([NOTES()]);
        postgresBackend({});
        const report = await verify({ backend: true });
        expect(report.ok).toBe(true);
        expect(report.steps.find(s => s.id === "migrations")).toMatchObject({ status: "skipped" });
    });
});

describe("rebase verify --live: which migrations are applied", () => {
    const files = ["20261025000100_init.sql", "20261025000126_add_tags.sql", "20261026090000_add_slug.sql"];
    const pending = (revisions: { version: string; type: number }[]) =>
        pendingMigrations(files, revisions, compareMigrationVersions, migrationVersionOf);

    it("counts every migration at or behind a baseline as applied, as Atlas does", () => {
        // `rebase db migrate --baseline 20261025000126` records that version alone, type 1.
        expect(pending([{ version: "20261025000126", type: 1 }])).toEqual(["20261026090000_add_slug.sql"]);
    });

    it("still names a migration past the baseline, and one with no row and no baseline", () => {
        expect(pending([{ version: "20261025000100", type: 2 }])).toEqual(["20261025000126_add_tags.sql", "20261026090000_add_slug.sql"]);
        expect(pending([])).toEqual(files);
    });

    it("reads executed and `migrate set` rows by membership", () => {
        expect(pending([
            { version: "20261025000100", type: 4 },
            { version: "20261025000126", type: 4 },
            { version: "20261026090000", type: 2 }
        ])).toEqual([]);
    });
});

describe("rebase verify --live: whether the API requires a token", () => {
    it("reads AUTH_REQUIRE the way every boolean env var is read", () => {
        for (const off of ["false", "0", "no", "off", "FALSE", " false "]) {
            expect(authRequiredFrom({ AUTH_REQUIRE: off }, {}), off).toBe(false);
        }
        for (const on of ["true", "1", "yes"]) expect(authRequiredFrom({ AUTH_REQUIRE: on }, {}), on).toBe(true);
    });

    it("is on by default, and takes .env when the environment says nothing", () => {
        expect(authRequiredFrom({}, {})).toBe(true);
        expect(authRequiredFrom({}, { AUTH_REQUIRE: "0" })).toBe(false);
        expect(authRequiredFrom({ AUTH_REQUIRE: "true" }, { AUTH_REQUIRE: "0" })).toBe(true);
    });
});

describe("rebase verify --live", () => {
    it("fails, rather than skipping the audit, when the database does not answer", async () => {
        schema([notes()]);
        const report = await runVerify({
            projectRoot: root,
            schemaDir: SCHEMA(),
            backendDir: null,
            live: true,
            moduleAliases: ALIASES,
            // Port 1 on loopback: nothing listens, the connection is refused at once.
            databaseUrl: "postgresql://nobody:nothing@127.0.0.1:1/none"
        });
        expect(report.ok).toBe(false);
        expect(report.findings.map(f => [f.step, f.check, f.severity])).toEqual([["live", "live-unreachable", "error"]]);
        expect(report.steps.find(s => s.id === "live")?.status).toBe("failed");
    });

    it("fails when it was asked to audit and no database is configured", async () => {
        schema([notes()]);
        const report = await verify({ live: true });
        expect(report.ok).toBe(false);
        expect(report.findings.map(f => f.check)).toEqual(["live-no-database"]);
    });
});

describe("rebase verify, the command", () => {
    let cwd: string;
    let stdout: string[];
    let stderr: string[];

    beforeEach(() => {
        cwd = process.cwd();
        stdout = [];
        stderr = [];
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { stdout.push(args.map(String).join(" ")); });
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { stderr.push(args.map(String).join(" ")); });
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Error(`exit ${code}`);
        }) as typeof process.exit);
    });

    afterEach(() => {
        process.chdir(cwd);
        process.exitCode = undefined;
    });

    // A project with no schema directory: what the command can run without
    // importing anything (the in-process import of a schema is covered above,
    // through `runVerify` with workspace aliases).
    it("--json prints one parseable object", async () => {
        process.chdir(root);
        await verifyCommand(["node", "rebase", "verify", "--json"]);
        const report = JSON.parse(stdout.join("\n")) as VerifyReport;
        expect(report.ok).toBe(true);
        expect(report.schemaDir).toBe(path.join("backend", "schema"));
        expect(process.exitCode).toBeUndefined();
    });

    it("--quiet prints nothing when everything passes", async () => {
        process.chdir(root);
        await verifyCommand(["node", "rebase", "verify", "--quiet"]);
        expect(stdout).toEqual([]);
        expect(process.exitCode).toBeUndefined();
    });

    it("refuses a mistyped --schema-dir instead of passing every step over nothing", async () => {
        process.chdir(root);
        await expect(verifyCommand(["node", "rebase", "verify", "--schema-dir", "backend/shcema"])).rejects.toThrow("exit 1");
        expect(stderr.join("\n")).toContain('Schema directory not found: "backend/shcema"');
        expect(stdout.join("\n")).not.toContain("0 errors");
    });

    it("refuses it with a JSON envelope under --json", async () => {
        process.chdir(root);
        await expect(verifyCommand(["node", "rebase", "verify", "--json", "--schema-dir", "nope"])).rejects.toThrow("exit 1");
        const envelope = JSON.parse(stdout.join("\n")) as { error: { code: string; message: string } };
        expect(envelope.error.code).toBe("schema_dir_not_found");
        expect(envelope.error.message).toContain("nope");
    });

    it.each([["--collections", "config/collections"], ["-c", "config/collections"], ["--collections=x"]])(
        "names --schema-dir when %s is typed, and runs nothing",
        async (...typed) => {
            process.chdir(root);
            await expect(verifyCommand(["node", "rebase", "verify", ...typed])).rejects.toThrow(/was removed.*--schema-dir/s);
            expect(stdout).toEqual([]);
        }
    );
});

describe("a fresh scaffold", () => {
    /**
     * Every preset `rebase init` writes must pass its own verifier — otherwise
     * the hook it ships complains about the scaffold on the agent's first edit.
     */
    it.each<TemplatePreset>(["blog", "ecommerce", "blank"])("of the %s preset passes rebase verify and ships the hook", async (preset) => {
        vi.stubEnv("REBASE_E2E", "1");
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const project = path.join(root, `${preset}-app`);
        try {
            await createRebaseApp(["node", "rebase", "init", project, "--yes", "--template", preset]);
        } finally {
            vi.unstubAllEnvs();
        }

        const report = await runVerify({
            projectRoot: project,
            schemaDir: path.join(project, "backend", "schema"),
            backendDir: path.join(project, "backend"),
            live: false,
            moduleAliases: ALIASES
        });
        expect(report.findings).toEqual([]);
        expect(report.ok).toBe(true);

        const settings = JSON.parse(fs.readFileSync(path.join(project, ".claude", "settings.json"), "utf-8"));
        expect(JSON.stringify(settings.hooks.PostToolUse)).toContain("post-edit-collection.sh");
        expect(fs.existsSync(path.join(project, ".claude", "hooks", "post-edit-collection.sh"))).toBe(true);
    }, 60_000);
});
