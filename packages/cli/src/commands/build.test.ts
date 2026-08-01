/**
 * What `rebase build` does with each runtime.
 *
 * A custom runtime's artifact is an image, not a bundle. `rebase build` had no
 * `runtime` check, so an ejected project still got a `dist-bundle/` built for
 * it — one it never deploys. That is worse than doing nothing, because it looks
 * like the thing that ships.
 *
 * This used to be asserted by reading `commands/build.ts` as TEXT and matching
 * regexes against it, including an `indexOf` ordering check. Renaming a local
 * variable broke it, and swapping the branches for two that behave identically
 * wrong passed it. These call the command and observe what it builds.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../bundle", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../bundle")>();
    return {
        ...actual,
        buildBundle: vi.fn(async () => ({
            outDir: "/tmp/dist-bundle",
            collectionCount: 0,
            manifest: { schemaVersion: "v1",
hooks: { native: false } }
        })),
        detectFrameworkDepDrift: vi.fn(() => ({ behind: [],
disagreeing: [] }))
    };
});

vi.mock("../fold-static", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../fold-static")>();
    return { ...actual,
foldFrontendIntoBundle: vi.fn(async () => undefined) };
});

import { buildBundle } from "../bundle";
import { buildCommand } from "./build";

let projectRoot: string;
let cwd: string;

beforeEach(() => {
    cwd = process.cwd();
    // Resolve symlinks: on macOS the temp dir is under /private/var, and
    // `findProjectRoot` walks up from the *resolved* cwd.
    projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-build-runtime-")));
    vi.mocked(buildBundle).mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(projectRoot, { recursive: true,
force: true });
    vi.restoreAllMocks();
});

function manifest(runtime: "managed" | "custom"): void {
    fs.writeFileSync(path.join(projectRoot, "rebase.json"), JSON.stringify({
        rebase: "^1",
        apps: {
            backend: {
                type: "backend",
                runtime,
                ...(runtime === "custom" ? { dockerfile: "Dockerfile" } : {})
            }
        }
    }));
    process.chdir(projectRoot);
}

describe("what `rebase build` does with each runtime", () => {

    it("skips the bundle for a custom backend", async () => {
        manifest("custom");
        await buildCommand(["node", "rebase", "build"]);
        expect(buildBundle).not.toHaveBeenCalled();
    });

    it("still bundles a managed backend", async () => {
        manifest("managed");
        await buildCommand(["node", "rebase", "build"]);
        expect(buildBundle).toHaveBeenCalledTimes(1);
        expect(vi.mocked(buildBundle).mock.calls[0][0]).toMatchObject({ appName: "backend" });
    });
});
