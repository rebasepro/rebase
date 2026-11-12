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
import { afterAll, describe, expect, it } from "vitest";

import { enumLabelsOf, noteKeySegments } from "./customization";
import { Journal } from "./journal";
import { migrateCollectionsToTables } from "./migrate";
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

const run = (dir: string, options: { dryRun?: boolean; check?: boolean; force?: boolean } = {}): Promise<MigrationReport> =>
    migrateCollectionsToTables({ projectRoot: dir, force: options.force ?? true, moduleAliases: ALIASES, ...(options.dryRun ? { dryRun: true } : {}), ...(options.check ? { check: true } : {}) });

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
        expect(report.removeCommand).toBe("git rm -r config");
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
        expect(table?.content).toContain(`import { slugify } from "../lib/slugify";`);
        // Comments move with what they describe.
        expect(table?.content).toContain("        // Unique, so a URL names one post.\n        slug: col.text()");
        expect(table?.content).toContain("        // Tags are shared between posts.\n        tags: rel.manyToMany");
        expect(table?.content).toContain("    // The public feed: newest first.\n    indexes:");
        expect(table?.content).toContain("        // Derive the slug once, from the first title.\n        beforeSave:");
        expect(posts?.content).toContain("    // The editorial board.");
        const users = report.files.find(file => file.path === "backend/schema/users.ts");
        expect(users?.content).toContain("        // Only admins list users.\n        { operation: \"select\"");
        expect(report.files.find(file => file.path === "backend/schema/index.ts")?.content).toContain("/** Anyone reads, admins write. */\nexport const defaultRls");
        // With config/ gone the backend compiles from its own directory, and runs from dist/src.
        expect(report.files.find(file => file.path === "backend/tsconfig.json")?.content).toContain(`"rootDir": "."`);
        expect(report.files.find(file => file.path === "backend/entrypoint.sh")?.content).toContain("exec node dist/src/index.js");
    }, 120_000);
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
        expect(Object.keys(json).sort()).toEqual(["collections", "files", "manualSteps", "notes", "projectRoot", "refusals", "sdk", "status"]);
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
