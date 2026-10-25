/**
 * `rebase verify` — the checks an agent's collection edit is held to.
 *
 * Each fixture is a project on disk, laid out as `rebase init` lays one out —
 * `config/collections/*.ts`, `backend/package.json`, `backend/drizzle/migrations`
 * — because loading the files is half of what is under test: a verifier that
 * answered from a stale module cache, or from objects a test constructed in
 * memory, would pass here and miss the edit the hook ran for.
 *
 * The collection files are plain objects rather than `defineCollection(...)`
 * calls: the fixture lives outside any project's `node_modules`, and the
 * builder is an identity function at runtime, so nothing is lost.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRebaseApp, type TemplatePreset } from "./init";
import { runVerify, verifyCommand, type VerifyReport } from "./verify";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-verify-"));
    fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({ apps: {} }));
    fs.mkdirSync(path.join(root, "config", "collections"), { recursive: true });
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

function collectionFile(name: string, source: string): void {
    fs.writeFileSync(path.join(root, "config", "collections", name), source);
}

/** A collection module, as an agent would write it, from the object literal's body. */
function collection(body: string): string {
    return `export default {\n${body}\n};\n`;
}

const NOTES_RULES = `
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], roles: ["admin"] }
    ],`;

function verify(options: { backend?: boolean; live?: boolean } = {}): Promise<VerifyReport> {
    return runVerify({
        projectRoot: root,
        collectionsDir: path.join(root, "config", "collections"),
        backendDir: options.backend ? path.join(root, "backend") : null,
        live: options.live ?? false
    });
}

describe("rebase verify: collection config", () => {
    it("passes a well-formed collection", async () => {
        collectionFile("notes.ts", collection(`
    slug: "notes",
    table: "notes",
    name: "Notes",${NOTES_RULES}
    properties: {
        title: { type: "string", name: "Title", admin: { widget: "markdown" } }
    }`));
        const report = await verify();
        expect(report.findings).toEqual([]);
        expect(report.ok).toBe(true);
        expect(report.steps.map(s => [s.id, s.status])).toEqual([
            ["config", "passed"],
            ["rls", "passed"],
            ["migrations", "skipped"],
            ["live", "skipped"]
        ]);
    });

    it("catches a top-level `widget` that belongs in `admin.widget`", async () => {
        collectionFile("notes.ts", collection(`
    slug: "notes",
    table: "notes",
    name: "Notes",${NOTES_RULES}
    properties: {
        title: { type: "string", name: "Title", widget: "markdown" }
    }`));
        const report = await verify();
        expect(report.ok).toBe(false);
        const finding = report.findings.find(f => f.step === "config");
        expect(finding).toMatchObject({
            check: "config-key",
            severity: "error",
            collection: "notes",
            file: path.join("config", "collections", "notes.ts"),
            path: "notes.properties.title.widget"
        });
        // The message is the fix: an agent reading it knows where the key goes.
        expect(finding?.message).toContain("admin");
        expect(report.steps.find(s => s.id === "config")?.status).toBe("failed");
    });

    it("catches a property option that does not exist, naming the near miss", async () => {
        collectionFile("notes.ts", collection(`
    slug: "notes",
    table: "notes",
    name: "Notes",${NOTES_RULES}
    properties: {
        title: { type: "string", name: "Title", multilne: true }
    }`));
        const report = await verify();
        expect(report.ok).toBe(false);
        const finding = report.findings.find(f => f.path === "notes.properties.title.multilne");
        expect(finding?.severity).toBe("error");
    });

    it("reports a file that does not load instead of crashing", async () => {
        collectionFile("broken.ts", "export default { slug: \"broken\", properties: { ");
        const report = await verify();
        expect(report.ok).toBe(false);
        expect(report.findings[0]).toMatchObject({ check: "config-load", file: path.join("config", "collections", "broken.ts") });
    });
});

describe("rebase verify: RLS coverage", () => {
    it("catches a collection with a tenant_id column and no securityRules", async () => {
        collectionFile("invoices.ts", collection(`
    slug: "invoices",
    table: "invoices",
    name: "Invoices",
    properties: {
        tenant_id: { type: "string", name: "Tenant" },
        total: { type: "number", name: "Total" }
    }`));
        const report = await verify();
        expect(report.ok).toBe(false);
        expect(report.findings).toEqual([expect.objectContaining({
            step: "rls",
            check: "rls-missing",
            severity: "error",
            collection: "invoices",
            file: path.join("config", "collections", "invoices.ts")
        })]);
        expect(report.findings[0].message).toContain("tenant_id");
        expect(report.findings[0].fix).toContain("tenant");
    });

    it("still catches it when the directory's defaults would make it public", async () => {
        // The leak this check exists for: a new tenant-scoped table that quietly
        // inherits "everyone reads every row" from index.ts.
        collectionFile("index.ts", `export const defaultSecurityRules = [{ operation: "select", access: "public" }];\n`);
        collectionFile("invoices.ts", collection(`
    slug: "invoices",
    table: "invoices",
    name: "Invoices",
    properties: {
        tenantId: { type: "string", name: "Tenant" }
    }`));
        const report = await verify();
        expect(report.findings.map(f => f.check)).toEqual(["rls-missing"]);
        expect(report.findings[0].message).toContain("defaultSecurityRules");
    });

    it("accepts a collection that inherits directory defaults and has no owner column", async () => {
        collectionFile("index.ts", `export const defaultSecurityRules = [{ operation: "select", access: "public" }];\n`);
        collectionFile("tags.ts", collection(`
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: { label: { type: "string", name: "Label" } }`));
        expect((await verify()).ok).toBe(true);
    });

    it("catches a collection with no rules and nothing to inherit", async () => {
        collectionFile("tags.ts", collection(`
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: { label: { type: "string", name: "Label" } }`));
        const report = await verify();
        expect(report.findings.map(f => f.check)).toEqual(["rls-missing"]);
    });

    it("warns, without failing, when a user_id table inherits a read of every row", async () => {
        // An author list or a public profile: often intended, so said, not failed.
        collectionFile("index.ts", `export const defaultSecurityRules = [{ operation: "select", access: "public" }];\n`);
        collectionFile("authors.ts", collection(`
    slug: "authors",
    table: "authors",
    name: "Authors",
    properties: { user_id: { type: "string", name: "User" } }`));
        const report = await verify();
        expect(report.ok).toBe(true);
        expect(report.findings).toEqual([expect.objectContaining({ check: "rls-inherited-read", severity: "warning" })]);
    });

    it("warns when a role reads every row of a table with a user_id", async () => {
        collectionFile("orders.ts", collection(`
    slug: "orders",
    table: "orders",
    name: "Orders",
    securityRules: [{ operation: "select", roles: ["support"] }, { operation: "all", ownerField: "user_id" }],
    properties: { userId: { type: "string", name: "User" } }`));
        const report = await verify();
        // A warning: it may be intended, and it must not fail the hook.
        expect(report.ok).toBe(true);
        expect(report.findings).toEqual([expect.objectContaining({
            check: "rls-unfiltered-read",
            severity: "warning",
            path: "orders.securityRules[0]"
        })]);
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

    const NOTES = collection(`
    slug: "notes",
    table: "notes",
    name: "Notes",${NOTES_RULES}
    properties: {
        id: { type: "string", name: "ID", isId: "uuid" },
        title: { type: "string", name: "Title" },
        body: { type: "string", name: "Body" }
    }`);

    it("names a column the collections declare and no migration adds", async () => {
        collectionFile("notes.ts", NOTES);
        postgresBackend({
            "20260101000000_init.sql": `CREATE TABLE "public"."notes" ("id" uuid NOT NULL, "title" text NULL, PRIMARY KEY ("id"));`
        });
        const report = await verify({ backend: true });
        expect(report.ok).toBe(false);
        expect(report.findings).toEqual([expect.objectContaining({
            step: "migrations",
            check: "migration-missing",
            collection: "notes",
            file: path.join("config", "collections", "notes.ts")
        })]);
        expect(report.findings[0].message).toContain("public.notes.body");
        expect(report.findings[0].fix).toContain("rebase db generate");
    });

    it("passes when the migrations build every declared column", async () => {
        collectionFile("notes.ts", NOTES);
        postgresBackend({
            "20260101000000_init.sql": `CREATE TABLE "public"."notes" ("id" uuid NOT NULL, "title" text NULL, PRIMARY KEY ("id"));`,
            "20260102000000_body.sql": `ALTER TABLE "public"."notes" ADD COLUMN "body" text NULL;`
        });
        const report = await verify({ backend: true });
        expect(report.findings).toEqual([]);
        expect(report.steps.find(s => s.id === "migrations")?.status).toBe("passed");
    });

    it("is skipped, not failed, for a project that has no migrations yet", async () => {
        collectionFile("notes.ts", NOTES);
        postgresBackend({});
        const report = await verify({ backend: true });
        expect(report.ok).toBe(true);
        expect(report.steps.find(s => s.id === "migrations")).toMatchObject({ status: "skipped" });
    });
});

describe("rebase verify --json", () => {
    let cwd: string;
    let stdout: string[];

    beforeEach(() => {
        cwd = process.cwd();
        stdout = [];
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            stdout.push(args.map(String).join(" "));
        });
    });

    afterEach(() => {
        process.chdir(cwd);
        process.exitCode = undefined;
    });

    it("prints one parseable object and sets a failing exit code", async () => {
        collectionFile("invoices.ts", collection(`
    slug: "invoices",
    table: "invoices",
    name: "Invoices",
    properties: { tenant_id: { type: "string", name: "Tenant", widget: "select" } }`));
        process.chdir(root);
        await verifyCommand(["node", "rebase", "verify", "--json"]);

        const report = JSON.parse(stdout.join("\n")) as VerifyReport;
        expect(report.ok).toBe(false);
        expect(report.summary.errors).toBe(2);
        expect(report.findings.map(f => f.check).sort()).toEqual(["config-key", "rls-missing"]);
        expect(process.exitCode).toBe(1);
    });

    it("--quiet prints nothing when everything passes", async () => {
        collectionFile("notes.ts", collection(`
    slug: "notes",
    table: "notes",
    name: "Notes",${NOTES_RULES}
    properties: { title: { type: "string", name: "Title" } }`));
        process.chdir(root);
        await verifyCommand(["node", "rebase", "verify", "--quiet"]);
        expect(stdout).toEqual([]);
        expect(process.exitCode).toBeUndefined();
    });
});

describe("rebase verify --collections", () => {
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

    it("refuses a mistyped path instead of passing every step over nothing", async () => {
        process.chdir(root);
        await expect(verifyCommand(["node", "rebase", "verify", "-c", "config/colections"])).rejects.toThrow("exit 1");
        expect(stderr.join("\n")).toContain('Collections path not found: "config/colections"');
        expect(stdout.join("\n")).not.toContain("0 errors");
    });

    it("refuses it with a JSON envelope under --json", async () => {
        process.chdir(root);
        await expect(verifyCommand(["node", "rebase", "verify", "--json", "--collections", "nope"])).rejects.toThrow("exit 1");
        const envelope = JSON.parse(stdout.join("\n")) as { error: { code: string; message: string } };
        expect(envelope.error.code).toBe("collections_not_found");
        expect(envelope.error.message).toContain("nope");
    });
});

describe("a fresh scaffold", () => {
    /**
     * Every preset `rebase init` writes must pass its own verifier — otherwise
     * the hook it ships complains about the scaffold on the agent's first edit.
     *
     * The scaffold's collection files import `defineCollection` from
     * `@rebasepro/cms-types`, which a scaffold only has once installed; a
     * stand-in package with the same identity builder takes its place, as the
     * loader resolves imports from the project's own `node_modules`.
     */
    function stubCmsTypes(projectDir: string): void {
        const pkg = path.join(projectDir, "node_modules", "@rebasepro", "cms-types");
        fs.mkdirSync(pkg, { recursive: true });
        fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@rebasepro/cms-types", type: "module", main: "index.js" }));
        fs.writeFileSync(path.join(pkg, "index.js"), "export const defineCollection = (collection) => collection;\n");
    }

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
        stubCmsTypes(project);

        const report = await runVerify({
            projectRoot: project,
            collectionsDir: path.join(project, "config", "collections"),
            backendDir: path.join(project, "backend"),
            live: false
        });
        expect(report.findings).toEqual([]);
        expect(report.ok).toBe(true);

        const settings = JSON.parse(fs.readFileSync(path.join(project, ".claude", "settings.json"), "utf-8"));
        expect(JSON.stringify(settings.hooks.PostToolUse)).toContain("post-edit-collection.sh");
        expect(fs.existsSync(path.join(project, ".claude", "hooks", "post-edit-collection.sh"))).toBe(true);
    }, 60_000);
});
