/**
 * `rebase eject` — the supported route from the managed runtime to a custom one.
 *
 * The behaviour worth pinning is not "it copies files": it is that the three
 * things that have to change together — entrypoint, image, manifest — do change
 * together, and that a second run cannot quietly overwrite a server the user has
 * since edited.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejectCommand } from "./eject";
import { loadManifest, writeManifest } from "../manifest";
import type { RebaseProjectManifest } from "@rebasepro/types";

let scratch: string;
let cwd: string;
let exitCode: number | undefined;

/** `process.exit` unwinds the test runner, so it throws here instead. */
class Exited extends Error {}

beforeEach(() => {
    cwd = process.cwd();
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-eject-")));
    // `findProjectRoot` looks for these.
    fs.mkdirSync(path.join(scratch, "backend", "src"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "config", "collections"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "frontend"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "package.json"), JSON.stringify({ name: "scratch" }));

    exitCode = undefined;
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        exitCode = code;
        throw new Exited(`exit ${code}`);
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    process.chdir(scratch);
});

afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(scratch, { recursive: true,
force: true });
    vi.restoreAllMocks();
});

function manifestWith(runtime: "managed" | "custom"): void {
    const manifest: RebaseProjectManifest = {
        rebase: "^1",
        apps: {
            backend: runtime === "custom"
                ? { type: "backend",
runtime: "custom",
dockerfile: "Dockerfile",
port: 8080 }
                : { type: "backend",
runtime: "managed" },
            admin: { type: "static",
root: "frontend",
output: "frontend/dist",
path: "/" }
        }
    };
    writeManifest(scratch, manifest);
}

/** Run the command the way the CLI does: argv, with the command at index 2. */
const run = (...flags: string[]) => ejectCommand(["node", "rebase", "eject", ...flags]);

describe("rebase eject", () => {
    it("writes the entrypoint, the Dockerfile and the manifest change together", async () => {
        manifestWith("managed");

        await run();

        expect(fs.existsSync(path.join(scratch, "backend/src/index.ts"))).toBe(true);
        expect(fs.existsSync(path.join(scratch, "backend/src/env.ts"))).toBe(true);
        expect(fs.existsSync(path.join(scratch, "Dockerfile"))).toBe(true);

        const backend = loadManifest(scratch).manifest.apps.backend;
        expect(backend).toMatchObject({
            type: "backend",
            runtime: "custom",
            dockerfile: "Dockerfile",
            port: 8080
        });
    });

    it("leaves a manifest that still validates", async () => {
        // The rewrite goes through the same validator every other command uses,
        // so an eject that produced an unloadable manifest would be caught here
        // rather than on the user's next command.
        manifestWith("managed");
        await run();
        expect(() => loadManifest(scratch)).not.toThrow();
        expect(loadManifest(scratch).source).toBe("file");
    });

    it("refuses to run twice", async () => {
        manifestWith("custom");

        await expect(run()).rejects.toThrow(Exited);
        expect(exitCode).toBe(1);
        // And it did not touch anything on the way out.
        expect(fs.existsSync(path.join(scratch, "backend/src/index.ts"))).toBe(false);
    });

    it("never overwrites a Dockerfile that already exists", async () => {
        // Someone's build is theirs. Clobbering it would be the one unrecoverable
        // thing this command could do.
        manifestWith("managed");
        fs.writeFileSync(path.join(scratch, "Dockerfile"), "FROM scratch # mine\n");

        await run();

        expect(fs.readFileSync(path.join(scratch, "Dockerfile"), "utf8")).toContain("# mine");
        expect(loadManifest(scratch).manifest.apps.backend).toMatchObject({ runtime: "custom" });
    });

    it("changes nothing under --dry-run", async () => {
        manifestWith("managed");

        await run("--dry-run");

        expect(fs.existsSync(path.join(scratch, "backend/src/index.ts"))).toBe(false);
        expect(fs.existsSync(path.join(scratch, "Dockerfile"))).toBe(false);
        expect(loadManifest(scratch).manifest.apps.backend).toMatchObject({ runtime: "managed" });
    });

    it("restores the backend scripts, so the image has something to start", async () => {
        manifestWith("managed");
        fs.writeFileSync(
            path.join(scratch, "backend", "package.json"),
            JSON.stringify({ name: "b",
scripts: { build: "tsc" } }, null, 4)
        );

        await run();

        const pkg = JSON.parse(fs.readFileSync(path.join(scratch, "backend", "package.json"), "utf8"));
        expect(pkg.main).toBe("src/index.ts");
        expect(pkg.scripts.start).toContain("node");
        // And it does not clobber a script that was already there.
        expect(pkg.scripts.build).toBe("tsc");
    });

    it("refuses a static app, which has no server to own", async () => {
        manifestWith("managed");

        await expect(run("admin")).rejects.toThrow(Exited);
        expect(exitCode).toBe(1);
    });

    it("refuses an app that is not declared", async () => {
        manifestWith("managed");

        await expect(run("nope")).rejects.toThrow(Exited);
        expect(exitCode).toBe(1);
    });
});
