/**
 * The GitHub commit path, against a real repository.
 *
 * `github-repository.test.ts` drives this module against a stubbed `fetch`. It
 * proves the calls are shaped the way we believe GitHub wants them, and it
 * cannot prove GitHub agrees — a stub answers whatever it was told to answer,
 * including for a request the real API would reject.
 *
 * So this one makes the real calls: blob, tree, commit, ref update, and then
 * reads the repository back through a different endpoint to see whether the
 * commit is there. The assertion that most needs a real server is `base_tree`:
 * a tree built without it produces a commit containing *only* the files it
 * lists, silently deleting everything else in the repository. Against a stub
 * that is invisible, because the stub has no other files.
 *
 * ## Opt-in, and why it is not in CI
 *
 * It needs a token and a repository it is allowed to write to, and it leaves
 * commits behind. Set both to run it:
 *
 *     REBASE_GITHUB_E2E_TOKEN=<token with contents:write>
 *     REBASE_GITHUB_E2E_REPO=<owner>/<repo>
 *
 * Without them it skips, which is the honest outcome — a test that quietly
 * passes when it cannot reach the thing it tests is worse than one that says it
 * did not run.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { createGitHubRepository } from "../src/schema-edit/github-repository";

const token = process.env.REBASE_GITHUB_E2E_TOKEN;
const slug = process.env.REBASE_GITHUB_E2E_REPO;
const [owner, repo] = (slug ?? "/").split("/");
const configured = Boolean(token && owner && repo);

const FILES = [
    { path: "backend/src/collections/posts.ts", contents: "export const posts = { slug: 'posts' };\n" },
    { path: "drizzle/schema.sql", contents: "CREATE TABLE posts (id text primary key);\n" }
];

// `describe.skip` rather than an early return: a skipped suite is reported as
// skipped, and a suite that returned early is reported as passing.
const suite = configured ? describe : describe.skip;

suite("committing to a real repository on GitHub", () => {
    const api = async <T>(path: string): Promise<T> => {
        const response = await fetch(`https://api.github.com${path}`, {
            headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }
        });
        if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`);
        return await response.json() as T;
    };

    const repository = () => createGitHubRepository({
        auth: { kind: "token", token: token! },
        owner,
        repo,
        branch: "main",
        author: { name: "Live Schema Panel", email: "panel@rebase.pro" }
    });

    let headBefore: string;

    beforeAll(async () => {
        headBefore = (await api<{ object: { sha: string } }>(
            `/repos/${owner}/${repo}/git/ref/heads/main`
        )).object.sha;
    });

    it("creates a commit GitHub agrees is a commit", async () => {
        const subject = `feat(schema): add posts (${headBefore.slice(0, 7)})`;
        const git = repository();
        await git.writeFiles(FILES);
        const sha = await git.commit(FILES.map(f => f.path), `${subject}\n\nFrom the e2e.\n`);

        expect(sha).toMatch(/^[0-9a-f]{40}$/);

        const moved = await api<{ object: { sha: string } }>(
            `/repos/${owner}/${repo}/git/ref/heads/main`
        );
        expect(moved.object.sha).toBe(sha);

        const commit = await api<{
            commit: { message: string; author: { name: string } };
            parents: { sha: string }[];
            files: { filename: string }[];
        }>(`/repos/${owner}/${repo}/commits/${sha}`);

        expect(commit.commit.message).toContain(subject);
        // Attribution is the thing neither competitor gives you; an anonymous
        // commit is just a commit.
        expect(commit.commit.author.name).toBe("Live Schema Panel");
        expect(commit.parents[0].sha).toBe(headBefore);
        expect(commit.files.map(f => f.filename).sort())
            .toEqual(FILES.map(f => f.path).sort());
    }, 120_000);

    it("leaves the rest of the repository alone", async () => {
        // The `base_tree` assertion. Without it the commit would contain only
        // the files it writes and everything else would vanish — a data-loss
        // bug a stubbed fetch cannot see, because the stub has nothing to lose.
        const head = (await api<{ object: { sha: string } }>(
            `/repos/${owner}/${repo}/git/ref/heads/main`
        )).object.sha;
        const tree = await api<{ tree: { path: string }[] }>(
            `/repos/${owner}/${repo}/git/trees/${head}?recursive=1`
        );
        const paths = tree.tree.map(entry => entry.path);

        expect(paths).toContain("README.md");
        expect(paths).toContain("drizzle/schema.sql");
    }, 120_000);

    it("writes the contents it was given, byte for byte", async () => {
        const head = (await api<{ object: { sha: string } }>(
            `/repos/${owner}/${repo}/git/ref/heads/main`
        )).object.sha;
        const blob = await api<{ content: string }>(
            `/repos/${owner}/${repo}/contents/drizzle/schema.sql?ref=${head}`
        );
        expect(Buffer.from(blob.content, "base64").toString("utf8")).toBe(FILES[1].contents);
    }, 120_000);

    it("stacks a second commit on the first", async () => {
        const head = (await api<{ object: { sha: string } }>(
            `/repos/${owner}/${repo}/git/ref/heads/main`
        )).object.sha;

        const git = repository();
        await git.writeFiles([{ path: "drizzle/schema.sql", contents: "-- second\n" }]);
        const sha = await git.commit(["drizzle/schema.sql"], "feat(schema): second");

        const commit = await api<{ parents: { sha: string }[] }>(
            `/repos/${owner}/${repo}/commits/${sha}`
        );
        expect(commit.parents[0].sha).toBe(head);
    }, 120_000);

    it("refuses a branch that does not exist, with the status", async () => {
        // Not a silent no-op and not a created branch: the ref read fails, and
        // the refusal carries the status so a caller can tell "no such branch"
        // from "no permission".
        const git = createGitHubRepository({
            auth: { kind: "token", token: token! },
            owner,
            repo,
            branch: "a-branch-that-does-not-exist",
            author: { name: "Live Schema Panel", email: "panel@rebase.pro" }
        });
        await git.writeFiles([{ path: "x.txt", contents: "x" }]);
        await expect(git.commit(["x.txt"], "should not land")).rejects.toThrow(/404/);
    }, 120_000);
});
