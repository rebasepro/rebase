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
import chalk from "chalk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
disagreeing: [],
conflicting: [] }))
    };
});

vi.mock("../fold-static", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../fold-static")>();
    return { ...actual,
foldFrontendIntoBundle: vi.fn(async () => undefined) };
});

import { buildBundle } from "../bundle";
import { buildCommand, dockerBuildHint } from "./build";

let projectRoot: string;
let cwd: string;

// Colour off for the whole file, because several tests here assert on printed
// text and chalk decides at import time from the environment. `FORCE_COLOR` set
// on a developer's machine turned the two summary-line snapshots red on a clean
// tree — a suite that fails on a terminal preference reads as a broken build.
// Off at the source rather than stripped afterwards: a filter that removes
// escape codes passes whether or not they were there.
const colourLevel = chalk.level;
beforeAll(() => { chalk.level = 0; });
afterAll(() => { chalk.level = colourLevel; });

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

/**
 * The command a custom runtime is told to run has to be one that works.
 *
 * It was `docker build -f <dockerfile> .` for every project, with the `.` a
 * guess and `context` validated, stored, and read by nothing. For the reference
 * project the guess is wrong: `app/backend/Dockerfile` copies `pnpm-lock.yaml`
 * and `pnpm-workspace.yaml`, which live at the monorepo root, so the command
 * died on its first instruction — while `infra/cloudbuild.yaml`, the deploy
 * that does work, had always said `-f app/backend/Dockerfile .` from the root.
 *
 * Asserted on the text because the text is the whole feature: nothing here runs
 * docker, so a wrong path has no other symptom until somebody pastes it.
 */
describe("the docker build command printed for a custom runtime", () => {
    it("builds in place when the context is the project", () => {
        expect(dockerBuildHint("/repo", "backend", { dockerfile: "backend/Dockerfile" }))
            .toEqual([
                "    npm run build --workspace backend  then  docker build -f backend/Dockerfile ."
            ]);
    });

    it("re-expresses the Dockerfile against a context above the project", () => {
        // `-f` resolves against the working directory, not the context, so the
        // path that is right from `app/` is wrong from the root. Printing the
        // declared path unchanged is what made the old line unfixable for one
        // of the two.
        expect(dockerBuildHint("/repo/app", "backend", {
            dockerfile: "backend/Dockerfile",
            context: ".."
        })).toEqual([
            "    npm run build --workspace backend",
            "    cd .. && docker build -f app/backend/Dockerfile ."
        ]);
    });

    it("offers no command when the Dockerfile sits outside its own context", () => {
        // Legal to docker and useless: nothing the Dockerfile COPYs is in the
        // context. A command here would fail on a line the reader did not write.
        expect(dockerBuildHint("/repo", "backend", {
            dockerfile: "backend/Dockerfile",
            context: "frontend"
        })).toEqual([
            "    npm run build --workspace backend",
            "    ⚠ backend/Dockerfile is outside the build context (frontend) — nothing it COPYs is reachable.",
            "      Widen \"context\" in rebase.json, or move the Dockerfile inside it."
        ]);
    });
});
