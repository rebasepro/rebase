/**
 * `bin/rebase.js` warns that `dist/` is older than `src/` only to someone
 * developing the CLI.
 *
 * The global `rebase` on a CLI developer's machine is linked to the checkout,
 * so a bare `rebase cloud deploy` in a customer project ran the monorepo's
 * `bin/` and printed "dist/ is 159h older than src/" on every deploy, to a
 * project that had pinned its own `@rebasepro/cli` and could do nothing about
 * it.
 *
 * Driven the way `bin-floor.test.ts` is: a copy of the shipped bin in a scratch
 * layout, with `src/` written after `dist/`. The stub bundle exits as soon as it
 * is imported, so each run stops right after the check under test.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const realBin = path.resolve(here, "..", "bin", "rebase.js");

const WARNING = "you are running a stale build";

let scratch: string;

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bin-stale-")));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true,
force: true });
});

/** A CLI package at `dir` whose build is an hour older than its source. */
function plantStaleCli(dir: string, { withSrc = true } = {}) {
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.copyFileSync(realBin, path.join(dir, "bin", "rebase.js"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@rebasepro/cli",
version: "0.0.0" }));

    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    const dist = path.join(dir, "dist", "index.es.js");
    fs.writeFileSync(dist, "process.exit(0);\n");
    const anHourAgo = new Date(Date.now() - 3_600_000);
    fs.utimesSync(dist, anHourAgo, anHourAgo);

    if (withSrc) {
        fs.mkdirSync(path.join(dir, "src"), { recursive: true });
        fs.writeFileSync(path.join(dir, "src", "index.ts"), "export {};\n");
    }
    return path.join(dir, "bin", "rebase.js");
}

/** A monorepo checkout: a pnpm workspace with the CLI at `packages/cli`. */
function plantCheckout() {
    const root = path.join(scratch, "rebase");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    return { root,
bin: plantStaleCli(path.join(root, "packages", "cli")) };
}

/** A customer project, outside any checkout. */
function plantProject() {
    const project = path.join(scratch, "songbuzz");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "songbuzz",
private: true }));
    return project;
}

async function stderrOf(bin: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
    const childEnv: NodeJS.ProcessEnv = { ...process.env,
NO_COLOR: "1",
...env };
    if (!("REBASE_CLI_DEV" in env)) delete childEnv.REBASE_CLI_DEV;
    const { stderr } = await run(process.execPath, [bin, "status"], { cwd,
env: childEnv });
    return stderr;
}

describe("the stale-build warning", () => {
    it("warns in a monorepo checkout whose build is older than its source", async () => {
        const { root, bin } = plantCheckout();
        expect(await stderrOf(bin, root)).toContain(WARNING);
    });

    it("warns from anywhere inside the checkout, a worktree included", async () => {
        const { root, bin } = plantCheckout();
        const worktree = path.join(root, ".claude", "worktrees", "some-branch");
        fs.mkdirSync(worktree, { recursive: true });
        expect(await stderrOf(bin, worktree)).toContain(WARNING);
    });

    it("stays silent for a published install, which has no src/", async () => {
        const project = plantProject();
        const bin = plantStaleCli(path.join(project, "node_modules", "@rebasepro", "cli"), { withSrc: false });
        expect(await stderrOf(bin, project)).not.toContain(WARNING);
    });

    it("stays silent for anything under node_modules, even one that ships src/", async () => {
        const project = plantProject();
        // A customer monorepo is a pnpm workspace too; being installed is what decides it.
        fs.writeFileSync(path.join(project, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
        const bin = plantStaleCli(path.join(project, "node_modules", "@rebasepro", "cli"));
        expect(await stderrOf(bin, project)).not.toContain(WARNING);
    });

    it("stays silent when a linked checkout runs in a customer project", async () => {
        // The SongBuzz case: the global `rebase` is linked to the checkout.
        const { bin } = plantCheckout();
        expect(await stderrOf(bin, plantProject())).not.toContain(WARNING);
    });

    it("warns there too when REBASE_CLI_DEV asks for it", async () => {
        const { bin } = plantCheckout();
        expect(await stderrOf(bin, plantProject(), { REBASE_CLI_DEV: "1" })).toContain(WARNING);
    });

    it("stays silent for a source tree that is not in a workspace", async () => {
        const project = plantProject();
        const bin = plantStaleCli(path.join(scratch, "loose-cli"));
        expect(await stderrOf(bin, project)).not.toContain(WARNING);
    });
});
