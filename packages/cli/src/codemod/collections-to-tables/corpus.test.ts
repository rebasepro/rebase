/**
 * The codemod on the real projects of this repository, read-only.
 *
 * Each project is copied to a temporary directory and migrated there — the
 * demo app (`app/`), every `rebase init` preset as `applyPreset` lays it out,
 * the cloud control plane (`saas/`, a private repository checked out beside
 * this one, skipped when absent) — and the SQL check must pass: the tables it
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

/** A scaffold of one preset, laid out the way `applyPreset` leaves it. */
function templateProject(preset: "blog" | "ecommerce" | "blank"): string {
    const dir = tempCopy(`template-${preset}`, path.join(REPO, "packages", "cli", "templates", "template"));
    const collections = path.join(dir, "config", "collections");
    const presets = path.join(collections, "presets");
    if (preset !== "blog") {
        for (const file of ["posts.ts", "authors.ts", "tags.ts", "index.ts"]) fs.rmSync(path.join(collections, file), { force: true });
        for (const file of fs.readdirSync(path.join(presets, preset)).filter(name => name.endsWith(".ts"))) {
            fs.copyFileSync(path.join(presets, preset, file), path.join(collections, file));
        }
    }
    fs.rmSync(presets, { recursive: true, force: true });
    return dir;
}

const PROJECTS: { name: string; dir: () => string; present: boolean }[] = [
    { name: "app", dir: () => tempCopy("app", path.join(REPO, "app")), present: fs.existsSync(path.join(REPO, "app", "config", "collections")) },
    { name: "template blog", dir: () => templateProject("blog"), present: true },
    { name: "template ecommerce", dir: () => templateProject("ecommerce"), present: true },
    { name: "template blank", dir: () => templateProject("blank"), present: true },
    { name: "saas", dir: () => tempCopy("saas", path.join(REPO, "saas")), present: fs.existsSync(path.join(REPO, "saas", "config", "collections")) }
];

describe("the repository's projects migrate with byte-identical SQL", () => {
    for (const project of PROJECTS) {
        it.skipIf(!project.present)(project.name, async () => {
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
