import { describe, it, expect } from "@jest/globals";
/**
 * Committing to a repository on GitHub, with no working tree.
 *
 * `fetch` is stubbed, so what is under test is the *protocol*: the order of the
 * Git Data calls, what each one is given, and the two decisions that make this
 * safe to run against somebody's repository.
 *
 * - **`base_tree`.** A tree built without it commits a repository containing
 *   only the files in the request. Everything else would appear deleted, in a
 *   commit that looks like a schema change.
 * - **`force: false`.** The commit is built against the head read at the start.
 *   If anything landed meanwhile the ref update is rejected, and a rejection is
 *   the correct outcome — forcing would silently discard somebody's commit.
 *
 * The JWT is checked for shape and for the backdated `iat`, which is the thing
 * that breaks in production on a clock a few seconds fast and nowhere else.
 */
import { generateKeyPairSync } from "node:crypto";
import { createGitHubRepository, createAppJwt, GitHubApiError } from "../src/schema-edit/github-repository";

const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
});

const NOW = 1_800_000_000_000;

/** Records every call and answers each Git Data endpoint plausibly. */
function stubGitHub(over: Record<string, unknown> = {}) {
    const calls: { path: string; method: string; body?: unknown }[] = [];

    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
        const path = url.replace("https://api.github.com", "");
        const body = init.body ? JSON.parse(init.body as string) : undefined;
        calls.push({ path, method: init.method ?? "GET", body });

        const fail = over[path] as { status: number; text: string } | undefined;
        if (fail) {
            return { ok: false, status: fail.status, text: async () => fail.text } as unknown as Response;
        }

        const json =
            path.includes("/access_tokens") ? { token: "ghs_installation", expires_at: new Date(NOW + 3_600_000).toISOString() }
            : path.includes("/git/ref/heads/") ? { object: { sha: "headsha" } }
            : path.includes("/git/commits/") ? { tree: { sha: "basetree" } }
            : path.endsWith("/git/blobs") ? { sha: `blob-${calls.length}` }
            : path.endsWith("/git/trees") ? { sha: "newtree" }
            : path.endsWith("/git/commits") ? { sha: "newcommit" }
            : {};

        return { ok: true, status: 200, json: async () => json, text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;

    return { fetchImpl, calls };
}

const makeRepo = (stub: ReturnType<typeof stubGitHub>, author = { name: "Panel", email: "p@r.pro" }) =>
    createGitHubRepository({
        appId: "4681389",
        privateKey,
        installationId: "99",
        owner: "rebasepro",
        repo: "customer-project",
        branch: "main",
        author,
        fetchImpl: stub.fetchImpl,
        now: () => NOW
    });

const FILES = [
    { path: "drizzle/schema.sql", contents: "CREATE TABLE posts ();" },
    { path: "backend/src/schema.generated.ts", contents: "export const s = 1;" }
];

describe("createAppJwt", () => {
    it("has three parts and an RS256 header", () => {
        const jwt = createAppJwt("4681389", privateKey, NOW);
        const [header, payload, signature] = jwt.split(".");
        expect(signature.length).toBeGreaterThan(0);

        const decode = (p: string) => JSON.parse(Buffer.from(p, "base64url").toString());
        expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
        expect(decode(payload).iss).toBe("4681389");
    });

    it("backdates iat, because GitHub rejects one in its own future", () => {
        const payload = JSON.parse(
            Buffer.from(createAppJwt("1", privateKey, NOW).split(".")[1], "base64url").toString()
        );
        expect(payload.iat).toBe(Math.floor(NOW / 1000) - 60);
    });

    it("expires inside GitHub's ten-minute ceiling", () => {
        const payload = JSON.parse(
            Buffer.from(createAppJwt("1", privateKey, NOW).split(".")[1], "base64url").toString()
        );
        expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
    });

    it("is base64url, not base64 — no +, / or padding", () => {
        expect(createAppJwt("1", privateKey, NOW)).not.toMatch(/[+/=]/);
    });
});

describe("committing", () => {
    it("walks the Git Data flow in order", async () => {
        const stub = stubGitHub();
        const repo = makeRepo(stub);

        await repo.writeFiles(FILES);
        const sha = await repo.commit(FILES.map(f => f.path), "feat(schema): add posts");

        expect(sha).toBe("newcommit");
        expect(stub.calls.map(c => `${c.method} ${c.path.replace("/repos/rebasepro/customer-project", "")}`))
            .toEqual([
                "POST /app/installations/99/access_tokens",
                "GET /git/ref/heads/main",
                "GET /git/commits/headsha",
                "POST /git/blobs",
                "POST /git/blobs",
                "POST /git/trees",
                "POST /git/commits",
                "PATCH /git/refs/heads/main"
            ]);
    });

    it("builds on base_tree, so the rest of the repository is not deleted", async () => {
        const stub = stubGitHub();
        const repo = makeRepo(stub);
        await repo.writeFiles(FILES);
        await repo.commit(FILES.map(f => f.path), "m");

        const tree = stub.calls.find(c => c.path.endsWith("/git/trees"))!.body as {
            base_tree: string; tree: { path: string; mode: string }[];
        };
        expect(tree.base_tree).toBe("basetree");
        expect(tree.tree.map(entry => entry.path).sort())
            .toEqual(["backend/src/schema.generated.ts", "drizzle/schema.sql"]);
        expect(tree.tree.every(entry => entry.mode === "100644")).toBe(true);
    });

    it("never forces the ref, so a lost race refuses instead of overwriting", async () => {
        const stub = stubGitHub();
        const repo = makeRepo(stub);
        await repo.writeFiles(FILES);
        await repo.commit(FILES.map(f => f.path), "m");

        const update = stub.calls.find(c => c.method === "PATCH")!.body as { sha: string; force: boolean };
        expect(update).toEqual({ sha: "newcommit", force: false });
    });

    it("parents the commit on the head it read, not on whatever is there now", async () => {
        const stub = stubGitHub();
        const repo = makeRepo(stub);
        await repo.writeFiles(FILES);
        await repo.commit(FILES.map(f => f.path), "m");

        const commit = stub.calls.find(c => c.path.endsWith("/git/commits") && c.method === "POST")!
            .body as { parents: string[]; tree: string; author?: { name: string } };
        expect(commit.parents).toEqual(["headsha"]);
        expect(commit.tree).toBe("newtree");
        expect(commit.author?.name).toBe("Panel");
    });

    it("omits the author when there is none, rather than inventing one", async () => {
        const stub = stubGitHub();
        // Built directly: `makeRepo` has a default author, and passing
        // `undefined` would take it rather than omit it.
        const repo = createGitHubRepository({
            appId: "4681389",
            privateKey,
            installationId: "99",
            owner: "rebasepro",
            repo: "customer-project",
            branch: "main",
            fetchImpl: stub.fetchImpl,
            now: () => NOW
        });
        await repo.writeFiles(FILES);
        await repo.commit(FILES.map(f => f.path), "m");

        const commit = stub.calls.find(c => c.path.endsWith("/git/commits") && c.method === "POST")!
            .body as { author?: unknown };
        expect(commit.author).toBeUndefined();
    });

    it("commits only the paths it is given, even when more were written", async () => {
        const stub = stubGitHub();
        const repo = makeRepo(stub);
        await repo.writeFiles(FILES);
        await repo.commit(["drizzle/schema.sql"], "m");

        const tree = stub.calls.find(c => c.path.endsWith("/git/trees"))!.body as { tree: { path: string }[] };
        expect(tree.tree.map(e => e.path)).toEqual(["drizzle/schema.sql"]);
    });

    it("refuses to commit when nothing was staged", async () => {
        await expect(makeRepo(stubGitHub()).commit(["a"], "m")).rejects.toThrow(/nothing staged/);
    });

    it("reuses the installation token across calls rather than minting one each time", async () => {
        const stub = stubGitHub();
        const repo = makeRepo(stub);
        await repo.writeFiles(FILES);
        await repo.commit(FILES.map(f => f.path), "one");
        await repo.writeFiles(FILES);
        await repo.commit(FILES.map(f => f.path), "two");

        expect(stub.calls.filter(c => c.path.includes("access_tokens"))).toHaveLength(1);
    });

    it("surfaces a rejected ref update as an error naming the status", async () => {
        const stub = stubGitHub({
            "/repos/rebasepro/customer-project/git/refs/heads/main": {
                status: 422, text: "Update is not a fast forward"
            }
        });
        const repo = makeRepo(stub);
        await repo.writeFiles(FILES);

        await expect(repo.commit(FILES.map(f => f.path), "m")).rejects.toThrow(GitHubApiError);
        await expect(repo.commit(FILES.map(f => f.path), "m")).rejects.toThrow(/422/);
    });
});

describe("the shape a working tree has and this does not", () => {
    it("reports the configured branch", async () => {
        expect(await makeRepo(stubGitHub()).currentBranch()).toBe("main");
    });

    it("has no dirty paths, because there is no working tree", async () => {
        expect(await makeRepo(stubGitHub()).dirtyPaths()).toEqual([]);
    });

    it("identifies itself as owner/repo", () => {
        expect(makeRepo(stubGitHub()).root).toBe("rebasepro/customer-project");
    });
});
