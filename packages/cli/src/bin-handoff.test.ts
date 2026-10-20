/**
 * `bin/rebase.js`, run from a checkout, hands off to the CLI the project pinned.
 *
 * The global `rebase` on a CLI developer's machine is linked to the checkout,
 * so a bare `rebase cloud deploy` in a customer project ran the checkout's
 * `dist/` — 280h older than its source — and not the `@rebasepro/cli` 0.25.1
 * the project had installed.
 *
 * Driven the way `bin-stale-build.test.ts` is: copies of the shipped bin in
 * scratch layouts, each with a stub bundle that says which copy ran, with what
 * arguments, and exits with a code of its own.
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

let scratch: string;

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bin-handoff-")));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true,
force: true });
});

/** A CLI package at `dir` whose bundle prints `ran <label>: <argv>` and exits with `code`. */
function plantCli(dir: string, label: string, { version = "0.0.0", code = 0 } = {}) {
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.copyFileSync(realBin, path.join(dir, "bin", "rebase.js"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
        name: "@rebasepro/cli",
        version,
        type: "module",
        bin: { rebase: "bin/rebase.js" }
    }));
    fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
    fs.writeFileSync(
        path.join(dir, "dist", "index.es.js"),
        `process.stdout.write(${JSON.stringify(`ran ${label}: `)} + process.argv.slice(2).join(" ") + "\\n");\n` +
        `process.exit(${code});\n`
    );
    return path.join(dir, "bin", "rebase.js");
}

/** A monorepo checkout: a pnpm workspace with the CLI at `packages/cli`. */
function plantCheckout() {
    const root = path.join(scratch, "rebase");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    fs.mkdirSync(path.join(root, "packages", "cli", "src"), { recursive: true });
    return { root,
bin: plantCli(path.join(root, "packages", "cli"), "checkout", { version: "0.26.0" }) };
}

/** A customer project, outside any checkout. */
function plantProject() {
    const project = path.join(scratch, "songbuzz");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "songbuzz",
private: true }));
    return project;
}

/** `@rebasepro/cli` installed the way pnpm does it: a link into `.pnpm`. */
function installInto(project: string, { code = 0 } = {}) {
    const store = path.join(project, "node_modules", ".pnpm", "@rebasepro+cli@0.25.1", "node_modules", "@rebasepro", "cli");
    plantCli(store, "pinned", { version: "0.25.1",
code });
    fs.mkdirSync(path.join(project, "node_modules", "@rebasepro"), { recursive: true });
    fs.symlinkSync(store, path.join(project, "node_modules", "@rebasepro", "cli"), "dir");
}

/** Run `bin` from `cwd` and report what ran, whatever it exited with. */
async function runBin(bin: string, cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
    const childEnv: NodeJS.ProcessEnv = { ...process.env,
NO_COLOR: "1",
...env };
    if (!("REBASE_CLI_DEV" in env)) delete childEnv.REBASE_CLI_DEV;
    if (!("REBASE_DEBUG" in env)) delete childEnv.REBASE_DEBUG;
    try {
        const { stdout, stderr } = await run(process.execPath, [bin, ...args], { cwd,
env: childEnv });
        return { stdout,
stderr,
code: 0 };
    } catch (error) {
        const failed = error as { stdout: string; stderr: string; code: number };
        return { stdout: failed.stdout,
stderr: failed.stderr,
code: failed.code };
    }
}

describe("a checkout's bin in a project that installed @rebasepro/cli", () => {
    it("runs the project's CLI with the same arguments and its exit code", async () => {
        const { bin } = plantCheckout();
        const project = plantProject();
        installInto(project, { code: 3 });

        const result = await runBin(bin, project, ["cloud", "deploy", "--yes"]);
        expect(result.stdout).toBe("ran pinned: cloud deploy --yes\n");
        expect(result.code).toBe(3);
        // Silent unless asked: stderr is where the checkout complained before.
        expect(result.stderr).toBe("");
    });

    it("finds the install from a directory below the project root", async () => {
        const { bin } = plantCheckout();
        const project = plantProject();
        installInto(project);
        const nested = path.join(project, "cloud", "functions");
        fs.mkdirSync(nested, { recursive: true });

        expect((await runBin(bin, nested, ["status"])).stdout).toBe("ran pinned: status\n");
    });

    it("finds an npm-style install, a plain directory in node_modules", async () => {
        const { bin } = plantCheckout();
        const project = plantProject();
        plantCli(path.join(project, "node_modules", "@rebasepro", "cli"), "pinned");

        expect((await runBin(bin, project, ["status"])).stdout).toBe("ran pinned: status\n");
    });

    it("names both CLIs under --debug", async () => {
        const { bin } = plantCheckout();
        const project = plantProject();
        installInto(project);

        const { stdout, stderr } = await runBin(bin, project, ["status", "--debug"]);
        expect(stdout).toBe("ran pinned: status --debug\n");
        expect(stderr).toContain("@rebasepro/cli 0.25.1");
        expect(stderr).toContain(path.join("rebase", "packages", "cli"));
    });

    it("runs the checkout when REBASE_CLI_DEV asks for it", async () => {
        const { bin } = plantCheckout();
        const project = plantProject();
        installInto(project);

        const result = await runBin(bin, project, ["status"], { REBASE_CLI_DEV: "1" });
        expect(result.stdout).toBe("ran checkout: status\n");
        expect(result.code).toBe(0);
    });
});

describe("the checkout runs itself", () => {
    it("in a project with no @rebasepro/cli installed", async () => {
        const { bin } = plantCheckout();
        expect((await runBin(bin, plantProject(), ["status"])).stdout).toBe("ran checkout: status\n");
    });

    it("in a project whose @rebasepro/cli links back to a checkout", async () => {
        // This repo's own apps and end-to-end projects: a workspace or `link:`
        // dependency is the build they asked for.
        const { root, bin } = plantCheckout();
        const project = plantProject();
        fs.mkdirSync(path.join(project, "node_modules", "@rebasepro"), { recursive: true });
        fs.symlinkSync(path.join(root, "packages", "cli"), path.join(project, "node_modules", "@rebasepro", "cli"), "dir");

        expect((await runBin(bin, project, ["status"])).stdout).toBe("ran checkout: status\n");
    });
});

describe("an installed CLI", () => {
    it("runs itself even when the project installed another, so a handoff cannot loop", async () => {
        const globalBin = plantCli(path.join(scratch, "global", "node_modules", "@rebasepro", "cli"), "global");
        const project = plantProject();
        installInto(project);

        expect((await runBin(globalBin, project, ["status"])).stdout).toBe("ran global: status\n");
    });
});
