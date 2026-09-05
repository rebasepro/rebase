/**
 * Tests for package manager detection and command abstraction.
 *
 * Verifies that the detection logic correctly identifies pnpm/npm
 * from environment variables, lock files, and defaults, and that
 * the command builders produce correct arguments for each PM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// The real `spawnSync`, wrapped in a spy: detection behaves exactly as it does
// on this machine, and the caching test can count how many processes it cost.
vi.mock("child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("child_process")>();
    return { ...actual,
spawnSync: vi.fn(actual.spawnSync) };
});
import { spawnSync } from "child_process";

import {
    detectPackageManager,
    getPMCommands,
    isPnpmAvailable,
    pnpmAvailabilityFromProbe,
    resetPnpmAvailabilityCache
} from "./package-manager";
import type { PackageManager, PMCommands } from "./package-manager";

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-pm-test-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true,
force: true });
    // Restore env
    delete process.env.npm_config_user_agent;
});

// =============================================================================
// Detection
// =============================================================================

describe("detectPackageManager", () => {
    describe("invocation is not a project signal", () => {
        it("ignores an npm user agent and prefers pnpm when installed", () => {
            // Running `npx @rebasepro/cli init` must not pin the project to npm.
            process.env.npm_config_user_agent = "npm/10.2.0 node/v20.11.0 darwin arm64";
            expect(detectPackageManager(tmpDir)).toBe("pnpm");
        });

        it("an existing lock file still wins over invocation", () => {
            process.env.npm_config_user_agent = "pnpm/8.15.4 npm/? node/v20.11.0 darwin arm64";
            // A committed package-lock.json is an explicit choice we respect.
            fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");
            expect(detectPackageManager(tmpDir)).toBe("npm");
        });
    });

    describe("lock file detection", () => {
        it("detects npm from package-lock.json in target dir", () => {
            delete process.env.npm_config_user_agent;
            fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");
            expect(detectPackageManager(tmpDir)).toBe("npm");
        });

        it("detects pnpm from pnpm-lock.yaml in target dir", () => {
            delete process.env.npm_config_user_agent;
            fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");
            expect(detectPackageManager(tmpDir)).toBe("pnpm");
        });

        it("prefers pnpm-lock.yaml over package-lock.json when both exist", () => {
            delete process.env.npm_config_user_agent;
            fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "{}");
            fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'");
            // pnpm is checked first — Rebase's recommended PM wins a tie.
            expect(detectPackageManager(tmpDir)).toBe("pnpm");
        });
    });

    describe("a lockfile this CLI cannot honour", () => {
        // Yarn and bun users used to get an npm workspace in silence, with
        // their own lockfile sitting in the same directory. The choice stands —
        // the scaffold writes one workspace protocol, and yarn and bun disagree
        // with pnpm about both that and where node_modules goes — but it is
        // said out loud now, which is the whole of the fix.
        for (const lock of ["yarn.lock", "bun.lockb", "bun.lock"]) {
            it(`says so when it finds ${lock}`, () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                fs.writeFileSync(path.join(tmpDir, lock), "");

                const pm = detectPackageManager(tmpDir);

                expect(["pnpm", "npm"]).toContain(pm);
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn.mock.calls[0][0]).toContain(lock);
                expect(warn.mock.calls[0][0]).toContain("not supported yet");
                warn.mockRestore();
            });
        }

        it("stays quiet when a supported lockfile is also present", () => {
            // A pnpm workspace that happens to carry a stale yarn.lock is not a
            // yarn project, and a warning on every command would be noise.
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "");
            fs.writeFileSync(path.join(tmpDir, "yarn.lock"), "");

            expect(detectPackageManager(tmpDir)).toBe("pnpm");
            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
        });
    });

    describe("default behavior", () => {
        it("defaults to pnpm when installed and no lock file is present", () => {
            delete process.env.npm_config_user_agent;
            // Test runs in the pnpm-based Rebase monorepo, so pnpm is available.
            expect(detectPackageManager(tmpDir)).toBe("pnpm");
        });

        it("defaults to pnpm when no target dir is provided", () => {
            delete process.env.npm_config_user_agent;
            expect(detectPackageManager()).toBe("pnpm");
        });
    });
});

// =============================================================================
// Command builders
// =============================================================================

describe("getPMCommands", () => {
    describe("pnpm commands", () => {
        let cmds: PMCommands;

        beforeEach(() => {
            cmds = getPMCommands("pnpm");
        });

        it("has the correct name", () => {
            expect(cmds.name).toBe("pnpm");
        });

        it("produces correct install command", () => {
            expect(cmds.install).toEqual(["pnpm", "install"]);
        });

        it("produces correct run command", () => {
            expect(cmds.run("dev")).toEqual(["pnpm", "run", "dev"]);
            expect(cmds.run("build")).toEqual(["pnpm", "run", "build"]);
        });

        it("produces correct exec command", () => {
            expect(cmds.exec("rebase", ["schema", "generate"])).toEqual([
                "pnpm", "exec", "rebase", "schema", "generate"
            ]);
        });

        it("produces correct view command", () => {
            expect(cmds.view("@rebasepro/cli", "version")).toEqual([
                "pnpm", "view", "@rebasepro/cli", "version"
            ]);
        });

        it("produces correct runAll command", () => {
            expect(cmds.runAll("build")).toEqual(["pnpm", "-r", "run", "build"]);
        });

        it("produces correct runWorkspace command", () => {
            // Path-based filter — pnpm's --filter matches package name, not dir.
            expect(cmds.runWorkspace("backend", "start")).toEqual([
                "pnpm", "--filter", "./backend", "run", "start"
            ]);
        });

        it("uses workspace:* protocol", () => {
            expect(cmds.workspaceProtocol).toBe("workspace:*");
        });
    });

    describe("npm commands", () => {
        let cmds: PMCommands;

        beforeEach(() => {
            cmds = getPMCommands("npm");
        });

        it("has the correct name", () => {
            expect(cmds.name).toBe("npm");
        });

        it("produces correct install command", () => {
            expect(cmds.install).toEqual(["npm", "install"]);
        });

        it("produces correct run command", () => {
            expect(cmds.run("dev")).toEqual(["npm", "run", "dev"]);
            expect(cmds.run("build")).toEqual(["npm", "run", "build"]);
        });

        it("produces correct exec command", () => {
            expect(cmds.exec("rebase", ["schema", "generate"])).toEqual([
                "npx", "rebase", "schema", "generate"
            ]);
        });

        it("produces correct view command", () => {
            expect(cmds.view("@rebasepro/cli", "version")).toEqual([
                "npm", "view", "@rebasepro/cli", "version"
            ]);
        });

        it("produces correct runAll command", () => {
            expect(cmds.runAll("build")).toEqual([
                "npm", "run", "build", "--workspaces", "--if-present"
            ]);
        });

        it("produces correct runWorkspace command", () => {
            expect(cmds.runWorkspace("backend", "start")).toEqual([
                "npm", "run", "start", "-w", "backend"
            ]);
        });

        it("uses * protocol (no workspace: prefix)", () => {
            expect(cmds.workspaceProtocol).toBe("*");
        });
    });
});

// =============================================================================
// Type safety
// =============================================================================

describe("type contracts", () => {
    it("detectPackageManager returns only 'pnpm' or 'npm'", () => {
        const validValues: PackageManager[] = ["pnpm", "npm"];
        delete process.env.npm_config_user_agent;
        const result = detectPackageManager(tmpDir);
        expect(validValues).toContain(result);
    });

    it("PMCommands.run returns a new array each time", () => {
        const cmds = getPMCommands("pnpm");
        const a = cmds.run("dev");
        const b = cmds.run("dev");
        expect(a).toEqual(b);
        expect(a).not.toBe(b); // different references
    });

    it("PMCommands.exec returns a new array each time", () => {
        const cmds = getPMCommands("npm");
        const args = ["schema", "generate"];
        const a = cmds.exec("rebase", args);
        const b = cmds.exec("rebase", args);
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
    });
});

// =============================================================================
// Probe interpretation
// =============================================================================

/**
 * These replaced a real `pnpm --version` spawn as the only coverage of this
 * decision. That spawn carried a 3s budget, and `pnpm --version` on a loaded
 * machine was measured at 630ms, 990ms and 4293ms on three consecutive runs —
 * so the suite went red whenever the machine happened to be busy, which is
 * exactly when a full test run happens.
 *
 * Interpreting a `spawnSync` result needs no process, so these are exact.
 */
describe("pnpmAvailabilityFromProbe", () => {
    it("reports absent when the binary is not on PATH", () => {
        expect(pnpmAvailabilityFromProbe({
            status: null,
signal: null,
error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })
        })).toBe(false);
    });

    it("reports AVAILABLE when the probe timed out", () => {
        // The regression this whole change exists for. A timeout means the
        // binary was found and started, so pnpm is installed — it was slow, not
        // missing. Calling it missing silently scaffolded npm projects for
        // developers who had pnpm.
        expect(pnpmAvailabilityFromProbe({
            status: null,
signal: "SIGTERM",
error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })
        })).toBe(true);
    });

    it("reports available when killed by a signal even without an error code", () => {
        expect(pnpmAvailabilityFromProbe({ status: null,
signal: "SIGKILL" })).toBe(true);
    });

    it("reports available on a clean exit", () => {
        expect(pnpmAvailabilityFromProbe({ status: 0,
signal: null })).toBe(true);
    });

    it("reports absent on a non-zero exit — installed but broken is not usable", () => {
        expect(pnpmAvailabilityFromProbe({ status: 3,
signal: null })).toBe(false);
    });

    it("reports absent for an unrecognised spawn error rather than guessing", () => {
        expect(pnpmAvailabilityFromProbe({
            status: null,
signal: null,
error: Object.assign(new Error("EACCES"), { code: "EACCES" })
        })).toBe(false);
    });

    it("does not confuse a timeout with a missing binary", () => {
        // The precise conflation the old `status === 0` check made: both cases
        // have status null, and it answered false to both.
        const timedOut = { status: null,
signal: "SIGTERM" as const,
error: Object.assign(new Error(""), { code: "ETIMEDOUT" }) };
        const missing = { status: null,
signal: null,
error: Object.assign(new Error(""), { code: "ENOENT" }) };
        expect(pnpmAvailabilityFromProbe(timedOut)).not.toBe(pnpmAvailabilityFromProbe(missing));
    });
});

describe("pnpm probe caching", () => {

    const probeCalls = () =>
        vi.mocked(spawnSync).mock.calls.filter(([bin]) => bin === "pnpm").length;

    beforeEach(() => {
        vi.mocked(spawnSync).mockClear();
        resetPnpmAvailabilityCache();
    });

    afterEach(() => {
        resetPnpmAvailabilityCache();
    });

    it("probes once and reuses the answer", () => {
        // Detection is called several times in one CLI run; without memoisation
        // each call spawned its own process, multiplying the chance that one of
        // them hit the timeout. Counting spawns is the only thing that shows
        // the memoisation is still there — the old assertions held with the
        // cache deleted.
        const first = isPnpmAvailable();
        expect(probeCalls()).toBe(1);

        for (let i = 0; i < 5; i++) expect(isPnpmAvailable()).toBe(first);
        expect(probeCalls()).toBe(1);

        // ...and through the caller that matters: an empty dir has no lock file,
        // so detection falls through to the probe every time.
        detectPackageManager(tmpDir);
        detectPackageManager(tmpDir);
        expect(probeCalls()).toBe(1);
    });

    it("resetPnpmAvailabilityCache lets a fresh probe run", () => {
        isPnpmAvailable();
        expect(probeCalls()).toBe(1);

        resetPnpmAvailabilityCache();
        isPnpmAvailable();
        expect(probeCalls()).toBe(2);
    });

    it("caches a negative answer too, rather than re-probing a missing binary", () => {
        vi.mocked(spawnSync).mockReturnValueOnce({
            status: null,
            signal: null,
            error: Object.assign(new Error("ENOENT"), { code: "ENOENT" })
        } as unknown as ReturnType<typeof spawnSync>);

        expect(isPnpmAvailable()).toBe(false);
        expect(isPnpmAvailable()).toBe(false);
        expect(probeCalls()).toBe(1);
    });
});
