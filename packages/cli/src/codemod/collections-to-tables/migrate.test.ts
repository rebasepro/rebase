/**
 * The collections-to-tables codemod on fixture projects.
 *
 * Each fixture under `__fixtures__/<name>/input/` is a whole project on the
 * legacy layout (files stored with a `.txt` suffix, so no type checker, linter
 * or bundler mistakes them for this package's source). The test materializes
 * it in a temporary directory, runs the codemod for real — evaluate, lift,
 * print, write, read back, SQL check — and compares every file it wrote, and
 * the report, with `__fixtures__/<name>/expected/`.
 *
 * `REBASE_WRITE_CODEMOD_FIXTURES=1` rewrites the expected trees. Review the
 * diff: an expected file is the contract for what a user's project becomes.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { enumLabelsOf, noteKeySegments } from "./customization";
import { Journal } from "./journal";
import { migrateCollectionsToTables } from "./migrate";
import { runCollectionsToTables } from "./command";
import type { MigrationReport } from "./types";

const FIXTURES = path.join(__dirname, "__fixtures__");
const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const UPDATE = process.env.REBASE_WRITE_CODEMOD_FIXTURES === "1";

/** Every `@rebasepro/*` the fixtures import, at its source: the run never reads a stale `dist`. */
function workspaceAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const name of fs.readdirSync(path.join(REPO, "packages"))) {
        const source = path.join(REPO, "packages", name, "src", "index.ts");
        if (fs.existsSync(source)) aliases[`@rebasepro/${name}`] = source;
    }
    aliases["@rebasepro/server/schema"] = path.join(REPO, "packages", "server", "src", "schema", "index.ts");
    return aliases;
}
const ALIASES = workspaceAliases();

const scratch: string[] = [];
afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** Copy a fixture's input into a fresh directory, dropping the `.txt` suffix. */
function materialize(fixture: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `codemod-${fixture}-`)));
    scratch.push(dir);
    const input = path.join(FIXTURES, fixture, "input");
    const walk = (from: string): void => {
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            const source = path.join(from, entry.name);
            if (entry.isDirectory()) {
                walk(source);
                continue;
            }
            const target = path.join(dir, path.relative(input, source)).replace(/\.txt$/, "");
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
        }
    };
    walk(input);
    return dir;
}

/** Every file under a directory, relative, sorted. */
function listFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(path.relative(root, full).split(path.sep).join("/"));
        }
    };
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

/** The parts of a report that are the fixture's contract (no absolute paths, no file contents). */
function reportContract(report: MigrationReport): unknown {
    return {
        status: report.status,
        collections: report.collections,
        files: report.files.map(file => `${file.action} ${file.path}`),
        refusals: report.refusals,
        notes: report.notes,
        manualSteps: report.manualSteps,
        verification: report.verification ? { identical: report.verification.identical, differences: report.verification.differences.map(difference => difference.output) } : undefined,
        removeCommand: report.removeCommand
    };
}

/** Compare (or, under UPDATE, record) what a run wrote against the fixture's expected tree. */
function expectMatchesFixture(fixture: string, dir: string, report: MigrationReport): void {
    const expectedDir = path.join(FIXTURES, fixture, "expected");
    const written = report.status === "migrated" ? report.files.filter(file => file.action !== "unchanged").map(file => file.path) : [];
    const contract = `${JSON.stringify(reportContract(report), null, 2)}\n`;
    if (UPDATE) {
        fs.rmSync(expectedDir, { recursive: true, force: true });
        fs.mkdirSync(expectedDir, { recursive: true });
        fs.writeFileSync(path.join(expectedDir, "report.json.txt"), contract);
        for (const file of written) {
            const target = path.join(expectedDir, `${file}.txt`);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(dir, file), target);
        }
        return;
    }
    expect(contract).toBe(fs.readFileSync(path.join(expectedDir, "report.json.txt"), "utf8"));
    const expectedFiles = listFiles(expectedDir).filter(file => file !== "report.json.txt").map(file => file.replace(/\.txt$/, ""));
    expect(written.sort()).toEqual(expectedFiles);
    for (const file of written) {
        expect(fs.readFileSync(path.join(dir, file), "utf8"), file).toBe(fs.readFileSync(path.join(expectedDir, `${file}.txt`), "utf8"));
    }
}

const run = (dir: string, options: { dryRun?: boolean; check?: boolean; force?: boolean; acceptRuleChanges?: boolean } = {}): Promise<MigrationReport> =>
    migrateCollectionsToTables({
        projectRoot: dir,
        force: options.force ?? true,
        moduleAliases: ALIASES,
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.check ? { check: true } : {}),
        ...(options.acceptRuleChanges ? { acceptRuleChanges: true } : {})
    });

describe("fixture projects", () => {
    it.each(["blog", "typed", "firestore"])("migrates %s, SQL byte-identical, as recorded", async fixture => {
        const dir = materialize(fixture);
        const report = await run(dir);
        expect(report.refusals).toEqual([]);
        expect(report.status).toBe("migrated");
        expect(report.verification?.identical).toBe(true);
        expect(report.verification?.compared).toBeGreaterThan(20);
        expectMatchesFixture(fixture, dir, report);
        // config/ is never deleted: deleting the user's files is their step.
        expect(fs.existsSync(path.join(dir, "config", "collections"))).toBe(true);
        // Only what Rebase read is removed; the project's own modules of config/ stay.
        expect(report.removeCommand).toMatch(/^git rm -r config(\/collections)?( |$)/);
    }, 120_000);

    it.each(["refuse-spread-callbacks", "refuse-cuid"])("refuses %s, names the file, and writes nothing", async fixture => {
        const dir = materialize(fixture);
        const before = listFiles(dir);
        const report = await run(dir);
        expect(report.status).toBe("blocked");
        expect(report.refusals.length).toBeGreaterThan(0);
        for (const refusal of report.refusals) expect(refusal.file).toMatch(/^config\//);
        expect(listFiles(dir)).toEqual(before);
        expectMatchesFixture(fixture, dir, report);
    }, 120_000);
});

describe("what the blog fixture says about routing", () => {
    it("writes no customization for a table whose presentation is the derived one", async () => {
        const dir = materialize("blog");
        const report = await run(dir, { dryRun: true });
        const tags = report.collections.find(outcome => outcome.slug === "tags");
        expect(tags?.backendFile).toBe("backend/schema/tags.ts");
        expect(tags?.frontendFile).toBeUndefined();
        expect(report.files.some(file => file.path === "frontend/src/cms/tags.tsx")).toBe(false);
        const posts = report.files.find(file => file.path === "frontend/src/cms/posts.tsx");
        // A label equal to the derived one is dropped; one that differs is kept.
        expect(posts?.content).not.toContain(`name: "Title"`);
        expect(posts?.content).toContain(`name: "Cover image"`);
        // A lazy thunk and a string path are real imports by value.
        expect(posts?.content).toContain(`import MarkdownField from "../MarkdownField";`);
        expect(posts?.content).toContain(`import CoverPreview from "../CoverPreview";`);
        expect(posts?.content).toContain("Field: MarkdownField");
        // `afterRead({ row })` gets the row as `values` now; the body keeps its name.
        const table = report.files.find(file => file.path === "backend/schema/posts.ts");
        expect(table?.content).toContain("({ values: row }) => {");
        // A module of the project's own in config/ stays where it is, imported in place.
        expect(table?.content).toContain(`import { slugify } from "../../config/slugify";`);
        // Comments move with what they describe.
        expect(table?.content).toContain("        // Unique, so a URL names one post.\n        slug: col.text()");
        expect(table?.content).toContain("        // Tags are shared between posts.\n        tags: rel.manyToMany");
        expect(table?.content).toContain("    // The public feed: newest first.\n    indexes:");
        expect(table?.content).toContain("        // Derive the slug once, from the first title.\n        beforeSave:");
        expect(posts?.content).toContain("    // The editorial board.");
        const users = report.files.find(file => file.path === "backend/schema/users.ts");
        expect(users?.content).toContain("        // Only admins list users.\n        { operation: \"select\"");
        expect(report.files.find(file => file.path === "backend/schema/index.ts")?.content).toContain("/** Anyone reads, admins write. */\nexport const defaultRls");
        // Callbacks from the project's own helpers: `hooks:` names the helper, whose functions take table-hook props where they are written.
        expect(report.files.find(file => file.path === "backend/schema/authors.ts")?.content).toContain(`hooks: auditedCallbacks("authors")`);
        expect(report.files.find(file => file.path === "backend/lib/collections/_audited.ts")?.content).toContain("afterRead: ({ values: row }: { values: Record<string, unknown> }) => {");
        expect(report.files.find(file => file.path === "backend/schema/tags.ts")?.content).toContain(`import { tagCallbacks } from "../../config/tag-callbacks";`);
        // 0.30's policy.existsIn({ collection }) keeps its table: 0.31's builder reads `table`, and the load restores 0.30's.
        expect(report.files.find(file => file.path === "backend/schema/tags.ts")?.content).toMatch(/kind: "existsIn",\s+table: "authors"/);
        // dynamicProps return 0.31's flat shape: inline, and in the shared builder (its shared const included); nothing left to check.
        expect(report.files.find(file => file.path === "frontend/src/cms/posts.tsx")?.content).toContain(`if (values?.status === "published") return { readOnly: true };`);
        expect(report.files.find(file => file.path === "config/form-rules.ts")?.content).toContain("const READ_ONLY = { readOnly: true };");
        expect(report.manualSteps.filter(step => step.title.includes("dynamicProps"))).toEqual([]);
        // A function storage path: its keys' template on the column (where the server enforces the limits), the function in the customization.
        expect(report.files.find(file => file.path === "backend/schema/authors.ts")?.content).toContain(`path: "{path}/avatar"`);
        expect(report.files.find(file => file.path === "frontend/src/cms/authors.tsx")?.content).toContain("path: ({ values, entityId }) => {");
        // A custom backend entry: the auth collection option and its import go (the auth table is defineAuthTable's), storage is repointed.
        const entry = report.files.find(file => file.path === "backend/src/index.ts")?.content ?? "";
        expect(entry).not.toContain("usersCollection");
        expect(entry).toContain(`import { storageAuthorize } from "../storage";`);
        expect(entry).toContain(`schemaDir: path.join(__dirname, "../schema")`);
        expect(report.manualSteps.map(step => step.title)).not.toContain("Update the backend options in backend/src/index.ts");
        // config/ keeps the project's own modules: still a workspace package, still compiled by the backend.
        expect(report.files.some(file => file.path === "pnpm-workspace.yaml")).toBe(false);
        expect(report.files.find(file => file.path === "backend/tsconfig.json")?.content).toContain(`"../config/**/*"`);
        expect(report.notes.map(entry => entry.message).join("\n")).toContain("keeps 4 module(s) of the project's own (config/actions.ts, config/form-rules.ts, config/slugify.ts, config/tag-callbacks.ts)");
    }, 120_000);

    it("with nothing of its own left in config/, drops the config package and compiles the backend from its own directory", async () => {
        const dir = materialize("blog");
        // The blog's helpers moved beside the collections: config/ holds nothing but what Rebase read.
        const collections = path.join(dir, "config", "collections");
        for (const helper of ["slugify.ts", "actions.ts", "form-rules.ts", "tag-callbacks.ts"]) fs.renameSync(path.join(dir, "config", helper), path.join(collections, `_${helper}`));
        const posts = path.join(collections, "posts.ts");
        fs.writeFileSync(posts, fs.readFileSync(posts, "utf8").replace(`"../slugify"`, `"./_slugify"`).replace(`"../actions"`, `"./_actions"`).replace(`"../form-rules"`, `"./_form-rules"`));
        const tags = path.join(collections, "tags.ts");
        fs.writeFileSync(tags, fs.readFileSync(tags, "utf8").replace(`"../tag-callbacks"`, `"./_tag-callbacks"`));
        const report = await run(dir, { dryRun: true });
        expect(report.refusals).toEqual([]);
        expect(report.files.find(file => file.path === "backend/schema/posts.ts")?.content).toContain(`import { slugify } from "../lib/collections/_slugify";`);
        expect(report.files.find(file => file.path === "backend/tsconfig.json")?.content).toContain(`"rootDir": "."`);
        expect(report.files.find(file => file.path === "backend/entrypoint.sh")?.content).toContain("exec node dist/src/index.js");
        expect(report.files.some(file => file.path === "pnpm-workspace.yaml")).toBe(true);
        expect(report.notes.some(entry => entry.message.includes("module(s) of the project's own"))).toBe(false);
    }, 120_000);
});

describe("a backend tsconfig that reached ../config without a rootDir", () => {
    it("moves the emit path too: tsc's implicit root was the project, it is backend/ once ../config is gone", async () => {
        const dir = materialize("blog");
        const collections = path.join(dir, "config", "collections");
        for (const helper of ["slugify.ts", "actions.ts", "form-rules.ts", "tag-callbacks.ts"]) fs.renameSync(path.join(dir, "config", helper), path.join(collections, `_${helper}`));
        const posts = path.join(collections, "posts.ts");
        fs.writeFileSync(posts, fs.readFileSync(posts, "utf8").replace(`"../slugify"`, `"./_slugify"`).replace(`"../actions"`, `"./_actions"`).replace(`"../form-rules"`, `"./_form-rules"`));
        const tags = path.join(collections, "tags.ts");
        fs.writeFileSync(tags, fs.readFileSync(tags, "utf8").replace(`"../tag-callbacks"`, `"./_tag-callbacks"`));
        const tsconfig = path.join(dir, "backend", "tsconfig.json");
        fs.writeFileSync(tsconfig, fs.readFileSync(tsconfig, "utf8").replace(`,\n    "rootDir": ".."`, ""));
        const report = await run(dir, { dryRun: true });
        expect(report.files.find(file => file.path === "backend/tsconfig.json")?.content).not.toContain("../config");
        expect(report.files.find(file => file.path === "backend/entrypoint.sh")?.content).toContain("exec node dist/src/index.js");
    }, 120_000);
});

describe("a second static app beside the panel", () => {
    it("is told to add the backend guard, which rebase build requires of every static app", async () => {
        const dir = materialize("blog");
        const manifest = path.join(dir, "rebase.json");
        const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
        json.apps.web = { type: "static", root: "web", output: "web/dist", path: "/site" };
        fs.writeFileSync(manifest, JSON.stringify(json, null, 4));
        fs.mkdirSync(path.join(dir, "web"));
        fs.writeFileSync(path.join(dir, "web", "vite.config.ts"), `import { defineConfig } from "vite";\nexport default defineConfig({ plugins: [] });\n`);
        fs.writeFileSync(path.join(dir, "web", "package.json"), JSON.stringify({ name: "web", devDependencies: { vite: "^7.0.0" } }));
        const report = await run(dir, { dryRun: true });
        const step = report.manualSteps.find(entry => entry.file === "web/vite.config.ts");
        expect(step?.title).toBe("Add the backend guard to the Vite config");
        expect(step?.detail).toContain("Add `@rebasepro/app` to its devDependencies (web/package.json)");
        expect(report.manualSteps.filter(entry => entry.file === "frontend/vite.config.ts")).toEqual([]);
    }, 120_000);
});

describe("a function storage path no template can name", () => {
    it("is refused, since any template would claim keys the function never writes", async () => {
        const dir = materialize("blog");
        const file = path.join(dir, "config", "collections", "authors.ts");
        fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("return `${owner}/avatar`;", "return owner;"));
        const report = await run(dir, { dryRun: true });
        expect(report.refusals.map(refusal => refusal.reason).join("\n")).toContain("computes its storage path with a function");
    }, 120_000);
});

describe("presentation that moved to a customizeTable option", () => {
    /** The blog fixture, with its users collection's `auth` replaced. */
    async function usersCustomization(auth: string): Promise<string | undefined> {
        const dir = materialize("blog");
        const file = path.join(dir, "config", "collections", "users.ts");
        fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("auth: { enabled: true },", auth));
        const report = await run(dir, { dryRun: true });
        expect(report.refusals).toEqual([]);
        expect(report.notes.filter(entry => entry.message.includes("auth.actions"))).toEqual([]);
        return report.files.find(entry => entry.path === "frontend/src/cms/users.tsx")?.content;
    }

    it("carries `auth.actions.resetPassword: false` as `resetPasswordAction: false`", async () => {
        const content = await usersCustomization("auth: { enabled: true, actions: { resetPassword: false } },");
        expect(content).toContain("resetPasswordAction: false");
    }, 120_000);

    it("carries a replacement reset-password action, its code with it", async () => {
        const content = await usersCustomization(
            "auth: { enabled: true, actions: { resetPassword: { key: \"reset_password\", name: \"Send reset link\", onClick: async () => { console.log(\"reset\"); } } } },");
        expect(content).toContain("resetPasswordAction: {");
        expect(content).toContain("name: \"Send reset link\"");
        expect(content).toContain("console.log(\"reset\")");
    }, 120_000);
});

describe("a relation field's form default", () => {
    it("carries a relation's `defaultValue` as `fields.<relation>.defaultValue`, printed from its source", async () => {
        const dir = materialize("blog");
        const file = path.join(dir, "config", "collections", "posts.ts");
        const source = fs.readFileSync(file, "utf8")
            .replace("import { defineCollection } from \"@rebasepro/cms-types\";", "import { defineCollection } from \"@rebasepro/cms-types\";\nimport { EntityRelation } from \"@rebasepro/types\";")
            .replace("            name: \"Author\",\n            type: \"relation\",", "            name: \"Author\",\n            type: \"relation\",\n            defaultValue: new EntityRelation(\"a1\", \"authors\"),");
        fs.writeFileSync(file, source);
        const report = await run(dir, { dryRun: true });
        expect(report.refusals).toEqual([]);
        expect(report.notes.filter(entry => entry.message.includes("defaultValue"))).toEqual([]);
        const content = report.files.find(entry => entry.path === "frontend/src/cms/posts.tsx")?.content;
        expect(content).toContain("defaultValue: new EntityRelation(\"a1\", \"authors\")");
        // A 0.30 file imports it from @rebasepro/types, where 0.31 no longer has it: it loads (the shim) and the import moves.
        expect(content).toContain("import { EntityRelation } from \"@rebasepro/cms-types\";");
    }, 120_000);
});

describe("a belongsTo that served its foreign key under its own key", () => {
    it("renames the relation and points the customization's presentation of it at the new key", async () => {
        const dir = materialize("relation-key");
        const report = await run(dir, { dryRun: true });
        expect(report.refusals).toEqual([]);
        expect(report.manualSteps.map(step => step.title)).toContain("Relation renamed in members");
        const table = report.files.find(entry => entry.path === "backend/schema/members.ts")?.content;
        expect(table).toContain("company_idRelation: rel.belongsTo(");
        // The panel draws the relation in the column's place: a customization naming
        // `company_id` would label, list and title a field the panel does not have.
        const content = report.files.find(entry => entry.path === "frontend/src/cms/members.tsx")?.content ?? "";
        expect(content).toMatch(/company_idRelation: \{\s+name: "Employer"/);
        expect(content).toContain(`listFields: ["email", "company_idRelation"]`);
        expect(content).toContain(`previewFields: ["company_idRelation"]`);
        expect(content).toContain(`fieldOrder: ["company_idRelation", "email"]`);
        expect(content).toMatch(/title: "company_idRelation",\s+subtitle: "email"/);
        expect(content).toMatch(/fields: \["email", "company_idRelation"\]/);
        expect(content).not.toMatch(/"company_id"|\bcompany_id:/);
    }, 120_000);
});

/**
 * The SQL check compiles both sides with this release's compiler, so it cannot
 * see a rule whose policy grants something different than on the previous
 * version. The firestore fixture's `customers` has one: a bare
 * `access: "authenticated"`, which granted nothing before and admits every
 * signed-in caller now.
 */
describe("rules that change meaning", () => {
    it("are reported, carried as written, and printed last under their own heading", async () => {
        const dir = materialize("firestore");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        let report: MigrationReport;
        let printed: string;
        try {
            report = await runCollectionsToTables({ force: true }, dir, ALIASES);
            printed = log.mock.calls.map(call => call.map(String).join(" ")).join("\n");
        } finally {
            log.mockRestore();
        }
        expect(report.status).toBe("migrated");
        expect(report.ruleChanges).toEqual([{
            file: "config/collections/customers.ts",
            collection: "customers",
            rule: "securityRules[0]",
            message: expect.stringContaining("granted nothing")
        }]);
        expect(report.ruleChanges[0].message).toContain('`access: "registered"`');
        expect(report.ruleChanges[0].message).toContain("remove the rule");
        expect(fs.readFileSync(path.join(dir, "backend", "schema", "customers.ts"), "utf8")).toContain('access: "authenticated"');

        const heading = printed.indexOf("Review before deploying: these rules change meaning");
        expect(heading).toBeGreaterThan(printed.indexOf("rebase db push --dry-run"));
        expect(printed.slice(heading)).toContain("customers securityRules[0]");
        expect(printed).toContain("rebase doctor --policies");
    }, 180_000);

    it("make --check fail unless --accept-rule-changes acknowledges them", async () => {
        const dir = materialize("firestore");
        expect((await run(dir)).status).toBe("migrated");
        const refused = await run(dir, { check: true });
        expect(refused.status).toBe("rule-changes");
        expect(refused.removeCommand).toBeUndefined();
        expect(JSON.parse(JSON.stringify(refused)).ruleChanges).toHaveLength(1);
        const accepted = await run(dir, { check: true, acceptRuleChanges: true });
        expect(accepted.status).toBe("checked");
        expect(accepted.removeCommand).toBe("git rm -r config");
    }, 180_000);

    it("exit 1 from the command on --check without the flag", async () => {
        const dir = materialize("firestore");
        expect((await run(dir)).status).toBe("migrated");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const previous = process.exitCode;
        try {
            await runCollectionsToTables({ check: true, json: true }, dir, ALIASES);
            expect(process.exitCode).toBe(1);
            process.exitCode = previous;
            await runCollectionsToTables({ check: true, json: true, acceptRuleChanges: true }, dir, ALIASES);
            expect(process.exitCode).toBe(previous);
        } finally {
            process.exitCode = previous;
            log.mockRestore();
        }
    }, 180_000);
});

describe("modes", () => {
    it("is idempotent: a second run finds every file already written and the SQL still identical", async () => {
        const dir = materialize("blog");
        const first = await run(dir);
        expect(first.status).toBe("migrated");
        const snapshot = listFiles(dir).map(file => [file, fs.readFileSync(path.join(dir, file), "utf8")]);
        const second = await run(dir);
        expect(second.status).toBe("already-migrated");
        expect(second.files.every(file => file.action === "unchanged")).toBe(true);
        expect(second.verification?.identical).toBe(true);
        expect(listFiles(dir).map(file => [file, fs.readFileSync(path.join(dir, file), "utf8")])).toEqual(snapshot);
    }, 180_000);

    it("--dry-run writes nothing and reports the whole plan", async () => {
        const dir = materialize("blog");
        const before = listFiles(dir);
        const report = await run(dir, { dryRun: true });
        expect(report.status).toBe("planned");
        expect(listFiles(dir)).toEqual(before);
        expect(report.verification).toBeUndefined();
        expect(report.files.map(file => file.path)).toContain("backend/schema/index.ts");
        // The --json shape: plain data, every field present.
        const json = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
        expect(Object.keys(json).sort()).toEqual(["collections", "files", "manualSteps", "notes", "projectRoot", "refusals", "ruleChanges", "sdk", "status"]);
        for (const file of report.files) expect(Object.keys(file).sort()).toEqual(["action", "content", "path", "role"]);
    }, 120_000);

    it("--check passes on a migrated tree, and fails with the diff when a table no longer matches", async () => {
        const dir = materialize("typed");
        expect((await run(dir)).status).toBe("migrated");
        expect((await run(dir, { check: true })).status).toBe("checked");
        const events = path.join(dir, "backend", "schema", "events.ts");
        fs.writeFileSync(events, fs.readFileSync(events, "utf8").replace(`kind: col.text().notNull()`, `kind: col.text()`));
        const report = await run(dir, { check: true });
        expect(report.status).toBe("failed");
        expect(report.verification?.differences.map(difference => difference.output)).toContain("schema.sql");
        expect(report.verification?.differences.find(difference => difference.output === "schema.sql")?.diff).toContain("NOT NULL");
    }, 180_000);

    it("refuses a dirty git tree, and a directory that is not in git, unless --force", async () => {
        const dir = materialize("blog");
        const notGit = await run(dir, { force: false });
        expect(notGit.status).toBe("blocked");
        expect(notGit.refusals[0].reason).toMatch(/not inside a git repository/);
        const git = (...args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
        git("init", "-q");
        git("add", "-A");
        git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "legacy");
        fs.appendFileSync(path.join(dir, "config", "slugify.ts"), "\n// edited\n");
        const dirty = await run(dir, { force: false });
        expect(dirty.status).toBe("blocked");
        expect(dirty.refusals[0].reason).toMatch(/1 uncommitted change/);
        expect(fs.existsSync(path.join(dir, "backend", "schema"))).toBe(false);
    }, 120_000);

    it("adds the uiConfig wiring to the printed mount step when App.tsx is not the scaffold's", async () => {
        const dir = materialize("blog");
        const app = path.join(dir, "frontend", "src", "App.tsx");
        fs.writeFileSync(app, fs.readFileSync(app, "utf8").replace("<RebaseCMS", "<RebaseCMS\n                key=\"cms\"").replace("collections={collections}", "collections={[...collections]}"));
        const report = await run(dir, { dryRun: true });
        const step = report.manualSteps.find(entry => entry.title === "Mount the table customizations");
        expect(step?.snippet).toContain(`import uiConfig from "./cms/ui-config.json";`);
        expect(step?.snippet).toContain("uiConfig={uiConfig}");
        expect(step?.detail).toContain("ui-config.json");
        expect(report.files.find(file => file.path === "frontend/src/cms/ui-config.json")?.content).toBe(`{\n  "tables": {}\n}\n`);
        expect(report.files.map(file => file.path)).not.toContain("frontend/src/App.tsx");
    }, 120_000);

    it("carries a storageAuthorize that config/index.ts re-exports from another module to backend/storage.ts", async () => {
        const dir = materialize("blog");
        const config = path.join(dir, "config");
        fs.renameSync(path.join(config, "storage.ts"), path.join(config, "storage-authorize.ts"));
        fs.writeFileSync(path.join(config, "index.ts"), "export { storageAuthorize } from \"./storage-authorize.js\";\n");
        const report = await run(dir, { dryRun: true });
        const storage = report.files.find(file => file.path === "backend/storage.ts");
        expect(storage?.content).toContain(`export { storageAuthorize } from "../config/storage-authorize.js";`);
        expect(report.manualSteps.map(step => step.title)).not.toContain("Move storageAuthorize to backend/storage.ts");
    }, 120_000);

    it("names the file that mounts the panel when it is not App.tsx", async () => {
        const dir = materialize("blog");
        const app = path.join(dir, "frontend", "src", "App.tsx");
        fs.writeFileSync(path.join(dir, "frontend", "src", "AdminApp.tsx"), fs.readFileSync(app, "utf8").replace("export function App", "export function AdminApp"));
        fs.writeFileSync(app, "import { AdminApp } from \"./AdminApp\";\n\nexport function App() {\n    return <AdminApp />;\n}\n");
        const report = await run(dir, { dryRun: true });
        const steps = report.manualSteps.filter(entry => entry.title === "Mount the table customizations");
        expect(steps.map(step => step.file)).toEqual(["frontend/src/AdminApp.tsx"]);
        expect(steps[0].snippet).toContain("tableCustomizations={tableCustomizations}");
        expect(report.files.map(file => file.path)).not.toContain("frontend/src/App.tsx");
    }, 120_000);

    it("prints the backend guard as a manual step, with the exact lines, when the Vite config is not the scaffold's", async () => {
        const dir = materialize("blog");
        const vite = path.join(dir, "frontend", "vite.config.ts");
        fs.writeFileSync(vite, "import { defineConfig } from \"vite\";\nimport { rebaseMcpViewPlugin } from \"@rebasepro/app/vitePlugin\";\n\nexport default defineConfig({ plugins: [rebaseMcpViewPlugin()] });\n");
        const report = await run(dir, { dryRun: true });
        const step = report.manualSteps.find(entry => entry.title === "Add the backend guard to the Vite config");
        expect(step?.file).toBe("frontend/vite.config.ts");
        expect(step?.snippet).toContain("import { rebaseBackendGuard } from \"@rebasepro/app/vitePlugin\";");
        expect(step?.snippet).toContain("rebaseBackendGuard()");
        expect(report.files.map(file => file.path)).not.toContain("frontend/vite.config.ts");
    }, 120_000);

    it("keeps a ui-config.json the project has, and does not wire uiConfig twice", async () => {
        const dir = materialize("blog");
        fs.mkdirSync(path.join(dir, "frontend", "src", "cms"), { recursive: true });
        fs.writeFileSync(path.join(dir, "frontend", "src", "cms", "ui-config.json"), `{ "tables": { "posts": {} } }\n`);
        const app = path.join(dir, "frontend", "src", "App.tsx");
        fs.writeFileSync(app, fs.readFileSync(app, "utf8").replace("collections={collections}", "collections={collections}\n                uiConfig={uiConfig}"));
        const report = await run(dir, { dryRun: true });
        expect(report.files.map(file => file.path)).not.toContain("frontend/src/cms/ui-config.json");
        const planned = report.files.find(file => file.path === "frontend/src/App.tsx")?.content ?? "";
        expect(planned.match(/uiConfig=\{uiConfig\}/g)).toHaveLength(1);
        expect(planned).not.toContain("./cms/ui-config.json");
    }, 120_000);

    it("does not overwrite an output file that holds something else", async () => {
        const dir = materialize("blog");
        fs.mkdirSync(path.join(dir, "backend", "schema"), { recursive: true });
        fs.writeFileSync(path.join(dir, "backend", "schema", "tags.ts"), "// hand-written\n");
        const report = await run(dir, { force: false });
        expect(report.status).toBe("blocked");
        const forced = await run(dir);
        expect(forced.refusals).toEqual([]);
        expect(forced.status).toBe("migrated");
    }, 180_000);
});

/**
 * Firestore collections a function builds at run time — a module under
 * `config/collections/<dir>` the app spreads into the panel's collections. The
 * legacy loader never read such a directory, but the collections were served:
 * the run must convert the ones that have a literal of their own and name the
 * rest, never report "0 Firestore" and copy the tree as 0.30 modules silently.
 */
describe("Firestore collections built by a function", () => {
    it("converts the attributable ones and names the rest in a step", async () => {
        const dir = materialize("firestore-builder");
        const report = await run(dir);
        expect(report.refusals).toEqual([]);
        expect(report.status).toBe("migrated");
        const firestore = report.collections.filter(outcome => outcome.kind === "firestore");
        expect(firestore.map(outcome => outcome.slug).sort()).toEqual(["pages_de", "pages_en", "visits"]);
        expect(firestore.find(outcome => outcome.slug === "visits")?.frontendFile).toBe("frontend/src/cms/remote/visits.ts");
        expect(firestore.find(outcome => outcome.slug === "pages_en")?.frontendFile).toBeUndefined();

        const visits = fs.readFileSync(path.join(dir, "frontend/src/cms/remote/visits.ts"), "utf8");
        expect(visits).toContain('import { defineFirestoreCollection } from "@rebasepro/firebase";');
        expect(visits).toContain("defineFirestoreCollection({");
        expect(visits).toContain('target: "customers"');
        expect(visits).not.toContain("engine:");
        const index = fs.readFileSync(path.join(dir, "frontend/src/cms/index.ts"), "utf8");
        expect(index).toContain('import visitsCollection from "./remote/visits";');
        expect(index).toContain("export const externalCollections = [visitsCollection];");

        const step = report.manualSteps.find(candidate => candidate.title.includes("getRemoteCollections()"));
        expect(step?.file).toBe("config/collections/remote/index.ts");
        expect(step?.detail).toContain("3 Firestore collection(s)");
        expect(step?.detail).toContain("visits → frontend/src/cms/remote/visits.ts");
        expect(step?.detail).toContain("pages_en, pages_de");
        expect(step?.detail).toContain("defineFirestoreCollection");
        expect(step?.detail).toContain("externalCollections");
        expect(step?.detail).toContain("`properties` → `fields`");
    }, 180_000);
});

describe("pieces", () => {
    it("keeps only the enum labels and colours that are not derived", () => {
        expect(enumLabelsOf([{ id: "draft", label: "Draft" }, { id: "needs_review", label: "Needs Review" }])).toBeUndefined();
        expect(enumLabelsOf([{ id: "draft", label: "Draft", color: "grayLight" }, { id: "published", label: "Live" }]))
            .toEqual({ draft: { label: "Draft", color: "grayLight" }, published: "Live" });
        expect(enumLabelsOf({ admin: "Admin", editor: "Editors" })).toEqual({ editor: "Editors" });
    });

    it("maps a lift note's key to the legacy literal and the field customization", () => {
        expect(noteKeySegments("title")).toEqual({ literal: ["properties", "title"], field: ["title"] });
        expect(noteKeySegments("roles[]")).toEqual({ literal: ["properties", "roles", "of"], field: ["roles", "of"] });
        expect(noteKeySegments("seo.title")).toEqual({ literal: ["properties", "seo", "properties", "title"], field: ["seo", "fields", "title"] });
        expect(noteKeySegments("content[text]")).toEqual({ literal: ["properties", "content", "oneOf", "properties", "text"], field: ["content", "oneOf", "text"] });
    });

    it("rolls a journal back to exactly what was there", () => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codemod-journal-")));
        scratch.push(dir);
        fs.writeFileSync(path.join(dir, "kept.txt"), "before");
        const journal = new Journal();
        journal.write(path.join(dir, "kept.txt"), "after");
        journal.write(path.join(dir, "new", "deep", "file.txt"), "created");
        expect(fs.readFileSync(path.join(dir, "kept.txt"), "utf8")).toBe("after");
        journal.rollback();
        expect(fs.readFileSync(path.join(dir, "kept.txt"), "utf8")).toBe("before");
        expect(fs.existsSync(path.join(dir, "new"))).toBe(false);
    });
});
