/**
 * The advice printed when `@ariga/atlas` is installed but its binary is not.
 *
 * This existed for a while as a pnpm-only message. Then npm 12 began blocking a
 * dependency's install scripts by default, the way pnpm 10 does, and every npm
 * reader who ran `rebase db push` was handed `pnpm approve-builds` and a
 * `"pnpm"` package.json key — correct advice, addressed to somebody else. The
 * failure mode is the one this codebase keeps finding: a remedy that is right
 * about the cause and unfollowable on the path the reader is actually on.
 *
 * So the two things worth pinning are that the manager is read off the project
 * rather than assumed, and that each branch names a command that manager has.
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
    declaredBinaries,
    detectProjectPackageManager,
    describeBuildScriptRemedy,
    describeDevAddCommand,
    describeReinstallCommand,
    diagnoseMissingBin
} from "../src/cli-helpers";

describe("detectProjectPackageManager", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-pm-detect-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it.each([
        ["pnpm-lock.yaml", "pnpm"],
        ["package-lock.json", "npm"],
        ["yarn.lock", "yarn"],
        ["bun.lock", "bun"],
        ["bun.lockb", "bun"]
    ])("reads %s as %s", (lockfile, expected) => {
        fs.writeFileSync(path.join(root, lockfile), "");
        expect(detectProjectPackageManager(root)).toBe(expected);
    });

    it("walks up to the workspace root", () => {
        // Every `db` command runs from `backend/`, and the lockfile is a level
        // up. Detecting from the cwd alone would report "unknown" for every
        // scaffolded project — i.e. always fall through to the pnpm default.
        fs.writeFileSync(path.join(root, "package-lock.json"), "");
        const backend = path.join(root, "backend");
        fs.mkdirSync(backend);
        expect(detectProjectPackageManager(backend)).toBe("npm");
    });

    it("reports unknown rather than guessing when there is no lockfile", () => {
        expect(detectProjectPackageManager(root)).toBe("unknown");
    });

    it("prefers pnpm's lockfile when two are present", () => {
        // A project that used npm once and pnpm since has both on disk. Order
        // matters more than correctness here — what must not happen is the
        // answer changing between runs.
        fs.writeFileSync(path.join(root, "package-lock.json"), "");
        fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
        expect(detectProjectPackageManager(root)).toBe("pnpm");
    });
});

describe("describeBuildScriptRemedy", () => {
    it("gives npm readers npm's approval command and package.json key", () => {
        const lines = describeBuildScriptRemedy("@ariga/atlas", "npm").join("\n");
        expect(lines).toContain("npm install-scripts approve @ariga/atlas");
        expect(lines).toContain("\"allowScripts\": { \"@ariga/atlas\": true }");
        expect(lines).toContain("npm install");
        // The bug this test exists for: pnpm's advice reaching an npm reader.
        expect(lines).not.toContain("pnpm");
    });

    it("gives pnpm readers pnpm's", () => {
        const lines = describeBuildScriptRemedy("@ariga/atlas", "pnpm").join("\n");
        expect(lines).toContain("pnpm approve-builds");
        expect(lines).toContain("onlyBuiltDependencies");
        expect(lines).not.toContain("npm install-scripts");
    });

    it("covers yarn and bun with their own mechanisms", () => {
        expect(describeBuildScriptRemedy("@ariga/atlas", "yarn").join("\n")).toContain("enableScripts: true");
        expect(describeBuildScriptRemedy("@ariga/atlas", "bun").join("\n")).toContain("trustedDependencies");
    });

    it("falls back to pnpm when the project cannot be identified", () => {
        // Not neutral on purpose: pnpm is what `rebase init` scaffolds and what
        // the docs use, so it is the likeliest reader. An "unknown" that
        // printed nothing would leave the worst state of all — a diagnosis with
        // no remedy under it.
        expect(describeBuildScriptRemedy("@ariga/atlas", "unknown").join("\n")).toContain("pnpm approve-builds");
    });
});

describe("describeDevAddCommand", () => {
    it("names each manager's own add command", () => {
        expect(describeDevAddCommand("@ariga/atlas", "npm")).toBe("npm install -D @ariga/atlas");
        expect(describeDevAddCommand("@ariga/atlas", "pnpm")).toBe("pnpm add -D @ariga/atlas");
        expect(describeDevAddCommand("@ariga/atlas", "yarn")).toBe("yarn add -D @ariga/atlas");
        expect(describeDevAddCommand("@ariga/atlas", "bun")).toBe("bun add -d @ariga/atlas");
    });
});

describe("describeReinstallCommand", () => {
    it("names each manager's own way of re-resolving a tree", () => {
        expect(describeReinstallCommand("pnpm")).toBe("pnpm install --force");
        expect(describeReinstallCommand("npm")).toBe("rm -rf node_modules && npm install");
        expect(describeReinstallCommand("yarn")).toBe("yarn install --force");
        expect(describeReinstallCommand("bun")).toBe("rm -rf node_modules && bun install");
    });
});

describe("declaredBinaries", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bins-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function manifest(contents: object): string {
        const file = path.join(root, "package.json");
        fs.writeFileSync(file, JSON.stringify(contents));
        return file;
    }

    it("reads the map form, which is what @ariga/atlas uses", () => {
        const file = manifest({ name: "x", bin: { atlas: "./bin/atlas", other: "./bin/other" } });
        expect(declaredBinaries(file)).toEqual([
            path.join(root, "bin/atlas"),
            path.join(root, "bin/other")
        ]);
    });

    it("reads the string form", () => {
        expect(declaredBinaries(manifest({ name: "x", bin: "./cli.js" })))
            .toEqual([path.join(root, "cli.js")]);
    });

    it("returns nothing for a package that declares no binary", () => {
        expect(declaredBinaries(manifest({ name: "x" }))).toEqual([]);
    });

    it("returns nothing rather than throwing on an unreadable manifest", () => {
        const file = path.join(root, "package.json");
        fs.writeFileSync(file, "{ not json");
        expect(declaredBinaries(file)).toEqual([]);
    });
});

/**
 * The three states, and the one that used to be misreported.
 *
 * "Installed" was the whole verdict, so a tree whose binary exists and whose
 * `node_modules/.bin` shim does not was told its build scripts were blocked —
 * sending the reader to `approve-builds`, which does nothing, because nothing
 * is blocked.
 */
describe("diagnoseMissingBin", () => {
    let root: string;
    let previousCwd: string;

    /** A package name nothing in this repository can resolve. */
    const PKG = "rebase-diagnose-fixture";

    beforeEach(() => {
        previousCwd = process.cwd();
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-diagnose-")));
        fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "consumer" }));
        process.chdir(root);
    });

    afterEach(() => {
        process.chdir(previousCwd);
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Install the fixture package, optionally with its binary on disk. */
    function install({ binary }: { binary: boolean }): void {
        const dir = path.join(root, "node_modules", PKG);
        fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name: PKG, version: "1.0.0", bin: { fixture: "./bin/fixture" } })
        );
        if (binary) fs.writeFileSync(path.join(dir, "bin", "fixture"), "#!/bin/sh\n");
    }

    it("reports not-installed when the package is absent", () => {
        expect(diagnoseMissingBin(PKG)).toBe("not-installed");
    });

    it("reports build-script-blocked when the package is there and its binary is not", () => {
        install({ binary: false });
        expect(diagnoseMissingBin(PKG)).toBe("build-script-blocked");
    });

    it("reports bin-link-missing when the binary is on disk and only the .bin link is gone", () => {
        install({ binary: true });
        expect(diagnoseMissingBin(PKG)).toBe("bin-link-missing");
    });
});
