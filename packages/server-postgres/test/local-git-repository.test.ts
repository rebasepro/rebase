/**
 * The local git repository, against real git.
 *
 * Mocking git here would test my idea of git. The behaviours that matter are
 * git's own — what `--only` stages, what a detached HEAD reports, what happens
 * when the generated content is byte-identical to what is already committed —
 * so every test runs against a real repository in a temporary directory.
 *
 * The one worth reading is "leaves unrelated work alone": a schema commit that
 * sweeps up somebody's half-finished edit is a commit nobody can review.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    createLocalGitRepository,
    isGitRepository,
    GitCommandError
} from "../src/schema/local-git-repository";

const AUTHOR = { name: "Panel", email: "panel@rebase.pro" };

function makeRepo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-git-"));
    const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    run("init", "-q");
    // `git init -b` needs git 2.28; `symbolic-ref` works on every version, and
    // this fixture should not depend on whichever git the runner happens to have.
    run("symbolic-ref", "HEAD", "refs/heads/main");
    run("config", "user.name", "Fixture");
    run("config", "user.email", "fixture@example.com");
    fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
    run("add", "README.md");
    run("commit", "-q", "-m", "initial");
    return root;
}

const show = (root: string, ...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

describe("isGitRepository", () => {
    let root: string;
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("recognises one", async () => {
        root = makeRepo();
        expect(await isGitRepository(root)).toBe(true);
    });

    it("says no for a plain directory, rather than throwing", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-plain-"));
        expect(await isGitRepository(root)).toBe(false);
    });
});

describe("createLocalGitRepository", () => {
    let root: string;
    beforeEach(() => { root = makeRepo(); });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const repo = () => createLocalGitRepository({ root, author: AUTHOR });

    it("reports the current branch", async () => {
        expect(await repo().currentBranch()).toBe("main");
    });

    it("refuses a detached HEAD instead of calling it a branch", async () => {
        const head = show(root, "rev-parse", "HEAD");
        execFileSync("git", ["checkout", "-q", head], { cwd: root, stdio: "pipe" });
        await expect(repo().currentBranch()).rejects.toThrow(GitCommandError);
        await expect(repo().currentBranch()).rejects.toThrow(/detached HEAD/);
    });

    it("lists dirty paths, tracked and untracked alike", async () => {
        fs.writeFileSync(path.join(root, "README.md"), "# changed\n");
        fs.writeFileSync(path.join(root, "new.txt"), "hello\n");

        const dirty = await repo().dirtyPaths();
        expect(dirty.sort()).toEqual(["README.md", "new.txt"]);
    });

    it("is empty on a clean tree", async () => {
        expect(await repo().dirtyPaths()).toEqual([]);
    });

    it("writes files, creating directories that do not exist", async () => {
        await repo().writeFiles([
            { path: "drizzle/schema.sql", contents: "CREATE TABLE x();" },
            { path: "backend/src/schema.generated.ts", contents: "export const x = 1;" }
        ]);

        expect(fs.readFileSync(path.join(root, "drizzle/schema.sql"), "utf8")).toBe("CREATE TABLE x();");
        expect(fs.existsSync(path.join(root, "backend/src/schema.generated.ts"))).toBe(true);
    });

    it("refuses to write outside the repository", async () => {
        await expect(repo().writeFiles([{ path: "../escaped.txt", contents: "no" }]))
            .rejects.toThrow(/outside the repository/);
    });

    it("commits exactly the paths it is given, and attributes the author", async () => {
        const r = repo();
        await r.writeFiles([{ path: "drizzle/schema.sql", contents: "CREATE TABLE x();" }]);
        const sha = await r.commit(["drizzle/schema.sql"], "feat(schema): add x");

        expect(sha).toMatch(/^[0-9a-f]{40}$/);
        expect(show(root, "log", "-1", "--pretty=%s")).toBe("feat(schema): add x");
        expect(show(root, "log", "-1", "--pretty=%an <%ae>")).toBe("Panel <panel@rebase.pro>");
        expect(show(root, "show", "--name-only", "--pretty=", "HEAD")).toBe("drizzle/schema.sql");
    });

    it("leaves unrelated work alone — the property that makes this safe to run", async () => {
        const r = repo();
        // Somebody is mid-edit on an unrelated file, both in the tree and staged.
        fs.writeFileSync(path.join(root, "README.md"), "# work in progress\n");
        execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "pipe" });

        await r.writeFiles([{ path: "drizzle/schema.sql", contents: "CREATE TABLE x();" }]);
        await r.commit(["drizzle/schema.sql"], "feat(schema): add x");

        // The commit contains only ours…
        expect(show(root, "show", "--name-only", "--pretty=", "HEAD")).toBe("drizzle/schema.sql");
        // …and their staged edit is still staged, not swallowed.
        expect(show(root, "diff", "--cached", "--name-only")).toBe("README.md");
    });

    it("returns the existing head when the content is byte-identical", async () => {
        const r = repo();
        await r.writeFiles([{ path: "drizzle/schema.sql", contents: "CREATE TABLE x();" }]);
        const first = await r.commit(["drizzle/schema.sql"], "feat(schema): add x");

        // Regenerating an unchanged schema stages nothing. That is a real
        // outcome, not an error.
        await r.writeFiles([{ path: "drizzle/schema.sql", contents: "CREATE TABLE x();" }]);
        const second = await r.commit(["drizzle/schema.sql"], "feat(schema): add x again");

        expect(second).toBe(first);
        expect(show(root, "rev-list", "--count", "HEAD")).toBe("2");
    });

    it("handles a path containing a space", async () => {
        const r = repo();
        await r.writeFiles([{ path: "drizzle/my schema.sql", contents: "SELECT 1;" }]);
        await r.commit(["drizzle/my schema.sql"], "feat(schema): spaced");

        expect(show(root, "show", "--name-only", "--pretty=", "HEAD")).toContain("my schema.sql");
        expect(await r.dirtyPaths()).toEqual([]);
    });

    it("refuses an empty path list rather than committing everything", async () => {
        await expect(repo().commit([], "nope")).rejects.toThrow(/empty path list/);
    });

    it("falls back to the repository's own identity when no author is given", async () => {
        const r = createLocalGitRepository({ root });
        await r.writeFiles([{ path: "a.txt", contents: "a" }]);
        await r.commit(["a.txt"], "chore: a");
        expect(show(root, "log", "-1", "--pretty=%an")).toBe("Fixture");
    });
});
