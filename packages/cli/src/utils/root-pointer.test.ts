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
import {
    ROOT_POINTER_END,
    ROOT_POINTER_START,
    enclosingRepositoryRoot,
    scaffoldRules,
    withRootPointer,
    writeRootPointers
} from "./root-pointer";

const TEMPLATE = path.resolve(__dirname, "..", "..", "templates", "template");

describe("root pointer", () => {
    let repo: string;
    let project: string;

    beforeEach(() => {
        // TEST_ENV turns the writer off for every other suite.
        vi.stubEnv("REBASE_ROOT_RULES", "1");
        repo = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-root-pointer-"));
        fs.mkdirSync(path.join(repo, ".git"));
        project = path.join(repo, "cloud");
        fs.mkdirSync(project);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it("writes nothing with REBASE_ROOT_RULES=0", () => {
        vi.stubEnv("REBASE_ROOT_RULES", "0");
        expect(writeRootPointers(project, TEMPLATE)).toEqual([]);
        expect(fs.existsSync(path.join(repo, "CLAUDE.md"))).toBe(false);
    });

    it("finds the repository above a project, and not the project itself", () => {
        expect(enclosingRepositoryRoot(project)).toBe(repo);
        expect(enclosingRepositoryRoot(repo)).toBe(enclosingRepositoryRoot(path.dirname(repo)));
    });

    it("writes the scaffold's rules into the root's CLAUDE.md and AGENTS.md", () => {
        const changed = writeRootPointers(project, TEMPLATE);
        expect(changed.map(f => path.basename(f)).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
        const claude = fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
        expect(claude).toContain("`cloud/` is a Rebase project");
        expect(claude).toContain("`cloud/ai-instructions.md`");
        expect(claude).toContain("### Before you write any code in `cloud/`");
        expect(claude).toContain("**A table is a collection.**");
        expect(claude).toContain(scaffoldRules(TEMPLATE).split("\n").at(-1));
    });

    it("keeps what a root file already says, and writes nothing on a second run", () => {
        fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# My site\n\nUse tabs.\n");
        writeRootPointers(project, TEMPLATE);
        const once = fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
        expect(once.startsWith("# My site\n\nUse tabs.\n\n" + ROOT_POINTER_START)).toBe(true);
        expect(writeRootPointers(project, TEMPLATE)).toEqual([]);
        expect(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8")).toBe(once);
    });

    it("replaces an older block between its markers", () => {
        const old = `# Site\n\n${ROOT_POINTER_START}\nold rules\n${ROOT_POINTER_END}\n\nMore notes.\n`;
        const next = withRootPointer(old, `${ROOT_POINTER_START}\nnew rules\n${ROOT_POINTER_END}`);
        expect(next).toBe(`# Site\n\n${ROOT_POINTER_START}\nnew rules\n${ROOT_POINTER_END}\n\nMore notes.\n`);
    });

    it("does nothing outside a repository, and a nested repository still gets it at the outer root", () => {
        fs.mkdirSync(path.join(project, ".git"));
        const lone = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-root-pointer-lone-"));
        try {
            expect(writeRootPointers(lone, TEMPLATE)).toEqual([]);
        } finally {
            fs.rmSync(lone, { recursive: true, force: true });
        }
        // `cloud/` with its own .git is still below `repo`, which has one too,
        // so the block goes to `repo`: an assistant opened there still misses it.
        expect(writeRootPointers(project, TEMPLATE).length).toBe(2);
    });
});
