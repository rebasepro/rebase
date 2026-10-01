/**
 * One `rebase build` builds each static app once.
 *
 * A static app has two consumers in one build: the backend bundle folds it in
 * (so one runtime serves the site and the API), and the app's own static
 * bundle (`dist-bundle-<name>/`). Each ran the app's build command, so the
 * stock scaffold ran `vite build && tsc` for `admin` twice and wrote the same
 * 268 files twice. Same command, same environment, same output directory:
 * the second run could only ever reproduce the first.
 */
import fs from "fs";
import os from "os";
import path from "path";
import chalk from "chalk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let cwd: string;

vi.mock("../bundle", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../bundle")>();
    return {
        ...actual,
        // The backend bundle itself is not what this is about; a directory with
        // a manifest is all folding needs from it.
        buildBundle: vi.fn(async () => {
            const outDir = path.join(projectRoot, "dist-bundle");
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ bundleFormat: 1, entry: {} }));
            return {
                outDir,
                collectionCount: 0,
                manifest: { schemaVersion: "v1", hooks: { native: false }, deps: { declared: {} } },
                vendor: { vendored: true, target: { os: "linux", cpu: "x64", node: "22" } }
            };
        }),
        detectFrameworkDepDrift: vi.fn(() => ({ behind: [], disagreeing: [], conflicting: [] }))
    };
});

import { buildCommand } from "./build";

const colourLevel = chalk.level;
beforeAll(() => { chalk.level = 0; });
afterAll(() => { chalk.level = colourLevel; });

beforeEach(() => {
    cwd = process.cwd();
    projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-build-once-")));
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/** A build command that records each run, then writes the app's output. */
const COUNTING_BUILD = "node -e \"const fs=require('fs');fs.appendFileSync('builds.log','run\\n');" +
    "fs.mkdirSync('admin-dist',{recursive:true});fs.writeFileSync('admin-dist/index.html','<html></html>')\"";

function scaffoldShape(): void {
    fs.writeFileSync(path.join(projectRoot, "rebase.json"), JSON.stringify({
        rebase: "^1",
        apps: {
            backend: { type: "backend", runtime: "managed" },
            admin: { type: "static", root: "frontend", path: "/", build: COUNTING_BUILD, output: "admin-dist" }
        }
    }));
    process.chdir(projectRoot);
}

const runs = () => fs.readFileSync(path.join(projectRoot, "builds.log"), "utf8").split("\n").filter(Boolean).length;

describe("rebase build", () => {
    it("runs a static app's build once, and both consumers get its output", async () => {
        scaffoldShape();
        await buildCommand(["node", "rebase", "build"]);

        expect(runs()).toBe(1);
        // Folded into the backend bundle…
        expect(fs.existsSync(path.join(projectRoot, "dist-bundle", "static", "admin", "index.html"))).toBe(true);
        // …and packaged as its own static bundle.
        expect(fs.existsSync(path.join(projectRoot, "dist-bundle-admin"))).toBe(true);
    });

    it("still builds the app when only the static bundle is asked for", async () => {
        scaffoldShape();
        await buildCommand(["node", "rebase", "build", "admin"]);
        expect(runs()).toBe(1);
    });
});
