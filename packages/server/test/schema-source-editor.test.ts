import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver, SchemaChangePlan } from "@rebasepro/types";

/**
 * One editor of the collection source per process, one edit at a time.
 *
 * A live schema `/apply` built a fresh ts-morph project over every collection
 * file on every save — 180–250 ms of blocked event loop at 200 files — while
 * the source-only editor's routes already kept one for the life of the
 * server. Both routers now share that one, behind one queue: two edits never
 * run in the project at once, and each reads back what it wrote before the
 * next begins.
 */

const mockProjects = { created: 0 };
jest.mock("ts-morph", () => {
    const actual = jest.requireActual<typeof import("ts-morph")>("ts-morph");
    class CountingProject extends actual.Project {
        constructor(...args: ConstructorParameters<typeof actual.Project>) {
            super(...args);
            mockProjects.created++;
        }
    }
    return { ...actual, Project: CountingProject };
});

import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";
import { AstSchemaEditor } from "../src/api/ast-schema-editor";
import { SchemaSourceEditor } from "../src/schema-edit/source-editor";
import { writeLocalCollectionSource } from "../src/schema-edit/local-source";

const JWT_SECRET = "schema-source-editor-test-secret-1234567890";
const BOOTS_A_BACKEND = 30_000;

const collectionFile = (slug: string, name: string) => `import { defineCollection } from "@rebasepro/cms-types";

const ${slug}Collection = defineCollection({
    name: "${name}",
    slug: "${slug}",
    table: "${slug}",
    properties: {
        title: { name: "Title", type: "string" }
    }
});

export default ${slug}Collection;
`;

function collection(slug: string, name: string): CollectionConfig {
    return {
        name,
        slug,
        table: slug,
        properties: { title: { name: "Title", type: "string" } }
    } as unknown as CollectionConfig;
}

let root: string;
let collectionsDir: string;

const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" }).toString().trim();

beforeEach(() => {
    process.env.NODE_ENV = "development";
    // The real path: `git rev-parse` answers with it, and the commit's paths
    // are taken relative to what it answers.
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "schema-source-editor-")));
    collectionsDir = path.join(root, "collections");
    fs.mkdirSync(collectionsDir);
    fs.writeFileSync(path.join(collectionsDir, "posts.ts"), collectionFile("posts", "Posts"));
    fs.writeFileSync(path.join(collectionsDir, "tags.ts"), collectionFile("tags", "Tags"));
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "init");
    mockProjects.created = 0;
});

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    fs.rmSync(root, { recursive: true, force: true });
});

/** A plan with nothing to run against the database: the change is the source's alone. */
const sourcePlan = (): SchemaChangePlan => ({
    files: [],
    statements: [],
    classified: { changes: [], verdict: "safe", applicable: true },
    message: "chore(schema): edit\n"
} as unknown as SchemaChangePlan);

async function boot(): Promise<Hono> {
    const driver = {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        admin: { planSchemaChange: async () => sourcePlan() }
    };
    const bootstrapper = {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: {} } as unknown as InitializedDriver;
        },
        // Enough for the admin gate's live role lookup; nothing logs in.
        async initializeAuth() {
            return {
                userService: {},
                authRepository: {
                    getAccountAccessState: async () => ({ roles: ["admin"], disabled: false, tokensValidAfter: null })
                }
            };
        }
    } as unknown as BackendBootstrapper;

    const app = new Hono();
    await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("posts", "Posts"), collection("tags", "Tags")],
        collectionsDir,
        auth: { jwtSecret: JWT_SECRET },
        bootstrappers: [bootstrapper]
    } as never);
    return app;
}

async function post(app: Hono, url: string, body: unknown) {
    const token = await generateAccessToken("admin-1", ["admin"]);
    return app.request(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
    });
}

const rename = (collectionId: string, name: string) => ({
    collectionId,
    patch: [{ op: "set", path: ["name"], value: name }]
});

describe("the collection source editor", () => {
    it("is built once per process, and every save through either router uses it", async () => {
        const app = await boot();
        // Boot builds the one project.
        expect(mockProjects.created).toBe(1);

        for (const [i, collectionId] of ["posts", "tags", "posts"].entries()) {
            const res = await post(app, "/api/admin/schema/apply", rename(collectionId, `Live ${i}`));
            expect(res.status).toBe(200);
        }
        for (const [i, collectionId] of ["tags", "posts"].entries()) {
            const res = await post(app, "/api/schema-editor/collection/save", rename(collectionId, `Source ${i}`));
            expect(res.status).toBe(200);
        }

        expect(mockProjects.created).toBe(1);
        // The applies were committed; the source-only saves were written.
        expect(git("log", "--format=%s").split("\n")).toHaveLength(4);
        expect(fs.readFileSync(path.join(collectionsDir, "posts.ts"), "utf8")).toContain("name: \"Source 1\"");
        expect(fs.readFileSync(path.join(collectionsDir, "tags.ts"), "utf8")).toContain("name: \"Source 0\"");
    }, BOOTS_A_BACKEND);

    it("commits what a fresh editor per apply would have written", async () => {
        const edits = [rename("posts", "One"), rename("tags", "Two"), rename("posts", "Three")];

        // A copy of the directory, edited the way `/apply` used to: a project per edit.
        const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "schema-source-fresh-"));
        try {
            fs.cpSync(collectionsDir, fresh, { recursive: true });
            for (const edit of edits) await new AstSchemaEditor(fresh).applyPatch(edit.collectionId, edit.patch as never);

            const app = await boot();
            for (const edit of edits) expect((await post(app, "/api/admin/schema/apply", edit)).status).toBe(200);

            for (const file of ["posts.ts", "tags.ts"]) {
                expect(fs.readFileSync(path.join(collectionsDir, file), "utf8"))
                    .toBe(fs.readFileSync(path.join(fresh, file), "utf8"));
            }
        } finally {
            fs.rmSync(fresh, { recursive: true, force: true });
        }
    }, BOOTS_A_BACKEND);
});

describe("edits through the shared editor", () => {
    /** An edit that starts, then waits to be let go. */
    function held() {
        let release!: () => void;
        let fail!: (error: Error) => void;
        const gate = new Promise<void>((resolve, reject) => {
            release = resolve;
            fail = reject;
        });
        return { gate, release, fail };
    }

    it("run one at a time, in the order they arrived, a refused one included", async () => {
        const source = new SchemaSourceEditor(new AstSchemaEditor(collectionsDir));
        const events: string[] = [];
        const first = held();
        const second = held();

        const a = source.run(async () => { events.push("a starts"); await first.gate; events.push("a ends"); });
        const b = source.run(async () => { events.push("b starts"); await second.gate; events.push("b ends"); });
        const c = source.run(async () => { events.push("c runs"); });

        await new Promise(resolve => setTimeout(resolve, 10));
        expect(events).toEqual(["a starts"]);

        first.release();
        await a;
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(events).toEqual(["a starts", "a ends", "b starts"]);

        second.fail(new Error("refused"));
        await expect(b).rejects.toThrow("refused");
        await c;
        expect(events).toEqual(["a starts", "a ends", "b starts", "c runs"]);
    });

    it("each commit what they wrote, not what an edit after them wrote", async () => {
        const source = new SchemaSourceEditor(new AstSchemaEditor(collectionsDir));
        const where = { collectionsDir, repositoryRoot: root };

        const [first, second] = await Promise.all([
            writeLocalCollectionSource(source, where, rename("posts", "First") as never),
            writeLocalCollectionSource(source, where, rename("posts", "Second") as never)
        ]);

        expect(first).toEqual([{ path: "collections/posts.ts", contents: expect.stringContaining("name: \"First\"") }]);
        expect(second).toEqual([{ path: "collections/posts.ts", contents: expect.stringContaining("name: \"Second\"") }]);
    });

    it("see files changed on disk since the editor was built, and hand a removal back whole", async () => {
        const source = new SchemaSourceEditor(new AstSchemaEditor(collectionsDir));
        // Written after the project was parsed, as the IDE or a restored
        // commit would.
        fs.writeFileSync(path.join(collectionsDir, "index.ts"),
            "import posts from \"./posts\";\nimport tags from \"./tags\";\n\nexport const collections = [posts, tags];\n");

        const files = await writeLocalCollectionSource(source, { collectionsDir, repositoryRoot: root }, { collectionId: "tags", remove: true });

        expect(files).toEqual([
            { path: "collections/tags.ts", contents: "", deleted: true },
            { path: "collections/index.ts", contents: expect.not.stringContaining("tags") }
        ]);
        expect(fs.existsSync(path.join(collectionsDir, "tags.ts"))).toBe(false);
    });

    it("all land when many arrive at once", async () => {
        const source = new SchemaSourceEditor(new AstSchemaEditor(collectionsDir));

        await Promise.all(Array.from({ length: 8 }, (_, i) => source.run(editor => editor.applyPatch("posts", [
            { op: "set", path: ["properties", `field${i}`], value: { name: `Field ${i}`, type: "string" } }
        ]))));

        const text = fs.readFileSync(path.join(collectionsDir, "posts.ts"), "utf8");
        for (let i = 0; i < 8; i++) expect(text).toContain(`field${i}:`);
    });
});
