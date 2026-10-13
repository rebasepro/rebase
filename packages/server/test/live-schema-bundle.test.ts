import { describe, expect, it, afterEach, beforeEach, jest } from "@jest/globals";
import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";

/**
 * Live schema editing from a built bundle, opted into with a repository.
 *
 * A bundle boots with `schemaEditor: false` and `NODE_ENV=production`, and its
 * `collectionsDir` holds compiled output. Live editing used to need the
 * source-only editor to be on (`writeSource` was built from it), so a bundle
 * answered `SCHEMA_EDITOR_DISABLED` — naming a setting its operator never
 * wrote — even with `liveSchema.repository` configured. With a repository, the
 * write path is its own: fetch the collection files, rewrite them, commit them.
 *
 * Without one, nothing changes: the same refusal, and the source-only editor
 * stays off either way.
 */

const JWT_SECRET = "live-schema-bundle-test-secret-1234567890";

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

const executed: string[] = [];

function planningBootstrapper(): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return {
                driver: {
                    fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
                    fetchEntity: async () => undefined,
                    saveEntity: async () => ({}),
                    deleteEntity: async () => undefined,
                    countCollection: async () => 0,
                    checkUniqueField: async () => true,
                    healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
                    admin: {
                        planSchemaChange: async () => ({
                            files: [{ path: "config/schema.generated.ts", contents: "export const tables = {};\n" }],
                            statements: ['ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "author_id" UUID;'],
                            classified: { changes: [], verdict: "safe", applicable: true },
                            message: "feat(schema): link posts to authors\n"
                        }),
                        executeSql: async (sql: string) => { executed.push(sql); return { rows: [] }; }
                    }
                },
                collections: undefined,
                internals: {}
            } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            const authRepository = {
                getUserRoleIds: async (uid: string) => (uid === "admin-1" ? ["admin"] : uid === "editor-1" ? ["editor"] : []),
                getTokensValidAfter: async () => undefined
            };
            return { userService: authRepository, authRepository };
        }
    } as unknown as BackendBootstrapper;
}

const REPOSITORY = {
    kind: "github" as const,
    owner: "acme",
    repo: "shop",
    auth: { kind: "token" as const, token: "github_pat_test" }
};

let compiledDir: string;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    // What a bundle's `collectionsDir` is: compiled output, no source.
    process.env.NODE_ENV = "production";
    executed.length = 0;
    compiledDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-schema-bundle-"));
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    fs.rmSync(compiledDir, { recursive: true, force: true });
    jest.restoreAllMocks();
});

const BOOTS_A_BACKEND = 30_000;

/** Booted the way `boot.ts` boots a bundle. */
async function bootBundle(config: Record<string, unknown> = {}): Promise<Hono> {
    const app = new Hono();
    await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("posts"), collection("authors"), collection("tags")],
        collectionsDir: compiledDir,
        schemaEditor: false,
        cronPersistence: false,
        auth: { jwtSecret: JWT_SECRET },
        bootstrappers: [planningBootstrapper()],
        ...config
    } as never);
    return app;
}

const bearer = async (uid = "admin-1", roles = ["admin"]) =>
    ({ authorization: `Bearer ${await generateAccessToken(uid, roles)}` });

async function getJson(app: Hono, url: string, uid?: string, roles?: string[]) {
    const res = await app.request(url, { headers: await bearer(uid, roles) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

const fileOf = (slug: string, extra = "", imports = "") => [
    "import { defineCollection } from \"@rebasepro/cms-types\";",
    imports,
    `const ${slug}Collection = defineCollection({`,
    `    name: "${slug}",`,
    `    slug: "${slug}",`,
    `    table: "${slug}",`,
    "    properties: {",
    `        name: { name: "Name", type: "string" }${extra}`,
    "    }",
    "});",
    "",
    `export default ${slug}Collection;`,
    ""
].join("\n");

const REMOTE: Record<string, string> = {
    "config/collections/posts.ts": fileOf("posts"),
    "config/collections/authors.ts": fileOf("authors"),
    "config/collections/tags.ts": fileOf("tags"),
    "config/collections/index.ts": [
        "import postsCollection from \"./posts\";",
        "import authorsCollection from \"./authors\";",
        "import tagsCollection from \"./tags\";",
        "",
        "export const collections = [postsCollection, authorsCollection, tagsCollection];",
        ""
    ].join("\n")
};

/** GitHub, as far as a schema commit reaches it. */
function fakeGitHub() {
    const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
    const blobs = new Map<string, string>();
    jest.spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(String(input));
        expect(url.host).toBe("api.github.com");
        const method = init.method ?? "GET";
        const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        calls.push({ method, path: url.pathname + url.search, body });
        const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

        const base = "/repos/acme/shop";
        if (url.pathname === `${base}/git/trees/main` && method === "GET") {
            return json({ tree: Object.keys(REMOTE).map(p => ({ path: p, type: "blob" })), truncated: false });
        }
        if (url.pathname.startsWith(`${base}/contents/`)) {
            const file = REMOTE[decodeURIComponent(url.pathname.slice(`${base}/contents/`.length))];
            return file === undefined
                ? json({ message: "Not Found" }, 404)
                : json({ content: Buffer.from(file).toString("base64"), encoding: "base64" });
        }
        if (url.pathname === `${base}/git/ref/heads/main`) return json({ object: { sha: "head" } });
        if (url.pathname === `${base}/git/commits/head`) return json({ tree: { sha: "basetree" } });
        if (url.pathname === `${base}/git/blobs`) {
            const sha = `blob-${blobs.size}`;
            blobs.set(sha, String(body?.content));
            return json({ sha });
        }
        if (url.pathname === `${base}/git/trees` && method === "POST") return json({ sha: "newtree" });
        if (url.pathname === `${base}/git/commits` && method === "POST") return json({ sha: "newcommit" });
        if (url.pathname === `${base}/git/refs/heads/main` && method === "PATCH") return json({});
        return json({ message: `unexpected ${method} ${url.pathname}` }, 500);
    }) as typeof fetch);

    /** The committed tree, path → contents (`null` for a deletion). */
    const committed = () => {
        const tree = calls.find(c => c.method === "POST" && c.path.endsWith("/git/trees"))?.body?.tree as
            { path: string; sha: string | null }[] | undefined;
        return Object.fromEntries((tree ?? []).map(entry => [entry.path, entry.sha ? blobs.get(entry.sha) : null]));
    };
    return { calls, committed };
}

async function apply(app: Hono, body: unknown, uid?: string, roles?: string[]) {
    const res = await app.request("/api/admin/schema/apply", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await bearer(uid, roles)) },
        body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("a bundle that does not opt in", () => {
    it("is unchanged: live editing refused, the source-only editor off", async () => {
        const app = await bootBundle();
        const live = await getJson(app, "/api/admin/schema/status");
        expect(live.body).toMatchObject({ enabled: false, code: "SCHEMA_EDITOR_DISABLED" });
        expect((await getJson(app, "/api/admin/schema-editor/status")).body)
            .toMatchObject({ enabled: false, code: "SCHEMA_EDITOR_DISABLED" });
    }, BOOTS_A_BACKEND);
});

describe("a bundle with liveSchema.repository", () => {
    it("is enabled under NODE_ENV=production and names where the commit goes", async () => {
        const app = await bootBundle({ liveSchema: { repository: REPOSITORY } });
        const live = await getJson(app, "/api/admin/schema/status");
        expect(live.status).toBe(200);
        expect(live.body).toMatchObject({
            enabled: true,
            canApply: true,
            repository: "acme/shop",
            branch: "main"
        });
    }, BOOTS_A_BACKEND);

    it("keeps the source-only editor off: there is still no source on this machine to write", async () => {
        const app = await bootBundle({ liveSchema: { repository: REPOSITORY } });
        expect((await getJson(app, "/api/admin/schema-editor/status")).body)
            .toMatchObject({ enabled: false, code: "SCHEMA_EDITOR_DISABLED" });
        const res = await app.request("/api/admin/schema-editor/collection/save", {
            method: "POST",
            headers: { "content-type": "application/json", ...(await bearer()) },
            body: JSON.stringify({ collectionId: "posts", collectionData: { name: "x" } })
        });
        expect(res.status).toBe(501);
    }, BOOTS_A_BACKEND);

    it("stays admin-only: a signed-in non-admin gets no answer", async () => {
        const app = await bootBundle({ liveSchema: { repository: REPOSITORY } });
        expect((await getJson(app, "/api/admin/schema/status", "editor-1", ["editor"])).status).toBe(403);
        const res = await app.request("/api/admin/schema/status");
        expect(res.status).toBe(401);
    }, BOOTS_A_BACKEND);

    it("commits a relation to another collection, importing the target's file", async () => {
        const github = fakeGitHub();
        const app = await bootBundle({ liveSchema: { repository: REPOSITORY } });

        const result = await apply(app, {
            collectionId: "posts",
            patch: [{
                op: "set",
                path: ["properties", "author"],
                value: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: "authors" } }
            }]
        });

        expect(result.status).toBe(200);
        const tree = github.committed();
        expect(Object.keys(tree).sort()).toEqual(["config/collections/posts.ts", "config/schema.generated.ts"]);
        expect(tree["config/collections/posts.ts"]).toContain("import authorsCollection from \"./authors.js\";");
        expect(tree["config/collections/posts.ts"]).toContain("target: () => authorsCollection");
        // The DDL ran here (boot runs its own SQL through the same admin too).
        expect(executed).toContain('ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "author_id" UUID;');
        // Never forced: a commit that landed meanwhile fails this one.
        expect(github.calls.find(c => c.method === "PATCH")?.body).toMatchObject({ force: false });
    }, BOOTS_A_BACKEND);

    it("deletes a collection, taking it out of index.ts in the same commit", async () => {
        const github = fakeGitHub();
        const app = await bootBundle({ liveSchema: { repository: REPOSITORY } });

        const result = await apply(app, { collectionId: "tags", remove: true });

        expect(result.status).toBe(200);
        const tree = github.committed();
        expect(tree["config/collections/tags.ts"]).toBeNull();
        expect(tree["config/collections/index.ts"]).toContain("postsCollection, authorsCollection]");
        expect(tree["config/collections/index.ts"]).not.toMatch(/tags/i);
    }, BOOTS_A_BACKEND);

    it("refuses a second change until the first is deployed, committing nothing", async () => {
        // The generated schema files in a commit are built from the
        // collections this deployment runs. Until the first commit is
        // deployed those leave its change out, so a second commit would
        // put back generated files without it.
        const github = fakeGitHub();
        const app = await bootBundle({ liveSchema: { repository: REPOSITORY } });
        const change = {
            collectionId: "posts",
            patch: [{ op: "set", path: ["properties", "subtitle"], value: { name: "Subtitle", type: "string" } }]
        };

        expect((await apply(app, change)).status).toBe(200);
        const second = await apply(app, change);

        expect(second.status).toBe(400);
        expect(second.body).toMatchObject({ error: { code: "SCHEMA_CHANGE_FAILED" } });
        expect(String((second.body.error as { message: string }).message)).toMatch(/newcommi.*[Dd]eploy/s);
        expect(github.calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    }, BOOTS_A_BACKEND);

    it("does not count a commit that was refused", async () => {
        const github = fakeGitHub();
        const app = await bootBundle({ liveSchema: { repository: REPOSITORY } });
        const change = {
            collectionId: "posts",
            patch: [{ op: "set", path: ["properties", "subtitle"], value: { name: "Subtitle", type: "string" } }]
        };
        const fetchMock = globalThis.fetch as unknown as { getMockImplementation(): (...a: unknown[]) => Promise<Response> };
        const answer = fetchMock.getMockImplementation();
        let refuse = true;
        jest.spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
            if (refuse && init?.method === "PATCH") return new Response(JSON.stringify({ message: "Update is not a fast forward" }), { status: 422 });
            return answer(input, init);
        }) as typeof fetch);

        expect((await apply(app, change)).status).not.toBe(200);
        refuse = false;
        expect((await apply(app, change)).status).toBe(200);
        // The refused update never reached the fake; the accepted one did.
        expect(github.calls.filter(c => c.method === "PATCH")).toHaveLength(1);
    }, BOOTS_A_BACKEND);
});
