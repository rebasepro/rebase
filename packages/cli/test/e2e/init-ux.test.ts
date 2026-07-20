/**
 * `rebase init` user-experience invariants.
 *
 * These drive the real binary but never install anything, so they run in
 * seconds and need no database. Each one pins a defect that shipped:
 * next steps that contradicted what had just happened, a `cd` that pointed
 * somewhere the project isn't, flags with no help behind them, a `--git` that
 * left the tree uncommitted, and a `--template` accepted then silently dropped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execa } from "execa";
import { cliBin, getCleanEnv } from "./helpers.js";

const env = getCleanEnv();
let tempDir: string;

/** Run `rebase init …` and return the combined output. */
async function init(args: string[], cwd = tempDir): Promise<string> {
    const res = await execa("node", [cliBin, "init", ...args], { cwd, env, reject: false });
    return `${res.stdout}\n${res.stderr}`;
}

beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-ux-"));
});

afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

describe("rebase init --help", () => {
    it("prints init's own help rather than the global command list", async () => {
        const out = await init(["--help"]);
        expect(out).toContain("rebase init");
        expect(out).toContain("--template");
        // The global help lists other commands; init's help must not.
        expect(out).not.toContain("generate-sdk");
    });

    it("documents every flag init accepts", async () => {
        const out = await init(["--help"]);
        for (const flag of [
            "--template", "--flavor", "--yes", "--install", "--git",
            "--database-url", "--introspect", "--project", "--setup-key"
        ]) {
            expect(out).toContain(flag);
        }
    });
});

describe("next steps: cd target", () => {
    it("prints the path the user typed for a nested project", async () => {
        const out = await init(["apps/nested-app", "--yes", "--template", "blank"]);
        expect(out).toContain("cd apps/nested-app");
        // The basename alone is not a directory the user can enter.
        expect(out).not.toMatch(/cd nested-app\b/);
    });

    it("prints no cd at all for an in-place init", async () => {
        const inPlace = path.join(tempDir, "in-place");
        fs.mkdirSync(inPlace, { recursive: true });
        const out = await init([".", "--yes", "--template", "blank"], inPlace);
        expect(out).toContain("created successfully");
        expect(out).not.toMatch(/^\s*cd /m);
    });
});

describe("--introspect reporting", () => {
    // Introspection needs the project's dependencies; without --install it
    // cannot run, and the next steps used to claim it had anyway.
    const unreachable = "postgresql://u:p@localhost:5999/nope";

    it("does not claim success when introspection was skipped", async () => {
        const out = await init(["skipped-introspect", "--yes", "--database-url", unreachable, "--introspect"]);
        expect(out).toContain("Skipping introspection");
        expect(out).not.toContain("has been introspected");
    });

    it("points at the commands that finish the job", async () => {
        const out = await init(["unfinished-introspect", "--yes", "--database-url", unreachable, "--introspect"]);
        expect(out).toContain("Introspection did not run");
        expect(out).toContain("schema introspect");
        expect(out).toContain("schema generate");
    });

    it("says the database will supply the collections", async () => {
        const out = await init(["blank-by-introspect", "--yes", "--template", "blog",
            "--database-url", unreachable, "--introspect"]);
        expect(out).toContain("Using the blank template");

        // ...and the preset really is dropped, not merely announced.
        const collections = fs.readdirSync(path.join(tempDir, "blank-by-introspect", "config", "collections"));
        expect(collections.sort()).toEqual(["index.ts", "users.ts"]);
    });
});

describe("--template against the baas flavor", () => {
    it("says the preset is ignored instead of silently dropping it", async () => {
        const out = await init(["baas-with-template", "--yes", "--template", "ecommerce", "--flavor", "baas"]);
        expect(out).toContain("Ignoring --template ecommerce");
        expect(fs.existsSync(path.join(tempDir, "baas-with-template", "config"))).toBe(false);
    });
});

describe("--git", () => {
    let project: string;

    beforeAll(async () => {
        await init(["git-project", "--yes", "--template", "blank", "--git"]);
        project = path.join(tempDir, "git-project");
    }, 120_000);

    const git = async (...args: string[]) =>
        (await execa("git", args, { cwd: project, env })).stdout.trim();

    it("creates a repository with an initial commit", async () => {
        expect(fs.existsSync(path.join(project, ".git"))).toBe(true);
        const log = await git("log", "--oneline");
        expect(log.split("\n").filter(Boolean)).toHaveLength(1);
    });

    it("leaves no uncommitted files behind", async () => {
        expect(await git("status", "--short")).toBe("");
    });

    it("names the branch main regardless of init.defaultBranch", async () => {
        // `git init -b` would be the obvious way to do this, but it needs
        // git >= 2.28 — older gits must still land on main.
        expect(await git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    });

    it("commits .env.example but never .env", async () => {
        const tracked = (await git("ls-files")).split("\n");
        expect(tracked).toContain(".env.example");
        expect(tracked).not.toContain(".env");
        // The secrets really are on disk — this is not passing by absence.
        expect(fs.existsSync(path.join(project, ".env"))).toBe(true);
    });
});
