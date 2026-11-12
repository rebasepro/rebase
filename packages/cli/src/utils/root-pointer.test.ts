/**
 * The rules a project below its repository's root leaves at that root.
 *
 * The shape these tests build is the one that went wrong: a repository holding
 * a site, with the Rebase project in `cloud/`, and an assistant started at the
 * repository root that never loaded anything in `cloud/`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import {
    ROOT_POINTER_END,
    ROOT_POINTER_START,
    enclosingRepositoryRoot,
    rootPointerBlock,
    scaffoldRules,
    withRootPointer,
    writeRootPointers
} from "./root-pointer";

const TEMPLATE = path.resolve(__dirname, "..", "..", "templates", "template");

function gitInit(dir: string): void {
    execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
}

/** The files a run changed, by name. */
function changedNames(projectDir: string): string[] {
    return writeRootPointers(projectDir, TEMPLATE).changed.map(f => path.basename(f)).sort();
}

describe("root pointer", () => {
    let repo: string;
    let project: string;

    beforeEach(() => {
        // TEST_ENV turns the writer off for every other suite.
        vi.stubEnv("REBASE_ROOT_RULES", "1");
        repo = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-root-pointer-"));
        gitInit(repo);
        project = path.join(repo, "cloud");
        fs.mkdirSync(project);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it("writes nothing with REBASE_ROOT_RULES off, in any spelling", () => {
        for (const off of ["0", "false", "off"]) {
            vi.stubEnv("REBASE_ROOT_RULES", off);
            expect(changedNames(project)).toEqual([]);
        }
        expect(fs.existsSync(path.join(repo, "CLAUDE.md"))).toBe(false);
    });

    it("finds the repository above a project, and not the project itself", () => {
        expect(enclosingRepositoryRoot(project)).toBe(repo);
        expect(enclosingRepositoryRoot(repo)).toBe(enclosingRepositoryRoot(path.dirname(repo)));
    });

    it("writes the scaffold's rules into the root's CLAUDE.md and AGENTS.md", () => {
        expect(changedNames(project)).toEqual(["AGENTS.md", "CLAUDE.md"]);
        const claude = fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
        expect(claude).toContain("`cloud/` is a Rebase project");
        expect(claude).toContain("`cloud/ai-instructions.md`");
        expect(claude).toContain("### Before you write any code in `cloud/`");
        expect(claude).toContain("**A table is a file in `backend/schema/`.**");
        expect(claude).toContain(scaffoldRules(TEMPLATE).split("\n").at(-1));
        expect(claude).toContain("edits between these markers are overwritten");
    });

    it("keeps what a root file already says, and writes nothing on a second run", () => {
        fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# My site\n\nUse tabs.\n");
        writeRootPointers(project, TEMPLATE);
        const once = fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
        expect(once.startsWith("# My site\n\nUse tabs.\n\n" + ROOT_POINTER_START)).toBe(true);
        expect(changedNames(project)).toEqual([]);
        expect(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8")).toBe(once);
    });

    it("replaces an older block between its markers", () => {
        const old = `# Site\n\n${ROOT_POINTER_START}\nold rules\n${ROOT_POINTER_END}\n\nMore notes.\n`;
        const next = withRootPointer(old, `${ROOT_POINTER_START}\nnew rules\n${ROOT_POINTER_END}`);
        expect(next).toBe(`# Site\n\n${ROOT_POINTER_START}\nnew rules\n${ROOT_POINTER_END}\n\nMore notes.\n`);
    });

    it("leaves a file alone when its markers are a lone start, a lone end or out of order", () => {
        const block = `${ROOT_POINTER_START}\nnew rules\n${ROOT_POINTER_END}`;
        const loneStart = `# Site\n\n${ROOT_POINTER_START}\nold rules\n\nMy own notes.\n`;
        const loneEnd = `# Site\n\nold rules\n${ROOT_POINTER_END}\n\nMy own notes.\n`;
        const reversed = `# Site\n${ROOT_POINTER_END}\nMy own notes.\n${ROOT_POINTER_START}\n`;
        const twice = `${block}\n\nMine.\n\n${block}\n`;
        for (const text of [loneStart, loneEnd, reversed, twice]) {
            expect(withRootPointer(text, block)).toBeNull();
        }

        fs.writeFileSync(path.join(repo, "CLAUDE.md"), loneStart);
        const result = writeRootPointers(project, TEMPLATE);
        expect(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8")).toBe(loneStart);
        expect(result.untouched.map(u => path.basename(u.file))).toEqual(["CLAUDE.md"]);
        expect(result.changed.map(f => path.basename(f))).toEqual(["AGENTS.md"]);
    });

    it("writes a CRLF file's block with CRLF, and a second run changes nothing", () => {
        fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# My site\r\n\r\nUse tabs.\r\n");
        writeRootPointers(project, TEMPLATE);
        const once = fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
        expect(once.startsWith("# My site\r\n\r\nUse tabs.\r\n\r\n" + ROOT_POINTER_START + "\r\n")).toBe(true);
        expect(once.replace(/\r\n/g, "")).not.toContain("\n");
        expect(changedNames(project)).toEqual([]);
        expect(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8")).toBe(once);

        // A CRLF file holding an LF block (an older run) gets it back in CRLF.
        const lf = rootPointerBlock("cloud", scaffoldRules(TEMPLATE));
        expect(withRootPointer(`# Site\r\n\r\n${lf}\r\n`, lf)).toBe(`# Site\r\n\r\n${lf.replace(/\n/g, "\r\n")}\r\n`);
    });

    it("writes nothing at the home directory, or above it", () => {
        // A dotfiles repository at ~, and `rebase init ~/code/app` before the
        // app has a repository of its own.
        const app = path.join(repo, "code", "app");
        fs.mkdirSync(app, { recursive: true });
        vi.spyOn(os, "homedir").mockReturnValue(repo);
        const atHome = writeRootPointers(app, TEMPLATE);
        expect(atHome.changed).toEqual([]);
        expect(atHome.refused).toContain("home directory");
        vi.spyOn(os, "homedir").mockReturnValue(path.join(repo, "users", "me"));
        expect(writeRootPointers(app, TEMPLATE).changed).toEqual([]);
        expect(fs.existsSync(path.join(repo, "CLAUDE.md"))).toBe(false);
        expect(fs.existsSync(path.join(repo, "AGENTS.md"))).toBe(false);
    });

    it("writes nothing where the repository ignores the project", () => {
        fs.writeFileSync(path.join(repo, ".gitignore"), "cloud/\n");
        const result = writeRootPointers(project, TEMPLATE);
        expect(result.changed).toEqual([]);
        expect(result.refused).toContain("ignores cloud/");
        // A dotfiles repository's `*`, with the project in a folder below it.
        fs.writeFileSync(path.join(repo, ".gitignore"), "*\n!.gitignore\n");
        const deeper = path.join(repo, "code", "app");
        fs.mkdirSync(deeper, { recursive: true });
        expect(writeRootPointers(deeper, TEMPLATE).changed).toEqual([]);
        expect(fs.existsSync(path.join(repo, "CLAUDE.md"))).toBe(false);
    });

    it("does nothing outside a repository, and a nested repository still gets it at the outer root", () => {
        gitInit(project);
        const lone = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-root-pointer-lone-"));
        try {
            expect(writeRootPointers(lone, TEMPLATE).changed).toEqual([]);
        } finally {
            fs.rmSync(lone, { recursive: true, force: true });
        }
        // `cloud/` with its own repository is still below `repo`, which has one
        // too and does not ignore it, so the block goes to `repo`: an assistant
        // opened there still misses it.
        expect(changedNames(project)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    });
});
