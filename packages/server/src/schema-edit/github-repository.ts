/**
 * A {@link SchemaEditRepository} backed by a repository on GitHub.
 *
 * This is the implementation for a deployment whose source is not on the
 * machine — a Cloud tenant runs a built bundle, and its repository lives
 * somewhere else entirely. The local one commits with `git`; this one has no
 * working tree at all and uses the Git Data API, which creates a blob, a tree,
 * a commit and moves a ref in four calls. Nothing is cloned.
 *
 * ## Authentication
 *
 * A GitHub App, not a token per project. The app holds one private key
 * globally; each project stores an `installationId`, which is not a secret. A
 * per-project personal access token would mean a credential to hold, rotate and
 * leak for every customer.
 *
 * Three steps, and the middle one is the one people miss:
 *
 * 1. sign a JWT with the private key — RS256, `iss` the app's id, ten minutes
 *    at most, which authenticates *the app* and can touch no repository;
 * 2. exchange it for an **installation access token**, which expires in an hour
 *    and is what can actually write;
 * 3. use that token as the bearer for the Git Data calls.
 *
 * The token is cached until shortly before it expires, because minting one is a
 * round trip and a schema edit makes several calls.
 *
 * ## What `dirtyPaths` means without a working tree
 *
 * Nothing, directly — there is no tree to be dirty. The equivalent hazard is the
 * branch moving under us between reading its head and writing a commit onto it,
 * and that is handled where it belongs: the commit is created against the head
 * read at the start, and updating the ref is **not** forced, so GitHub rejects
 * it if anything else landed meanwhile. A lost race is a refusal, never a
 * silent overwrite of somebody's commit.
 */
import { createSign } from "node:crypto";
import type { SchemaChangeFile } from "@rebasepro/types";
import type { SchemaEditRepository } from "./apply-schema-change";

const GITHUB_API = "https://api.github.com";
/** GitHub caps app JWTs at ten minutes; nine leaves room for clock skew. */
const APP_JWT_TTL_SECONDS = 9 * 60;
/** Renew an installation token this long before it lapses. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * How to authenticate to GitHub.
 *
 * Two ways, because there are two deployments. A Cloud tenant is one of many
 * behind a single app, so it authenticates as an *installation* of that app and
 * holds no credential of its own. A self-hoster running a bundle has the same
 * problem — no source on the machine — and no app: standing one up so that a
 * server can commit to a repository they already own would be a great deal of
 * ceremony around a one-line credential.
 *
 * Both end in the same place. Everything past the bearer token is the plain Git
 * Data API and is identical for either, which is the point: the cloud is a
 * better implementation of this interface, never the only one.
 */
export type GitHubAuth =
    | {
        kind: "app";
        /** Numeric app id, or the client id — GitHub accepts either as `iss`. */
        appId: string;
        /**
         * The app's private key, PEM.
         *
         * Accepts the literal PEM, a PEM with escaped newlines, or base64 —
         * pass it through `normalizePemFromEnv` first, which is what the boot
         * path does.
         */
        privateKey: string;
        /** Which installation to act as. Produced when the app is installed. */
        installationId: string;
    }
    | {
        kind: "token";
        /**
         * A personal access token, or a fine-grained token with write access to
         * the repository's contents. Used as the bearer directly — there is
         * nothing to exchange and nothing to cache.
         */
        token: string;
    };

export interface GitHubRepositoryOptions {
    auth: GitHubAuth;
    owner: string;
    repo: string;
    /** Branch to commit onto. */
    branch: string;
    /** Attribution for the commit. */
    author?: { name: string; email: string };
    /** Injected for tests. Defaults to the global. */
    fetchImpl?: typeof fetch;
    /** Injected so token expiry is testable without waiting an hour. */
    now?: () => number;
}

export class GitHubApiError extends Error {
    constructor(readonly status: number, readonly path: string, detail: string) {
        super(`GitHub ${path} failed with ${status}: ${detail}`);
        this.name = "GitHubApiError";
    }
}

/** base64url, which JWT requires and `Buffer` does not produce by default. */
const b64url = (input: string | Buffer): string =>
    Buffer.from(input).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * A JWT authenticating the app itself.
 *
 * `iat` is backdated by a minute: GitHub rejects a token whose `iat` is in its
 * future, and a server clock a few seconds fast is enough to trigger it.
 */
export function createAppJwt(appId: string, privateKey: string, nowMs: number): string {
    const issued = Math.floor(nowMs / 1000) - 60;
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({
        iat: issued,
        exp: issued + APP_JWT_TTL_SECONDS,
        iss: appId
    }));

    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    signer.end();
    return `${header}.${payload}.${b64url(signer.sign(privateKey))}`;
}

export function createGitHubRepository(options: GitHubRepositoryOptions): SchemaEditRepository {
    const doFetch = options.fetchImpl ?? fetch;
    const now = options.now ?? (() => Date.now());
    const { owner, repo, branch } = options;

    /** Files staged by `writeFiles`, held until `commit`. */
    let staged: SchemaChangeFile[] = [];
    let token: { value: string; expiresAtMs: number } | undefined;

    const call = async <T>(path: string, init: RequestInit & { auth: string }): Promise<T> => {
        const { auth, ...rest } = init;
        const response = await doFetch(`${GITHUB_API}${path}`, {
            ...rest,
            headers: {
                accept: "application/vnd.github+json",
                "x-github-api-version": "2022-11-28",
                authorization: `Bearer ${auth}`,
                "content-type": "application/json",
                ...(rest.headers ?? {})
            }
        });
        if (!response.ok) {
            throw new GitHubApiError(response.status, path, (await response.text()).slice(0, 400));
        }
        return await response.json() as T;
    };

    /**
     * The bearer for the Git Data calls.
     *
     * A token is already one. An app has to mint one: sign a JWT with the
     * private key, which authenticates the *app* and can touch no repository,
     * then exchange it for an installation token, which expires in an hour and
     * is what can actually write. Cached until shortly before it lapses,
     * because a schema edit makes several calls and minting is a round trip.
     */
    const bearer = async (): Promise<string> => {
        if (options.auth.kind === "token") return options.auth.token;
        if (token && token.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > now()) return token.value;

        const jwt = createAppJwt(options.auth.appId, options.auth.privateKey, now());
        const minted = await call<{ token: string; expires_at: string }>(
            `/app/installations/${options.auth.installationId}/access_tokens`,
            { method: "POST", auth: jwt }
        );
        token = { value: minted.token, expiresAtMs: Date.parse(minted.expires_at) };
        return token.value;
    };

    return {
        root: `${owner}/${repo}`,

        async currentBranch(): Promise<string> {
            return branch;
        },

        async dirtyPaths(): Promise<string[]> {
            // A remote repository has no working tree, so nothing can be dirty
            // in the sense the local implementation means. The equivalent race —
            // the branch moving under us — is refused at the ref update instead,
            // which is where it can actually be detected.
            return [];
        },

        async writeFiles(files: SchemaChangeFile[]): Promise<void> {
            staged = files;
        },

        async commit(paths: string[], message: string): Promise<string> {
            if (staged.length === 0) throw new Error("Refusing to commit with nothing staged.");

            const auth = await bearer();
            const base = `/repos/${owner}/${repo}`;

            // Read first, and commit against exactly this. Anything that lands
            // between here and the ref update makes the update fail rather than
            // overwrite.
            const ref = await call<{ object: { sha: string } }>(
                `${base}/git/ref/heads/${encodeURIComponent(branch)}`, { auth }
            );
            const headSha = ref.object.sha;
            const head = await call<{ tree: { sha: string } }>(
                `${base}/git/commits/${headSha}`, { auth }
            );

            // Blobs, then one tree entry each. `base_tree` means unlisted paths
            // are inherited rather than deleted — a tree built without it would
            // commit a repository containing only these files.
            const tree = await Promise.all(staged
                .filter(file => paths.includes(file.path))
                .map(async file => {
                    const blob = await call<{ sha: string }>(`${base}/git/blobs`, {
                        method: "POST",
                        auth,
                        body: JSON.stringify({ content: file.contents, encoding: "utf-8" })
                    });
                    return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
                }));

            const created = await call<{ sha: string }>(`${base}/git/trees`, {
                method: "POST",
                auth,
                body: JSON.stringify({ base_tree: head.tree.sha, tree })
            });

            const commit = await call<{ sha: string }>(`${base}/git/commits`, {
                method: "POST",
                auth,
                body: JSON.stringify({
                    message,
                    tree: created.sha,
                    parents: [headSha],
                    ...(options.author ? {
                        author: { ...options.author, date: new Date(now()).toISOString() }
                    } : {})
                })
            });

            await call(`${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
                method: "PATCH",
                auth,
                // Never `force: true`. A rejected update means somebody else
                // committed while this was being built, and losing that commit
                // silently is worse than failing.
                body: JSON.stringify({ sha: commit.sha, force: false })
            });

            staged = [];
            return commit.sha;
        }
    };
}
