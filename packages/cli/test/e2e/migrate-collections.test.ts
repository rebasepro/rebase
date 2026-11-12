/**
 * `rebase migrate collections-to-tables` on a project, end to end: migrate,
 * build, boot, read.
 *
 * The codemod's unit suite (`src/codemod/collections-to-tables/migrate.test.ts`)
 * proves what it WRITES — every file byte-compared with the `blog` fixture's
 * expected tree, and the generated SQL identical before and after. It cannot
 * prove that what it writes is a project this release runs: the expected tree
 * is a snapshot, and a snapshot of a project that no longer boots stays green.
 * Here the same legacy `config/` is dropped into a real scaffold (installed
 * against the working tree), migrated by the real CLI, built with
 * `rebase build`, booted with `rebase dev`, and read over REST — including a
 * `beforeSave` hook the codemod carried from the collection's callbacks into
 * `hooks`, which only a running server executes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execa } from "execa";
import {
    cliBin,
    cliRoot,
    repoRoot,
    getCleanEnv,
    assertPackagesBuilt,
    linkLocalPackages,
    startBackend,
    stopBackend,
    claimFirstAdmin,
    writeRow,
    readRows,
    type AuthedUser,
    type RunningBackend
} from "./helpers.js";

const env = getCleanEnv();
const gitEnv = {
    ...env,
    GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@example.test",
    GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@example.test"
};

/** The legacy project the codemod's unit suite migrates; files carry a `.txt` suffix. */
const FIXTURE = path.join(cliRoot, "src", "codemod", "collections-to-tables", "__fixtures__", "blog", "input");

let tempDir: string;
let projectDir: string;
let backend: RunningBackend | undefined;
let admin: AuthedUser;
let report: { status?: string; refusals?: unknown[]; verification?: { identical?: boolean }; collections?: { slug: string }[] };

/** Copy the fixture's `<from>` subtree into the project, dropping the `.txt` suffix. */
function overlay(from: string): void {
    const root = path.join(FIXTURE, from);
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const source = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(source);
                continue;
            }
            const target = path.join(projectDir, path.relative(FIXTURE, source)).replace(/\.txt$/, "");
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
        }
    };
    walk(root);
}

/**
 * Turn a fresh scaffold back into a project on the collections layout: no
 * `backend/schema`, no `frontend/src/cms`, a `config` workspace holding the
 * fixture's collections, and the fixture's legacy `App.tsx` (the virtual
 * collections module) and `rebase.json` (`apps.backend.config`).
 */
function onTheLegacyLayout(): void {
    for (const gone of ["backend/schema", "backend/storage.ts", "backend/resources.ts", "frontend/src/cms"]) {
        fs.rmSync(path.join(projectDir, gone), { recursive: true, force: true });
    }
    overlay("config");
    overlay("frontend/src");
    fs.copyFileSync(path.join(FIXTURE, "frontend", "vite.config.ts.txt"), path.join(projectDir, "frontend", "vite.config.ts"));
    fs.copyFileSync(path.join(FIXTURE, "rebase.json.txt"), path.join(projectDir, "rebase.json"));

    // The config workspace resolves its imports from the working tree, like
    // the rest of the project.
    const link = (name: string) => `link:${path.join(repoRoot, "packages", name)}`;
    fs.writeFileSync(path.join(projectDir, "config", "package.json"), JSON.stringify({
        name: "blog-config",
        private: true,
        type: "module",
        dependencies: { "@rebasepro/types": link("types"), "@rebasepro/cms-types": link("cms-types") }
    }, null, 2));

    const rootManifest = path.join(projectDir, "package.json");
    const manifest = JSON.parse(fs.readFileSync(rootManifest, "utf8")) as { workspaces?: string[] };
    manifest.workspaces = [...(manifest.workspaces ?? []), "config"];
    fs.writeFileSync(rootManifest, JSON.stringify(manifest, null, 2));
    const workspace = path.join(projectDir, "pnpm-workspace.yaml");
    fs.writeFileSync(workspace, fs.readFileSync(workspace, "utf8").replace('  - "backend"\n', '  - "backend"\n  - "config"\n'));
}

beforeAll(async () => {
    assertPackagesBuilt();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-migrate-e2e-"));
    await execa("node", [cliBin, "init", "myapp", "--yes", "--template", "blog"], { cwd: tempDir, env });
    projectDir = path.join(tempDir, "myapp");
    onTheLegacyLayout();
    linkLocalPackages(projectDir);
    await execa("pnpm", ["install"], { cwd: projectDir, env });

    // The codemod refuses a dirty tree, so that what it changes is one diff.
    await execa("git", ["init", "-q"], { cwd: projectDir, env: gitEnv });
    await execa("git", ["add", "-A"], { cwd: projectDir, env: gitEnv });
    await execa("git", ["commit", "-q", "-m", "legacy layout"], { cwd: projectDir, env: gitEnv });

    const run = await execa("node", [cliBin, "migrate", "collections-to-tables", "--json"], { cwd: projectDir, env, reject: false });
    try {
        report = JSON.parse(run.stdout);
    } catch {
        throw new Error(`migrate printed no JSON report (exit ${run.exitCode}):\n${run.stdout}\n${run.stderr}`);
    }

    // What the report says finishes the migration: remove config/.
    fs.rmSync(path.join(projectDir, "config"), { recursive: true, force: true });
    await execa("pnpm", ["install"], { cwd: projectDir, env });
}, 900_000);

afterAll(async () => {
    await stopBackend(backend);
    if (projectDir) await execa("node", [cliBin, "db", "stop"], { cwd: projectDir, env, reject: false });
    if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
}, 120_000);

describe("rebase migrate collections-to-tables, then build, boot and read", () => {
    it("migrates every collection with identical SQL and no refusals", () => {
        expect(report.status, JSON.stringify(report, null, 2)).toBe("migrated");
        expect(report.refusals).toEqual([]);
        expect(report.verification?.identical).toBe(true);
        expect((report.collections ?? []).map(c => c.slug).sort()).toEqual(["authors", "posts", "tags", "users"]);
        expect(fs.existsSync(path.join(projectDir, "backend", "schema", "posts.ts"))).toBe(true);
        expect(fs.existsSync(path.join(projectDir, "frontend", "src", "cms", "posts.tsx"))).toBe(true);
    });

    it("builds a bundle from backend/schema", async () => {
        const build = await execa("node", [cliBin, "build", "--no-static", "--skip-type-check"], { cwd: projectDir, env, reject: false });
        expect(build.exitCode, `${build.stdout}\n${build.stderr}`).toBe(0);
        expect(fs.existsSync(path.join(projectDir, "dist-bundle"))).toBe(true);
    }, 300_000);

    it("boots, and serves a migrated table — hooks included", async () => {
        backend = await startBackend(projectDir, env);
        admin = await claimFirstAdmin(backend.baseUrl);

        const write = await writeRow(backend.baseUrl, admin.accessToken, "posts", { title: "Hello Codemod", status: "published" });
        expect(write.status).toBe(201);
        const read = await readRows(backend.baseUrl, admin.accessToken, "posts");
        expect(read.status).toBe(200);
        const row = read.rows.find(r => r.title === "Hello Codemod");
        expect(row).toBeDefined();
        // The collection's beforeSave callback, migrated into `hooks.beforeSave`,
        // derived the slug on the server.
        expect(row?.slug).toBe("hello-codemod");
    }, 300_000);
});
