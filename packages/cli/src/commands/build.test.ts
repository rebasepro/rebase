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
hooks: { native: false },
deps: { declared: {} } },
            // The real function always reports this; a double that omits it
            // makes the command look broken when only the double is stale.
            vendor: { vendored: true,
target: { os: "linux",
cpu: "x64",
node: "22" } }
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

    // The parser used to run permissively and then filter `_` for tokens that
    // do not start with `-`, so a mistyped flag was dropped in silence and the
    // build ran as though it had not been asked for anything: `rebase build
    // --skip-typecheck` (the real flag is `--skip-type-check`) typechecked.
    it("refuses a flag nobody declared instead of building anyway", async () => {
        manifest("managed");
        await expect(buildCommand(["node", "rebase", "build", "--skip-typecheck"]))
            .rejects.toThrow(/unknown or unexpected option/);
        expect(buildBundle).not.toHaveBeenCalled();
    });

    // `rawArgs` is the whole `process.argv`, so `slice(3)` only found the app
    // names when the command word sat at exactly index 2.
    it("still names its target when a flag precedes the command", async () => {
        manifest("managed");
        await buildCommand(["node", "rebase", "--debug", "build", "backend"]);
        expect(vi.mocked(buildBundle).mock.calls[0][0]).toMatchObject({ appName: "backend" });
    });
});

describe("the build summary line", () => {
    /** Every `console.log` argument of one build, joined. */
    async function summary(schemaVersion: string): Promise<string> {
        manifest("managed");
        vi.mocked(buildBundle).mockResolvedValueOnce({
            outDir: path.join(projectRoot, "dist-bundle"),
            collectionCount: 0,
            manifest: { schemaVersion, hooks: { native: false }, deps: { declared: {} } },
            vendor: { vendored: false }
        } as unknown as Awaited<ReturnType<typeof buildBundle>>);
        await buildCommand(["node", "rebase", "build"]);
        const printed = vi.mocked(console.log).mock.calls.map(c => String(c[0]));
        return printed.find(line => line.includes("collection(s)")) ?? "";
    }

    it("omits the schema clause for a headless build, rather than dangling", async () => {
        // A headless project's manifest carries `schemaVersion: ""` — its API is
        // introspected at boot — and the line interpolated it anyway, ending in
        // `0 collection(s), schema ` with nothing after it. That reads as a
        // value that failed to render.
        expect(await summary("")).toMatchInlineSnapshot(`"    0 collection(s)"`);
    });

    it("still names the schema when there is one", async () => {
        expect(await summary("v1")).toMatchInlineSnapshot(`"    0 collection(s), schema v1"`);
    });
});
