/**
 * The codemod on the real projects of this repository, read-only.
 *
 * Each project is copied to a temporary directory and migrated there — the
 * demo app (`app/`), every `rebase init` preset as `applyPreset` lays it out,
 * the cloud control plane (`saas/`, a private repository checked out beside
 * this one, skipped when absent). The projects themselves are on the table
 * model now, so each copy gets its frozen 0.30 `config/` (the plan-golden
 * suites' `plan-corpus-legacy` copies) in place of its tables, and the run
 * starts from that. The SQL check must pass: the tables it
 * writes render byte-identical DDL, policies, search, vector, triggers, views
 * and Drizzle schema. Nothing is ever written into the real trees; another
 * step applies the migration for real.
 *
 * `examples/*` have no legacy layout any more (the Firestore example already
 * uses `defineFirestoreCollection`): the codemod must say there is nothing to
 * migrate, not invent something.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { migrateCollectionsToTables } from "./migrate";

const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");

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

const SKIPPED = new Set(["node_modules", "dist", ".git", "generated", "coverage", "test-results", ".rebase"]);

function copyTree(from: string, to: string): void {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (SKIPPED.has(entry.name)) continue;
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) copyTree(source, target);
        else if (entry.isFile()) fs.copyFileSync(source, target);
    }
}

function tempCopy(label: string, from: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `codemod-corpus-${label}-`)));
    scratch.push(dir);
    copyTree(from, dir);
    return dir;
}

/**
 * The frozen legacy inputs: verbatim copies of `app/config` and of each CLI
 * preset's `config/collections` as they stood at 7081747fad (0.30.1), kept by
 * the plan-golden suite (see `legacy-model.ts` there for the two edits made to
 * them). The live projects are on the table model now, so these are the only
 * place the full codemod still has a real 0.30 project to migrate.
 */
const LEGACY = path.join(REPO, "packages", "server-postgres", "test", "fixtures", "plan-corpus-legacy");

/**
 * Copy a frozen `config/` into `<dir>/config`, with its imports of the frozen
 * model (`../../legacy-model`, `../../../legacy-model`: they were written for
 * their place in the fixture tree) repointed at `<dir>/legacy-model.ts`.
 */
function placeLegacyConfig(dir: string, from: string, legacyModel = path.join(LEGACY, "legacy-model.ts")): void {
    fs.copyFileSync(legacyModel, path.join(dir, "legacy-model.ts"));
    const config = path.join(dir, "config");
    const walk = (source: string, target: string): void => {
        fs.mkdirSync(target, { recursive: true });
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
            const sourcePath = path.join(source, entry.name);
            const targetPath = path.join(target, entry.name);
            if (entry.isDirectory()) { walk(sourcePath, targetPath); continue; }
            let relative = path.relative(path.dirname(targetPath), path.join(dir, "legacy-model"));
            if (!relative.startsWith(".")) relative = `./${relative}`;
            const text = fs.readFileSync(sourcePath, "utf8").replace(/(["'])(?:\.\.\/)+legacy-model\1/g, `$1${relative}$1`);
            fs.writeFileSync(targetPath, text);
        }
    };
    walk(from, config);
}

/** The layout's outputs, which a 0.30 project did not have: dropped so the run writes them. */
function dropTableLayout(dir: string): void {
    for (const output of ["backend/schema", "backend/lib", "frontend/src/cms"]) fs.rmSync(path.join(dir, output), { recursive: true, force: true });
}

/** The demo app at 0.30.1: today's project around it, its `config/` the frozen copy. */
function legacyApp(): string {
    const dir = tempCopy("app", path.join(REPO, "app"));
    dropTableLayout(dir);
    placeLegacyConfig(dir, path.join(LEGACY, "app"));
    return dir;
}

/** A scaffold of one preset at 0.30.1: today's template around it, its `config/collections` the frozen preset. */
function legacyTemplate(preset: "blog" | "ecommerce" | "blank"): string {
    const dir = tempCopy(`template-${preset}`, path.join(REPO, "packages", "cli", "templates", "template"));
    dropTableLayout(dir);
    placeLegacyConfig(dir, path.join(LEGACY, "cli-template", preset));
    return dir;
}

/**
 * The control plane at its last 0.30 layout: today's `saas/` around it, its
 * `config/collections` the frozen copy its own plan-golden suite keeps.
 */
const SAAS = path.join(REPO, "saas");
const SAAS_LEGACY = path.join(SAAS, "test", "plan-corpus-legacy");
function legacySaas(): string {
    const dir = tempCopy("saas", SAAS);
    dropTableLayout(dir);
    placeLegacyConfig(dir, path.join(SAAS_LEGACY, "saas"), path.join(SAAS_LEGACY, "legacy-model.ts"));
    return dir;
}

/**
 * Every input but `saas` is in this repository, so a missing one is a failure,
 * not a skip: a renamed fixture must not turn the only full run of the codemod
 * on a real project into a silent no-op. `saas` is a private repository checked
 * out beside this one; it is skipped only when the checkout is absent, and a
 * checkout without its frozen copy fails, for the same reason.
 */
const PROJECTS: { name: string; input: string; dir: () => string; optional?: boolean }[] = [
    { name: "app", input: path.join(LEGACY, "app", "collections"), dir: legacyApp },
    { name: "template blog", input: path.join(LEGACY, "cli-template", "blog", "collections"), dir: () => legacyTemplate("blog") },
    { name: "template ecommerce", input: path.join(LEGACY, "cli-template", "ecommerce", "collections"), dir: () => legacyTemplate("ecommerce") },
    { name: "template blank", input: path.join(LEGACY, "cli-template", "blank", "collections"), dir: () => legacyTemplate("blank") },
    { name: "saas", input: path.join(SAAS_LEGACY, "saas", "collections"), dir: legacySaas, optional: true }
];

describe("the repository's projects migrate with byte-identical SQL", () => {
    for (const project of PROJECTS) {
        it.skipIf(project.optional === true && !fs.existsSync(SAAS))(project.name, async () => {
            expect(fs.existsSync(project.input), `${project.name}: its legacy input ${path.relative(REPO, project.input)} is missing`).toBe(true);
            const dir = project.dir();
            const report = await migrateCollectionsToTables({ projectRoot: dir, force: true, moduleAliases: ALIASES });
            const summary = {
                project: project.name,
                status: report.status,
                tables: report.collections.filter(outcome => outcome.kind !== "refused" && outcome.kind !== "firestore").length,
                refused: report.refusals.map(refusal => `${refusal.file}${refusal.line !== undefined ? `:${refusal.line}` : ""} ${refusal.reason}`),
                customizations: report.collections.filter(outcome => outcome.frontendFile !== undefined).length,
                identical: report.verification?.identical,
                manualSteps: report.manualSteps.map(step => step.title)
            };
            console.info(JSON.stringify(summary));
            expect(report.refusals).toEqual([]);
            // A project the codemod was already applied to (its config/ kept until
            // the user deletes it) is found holding exactly what the run writes.
            expect(["migrated", "already-migrated"]).toContain(report.status);
            expect(report.verification?.differences.map(difference => `${difference.output}\n${difference.diff}`)).toEqual([]);
            expect(report.verification?.identical).toBe(true);
        }, 300_000);
    }

    it.each(fs.readdirSync(path.join(REPO, "examples")).filter(name => fs.statSync(path.join(REPO, "examples", name)).isDirectory()))(
        "examples/%s has no legacy layout, and the codemod says so",
        async name => {
            const report = await migrateCollectionsToTables({ projectRoot: path.join(REPO, "examples", name), dryRun: true, moduleAliases: ALIASES });
            expect(report.status).toBe("blocked");
            expect(report.refusals[0].reason).toMatch(/nothing to migrate/);
            expect(report.files).toEqual([]);
        }
    );
});
