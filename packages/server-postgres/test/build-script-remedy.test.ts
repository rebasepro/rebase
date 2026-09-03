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
    detectProjectPackageManager,
    describeBuildScriptRemedy,
    describeDevAddCommand
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
