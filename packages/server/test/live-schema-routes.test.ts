/**
 * The live schema editing routes, on the table model.
 *
 * Three properties carry most of the weight:
 *
 * - **`/plan` has no side effects.** The edit is previewed on a copy of the
 *   source and compiled; nothing is written.
 * - **A refused change writes nothing at all** — not the table source, not the
 *   generated files, not the DDL.
 * - **After an apply, the running server knows** — `onApplied` hands it the
 *   schema the edit left, and only when the database has the change.
 *
 * The driver is faked. What the planner decides is tested against the real
 * generator in `@rebasepro/server-postgres`; what these routes do with the
 * answer is what is under test here.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import path from "node:path";
import type { DatabaseAdmin, PostgresCollectionConfig, SchemaChangePlan, TablePatch } from "@rebasepro/types";
import { EMPTY_ACCESS_MODEL } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createLiveSchemaRoutes, type LiveSchemaRoutesConfig, type PreviewedSource } from "../src/api/live-schema-routes";
import { TableSourceEditError, TableSourceEditor, type EditedSchema } from "../src/api/table-source-editor";
import type { SchemaEditRepository } from "../src/schema-edit/apply-schema-change";
import { configureAccess } from "../src/auth/access";
import { writeSchemaFixture } from "./helpers/schema-source-fixture";

const collection = (slug: string): PostgresCollectionConfig => ({ slug, name: slug, properties: { id: { type: "string", isId: "uuid" } } });

const okPlan = (over: Partial<SchemaChangePlan> = {}): SchemaChangePlan => ({
    files: [{ path: "backend/src/schema.generated.ts", contents: "export const tables = {};" }],
    statements: ['ALTER TABLE "public"."posts" ADD COLUMN IF NOT EXISTS "subtitle" TEXT;'],
    classified: { changes: [], verdict: "safe", applicable: true },
    message: "feat(schema): add subtitle to posts",
    ...over
});

const blockedPlan = (): SchemaChangePlan => okPlan({
    classified: {
        changes: [{
            kind: "remove-property",
            verdict: "needs-migration",
            collection: "posts",
            property: "subtitle",
            detail: "\"subtitle\" was removed, which would drop the column and its data.",
            remedy: "Remove it in a migration you have read."
        }],
        verdict: "needs-migration",
        applicable: false
    }
});

const PERSON = { uid: "u_1", roles: ["admin"], displayName: "Ada", email: "ada@example.com" };
const API_KEY = { uid: "api-key:7c3f", roles: ["admin", "service"] };
const SOURCE = "backend/schema/posts.ts";

const edited = (): EditedSchema => ({ defs: [], descriptors: [], collections: [collection("posts")] });

function harness(over: Partial<LiveSchemaRoutesConfig> & {
    plan?: SchemaChangePlan;
    user?: HonoEnv["Variables"]["user"];
} = {}) {
    const events: string[] = [];
    const executed: string[] = [];
    const applied: EditedSchema[] = [];

    const repository: SchemaEditRepository = {
        root: "/tmp/project",
        currentBranch: async () => "main",
        dirtyPaths: async () => [],
        writeFiles: async () => { events.push("write-generated"); },
        commit: async () => { events.push("commit"); return "abc123def456"; }
    };

    const admin: DatabaseAdmin = {
        planSchemaChange: async () => { events.push("plan"); return over.plan ?? okPlan(); },
        executeSql: async (sql: string) => { events.push("sql"); executed.push(sql); return []; }
    };

    const config: LiveSchemaRoutesConfig = {
        getCollections: () => [collection("posts")],
        getAdmin: () => admin,
        getRepository: () => repository,
        previewSource: async () => {
            events.push("preview");
            return { files: [{ path: SOURCE, contents: "export const posts = defineTable(…);" }], schema: edited() };
        },
        writeSource: async (source) => {
            events.push("write-source");
            return source.files;
        },
        onApplied: (schema) => { applied.push(schema); },
        ...over
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    // Stands in for the admin gate. Before `route`, or it never runs.
    const user = "user" in over ? over.user : PERSON;
    app.use("/*", async (c, next) => {
        if (user) c.set("user", user);
        await next();
    });
    app.route("/api/schema", createLiveSchemaRoutes(config));

    const post = (route: string, body: unknown) => app.fetch(new Request(`http://localhost/api/schema${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body)
    }));
    const get = (route: string) => app.fetch(new Request(`http://localhost/api/schema${route}`));

    return { post, get, events, executed, applied };
}

const addSubtitle: TablePatch = { op: "addColumn", table: "posts", key: "subtitle", column: { type: { kind: "text" } } };
const change = { patches: [addSubtitle] };

describe("POST /plan", () => {
    it("previews the edit and plans it, writing nothing", async () => {
        const { post, events } = harness();
        const res = await post("/plan", change);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ applicable: true, verdict: "safe" });
        expect(events).toEqual(["preview", "plan"]);
    });

    it("plans against what the edit compiles to", async () => {
        const seen: unknown[][] = [];
        const { post } = harness({
            getAdmin: () => ({
                planSchemaChange: async (before: unknown[], after: unknown[]) => { seen.push(before, after); return okPlan(); }
            })
        });
        await post("/plan", change);
        expect(seen[0]).toEqual([collection("posts")]);
        expect(seen[1]).toEqual(edited().collections);
    });

    it("reports a blocked change rather than refusing to answer", async () => {
        const { post } = harness({ plan: blockedPlan() });
        const body = await (await post("/plan", change)).json() as { applicable: boolean; changes: unknown[] };
        expect(body.applicable).toBe(false);
        expect(body.changes).toHaveLength(1);
    });

    it("answers even when there is nowhere to commit", async () => {
        const { post } = harness({ getRepository: () => undefined });
        expect((await post("/plan", change)).status).toBe(200);
    });

    it("names the edits in the commit message of a change with no schema in it", async () => {
        const { post } = harness({ plan: okPlan({ statements: [], message: "chore(schema): no change\n" }) });
        const body = await (await post("/plan", {
            patches: [
                { op: "setOption", table: "posts", option: "description", value: "Blog posts." },
                { op: "moveColumn", table: "posts", key: "title" }
            ]
        })).json() as { message: string };
        expect(body.message.split("\n")[0]).toBe("chore(schema): edit posts — set description, move column title");
    });

    /**
     * The review a person agrees to is the consent to the commit, so it lists
     * exactly what the commit will hold: the table source, then the generated
     * files.
     */
    describe("the files it lists", () => {
        it("are the files the apply commits, the table source included", async () => {
            const { post } = harness();
            const planned = (await (await post("/plan", change)).json() as { files: string[] }).files;
            const committed = (await (await post("/apply", change)).json() as { committed: { files: string[] } }).committed.files;
            expect(planned).toEqual([SOURCE, "backend/src/schema.generated.ts"]);
            expect(planned).toEqual(committed);
        });

        it("leave the source out when the source may not be written", async () => {
            const { post } = harness({ writeSource: undefined });
            expect((await (await post("/plan", change)).json() as { files: string[] }).files).toEqual(["backend/src/schema.generated.ts"]);
        });

        it("are none for a change the apply refuses", async () => {
            const { post } = harness({ plan: { ...blockedPlan(), files: [] } });
            expect((await (await post("/plan", change)).json() as { files: string[] }).files).toEqual([]);
        });
    });
});

describe("POST /apply", () => {
    it("previews, plans, writes the source, commits, then runs the DDL — in that order", async () => {
        const { post, events, executed } = harness();
        const res = await post("/apply", change);

        expect(res.status).toBe(200);
        expect(events).toEqual(["preview", "plan", "write-source", "write-generated", "commit", "sql"]);
        expect(executed[0]).toContain("ADD COLUMN");
        expect(await res.json()).toMatchObject({ applied: true, committed: { branch: "main" } });
    });

    it("hands the running server the schema the edit left, once the database has it", async () => {
        const { post, applied } = harness();
        await post("/apply", change);
        expect(applied).toEqual([edited()]);
    });

    it("leaves the running server alone after a source-only commit, or when the DDL fails", async () => {
        const sourceOnly = harness({ plan: okPlan({ classified: { changes: [], verdict: "safe", applicable: true } }) });
        await sourceOnly.post("/apply", { ...change, sourceOnly: true });
        expect(sourceOnly.applied).toEqual([]);

        const failing = harness({
            getAdmin: () => ({ planSchemaChange: async () => okPlan(), executeSql: async () => { throw new Error("connection refused"); } })
        });
        const res = await failing.post("/apply", change);
        expect(await res.json()).toMatchObject({ applied: false, applyError: expect.stringContaining("connection refused") });
        expect(failing.applied).toEqual([]);
    });

    it("runs one apply at a time, so two cannot interleave their writes and commits", async () => {
        let releaseFirst: () => void = () => undefined;
        const firstCommitHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
        let commits = 0;
        const { post, events } = harness({
            getRepository: () => ({
                root: "/tmp/project",
                currentBranch: async () => "main",
                dirtyPaths: async () => [],
                writeFiles: async () => { events.push("write-generated"); },
                commit: async () => {
                    commits++;
                    if (commits === 1) await firstCommitHeld;
                    events.push("commit");
                    return "sha";
                }
            })
        });

        const first = post("/apply", change);
        const second = post("/apply", change);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(events.filter(e => e === "write-source")).toHaveLength(1);

        releaseFirst();
        expect((await first).status).toBe(200);
        expect((await second).status).toBe(200);
        expect(events.filter(e => e !== "plan" && e !== "preview")).toEqual([
            "write-source", "write-generated", "commit", "sql",
            "write-source", "write-generated", "commit", "sql"
        ]);
    });

    it("writes NOTHING when the change is refused, and says what to do instead", async () => {
        const { post, events } = harness({ plan: blockedPlan() });
        const res = await post("/apply", change);

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("SCHEMA_CHANGE_UNAPPLICABLE");
        expect(body.error.message).toContain("migration you have read");
        expect(events).toEqual(["preview", "plan"]);
    });

    it("409s on a dirty tree, before writing anything", async () => {
        const { post, events } = harness({
            getRepository: () => ({
                root: "/tmp/project",
                currentBranch: async () => "main",
                dirtyPaths: async () => [SOURCE],
                writeFiles: async () => undefined,
                commit: async () => "sha"
            })
        });
        const res = await post("/apply", change);
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_EDIT_DIRTY_TREE" } });
        expect(events).not.toContain("write-source");
    });

    it("checks the tree for the paths the preview named, before the write makes them dirty", async () => {
        const onDisk = new Set<string>();
        const events: string[] = [];
        const { post } = harness({
            getRepository: () => ({
                root: "/tmp/project",
                currentBranch: async () => "main",
                dirtyPaths: async () => { events.push(`dirty-check(${[...onDisk].join(",") || "clean"})`); return [...onDisk]; },
                writeFiles: async () => undefined,
                commit: async () => "sha"
            }),
            writeSource: async (source) => { events.push("write-source"); onDisk.add(SOURCE); return source.files; }
        });
        expect((await post("/apply", change)).status).toBe(200);
        expect(events).toEqual(["dirty-check(clean)", "write-source"]);
    });

    it("turns a failure between the check and the commit into a refusal, not a 500", async () => {
        const { post } = harness({ writeSource: async () => { throw new Error("posts.ts changed since the edit was prepared"); } });
        const res = await post("/apply", change);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_CHANGE_FAILED", message: "posts.ts changed since the edit was prepared" } });
    });
});

describe("an edit the schema editor refuses", () => {
    it.each(["/plan", "/apply"])("is a 400 carrying the problems on %s, and nothing is planned", async (route) => {
        const { post, events } = harness({
            previewSource: async () => {
                throw new TableSourceEditError("SCHEMA_EDIT_DOES_NOT_COMPILE", "The edit was not written: tags has no primary key.", [
                    { table: "tags", message: "has no primary key." }
                ]);
            }
        });
        const res = await post(route, change);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
            error: { code: "SCHEMA_EDIT_DOES_NOT_COMPILE", details: { problems: [{ table: "tags", message: "has no primary key." }] } }
        });
        expect(events).toEqual([]);
    });
});

describe("refusing where the capability is absent", () => {
    it("says so when the driver cannot plan — a custom driver", async () => {
        const { post } = harness({ getAdmin: () => ({ executeSql: async () => [] }) });
        const res = await post("/plan", change);
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_EDITING_UNSUPPORTED" } });
    });

    it("explains the bundle case rather than failing obscurely", async () => {
        const { post } = harness({ getRepository: () => undefined });
        const res = await post("/apply", change);
        expect(res.status).toBe(503);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("SCHEMA_EDITING_NO_REPOSITORY");
        expect(body.error.message).toContain("built bundle");
    });

    it("reports itself unavailable, with the true reason, when the source cannot be written", async () => {
        const { get, post } = harness({ writeSource: undefined, sourceEditingOff: { code: "SCHEMA_EDITOR_PRODUCTION", message: "off in production" } });
        expect(await (await get("/status")).json()).toMatchObject({ enabled: false, code: "SCHEMA_EDITOR_PRODUCTION", canPlan: true });
        const res = await post("/apply", change);
        expect(res.status).toBe(501);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_EDITOR_PRODUCTION" } });
    });

    it("cannot plan without the editor, and says so", async () => {
        const { get, post } = harness({ previewSource: undefined, writeSource: undefined });
        expect(await (await get("/status")).json()).toMatchObject({ enabled: false, canPlan: false, code: "SCHEMA_EDITOR_MISSING_DEPENDENCY" });
        expect((await post("/plan", change)).status).toBe(501);
    });
});

describe("input validation", () => {
    it.each([
        ["no patches", {}],
        ["an empty list", { patches: [] }],
        ["an unknown operation", { patches: [{ op: "renameTable", table: "posts" }] }],
        ["a slug rename", { patches: [{ op: "setOption", table: "posts", option: "slug", value: "articles" }] }],
        ["a column name that closes the statement", {
            patches: [{ op: "addColumn", table: "posts", key: "title", column: { type: { kind: "text" }, column: "a\" ); DROP TABLE users; --" } }]
        }],
        ["a table name that closes the statement", {
            patches: [{ op: "createTable", table: { name: "x\" (id int); DROP TABLE users; --", columns: { id: { type: { kind: "uuid" }, primaryKey: true } }, rls: "admin-only" } }]
        }],
        ["a schema that is not a string", {
            patches: [{ op: "createTable", table: { name: "x", schema: { toString: "nope" }, columns: { id: { type: { kind: "uuid" }, primaryKey: true } }, rls: "admin-only" } }]
        }],
        ["a transform, which is code", {
            patches: [{ op: "changeColumn", table: "posts", key: "title", column: { type: { kind: "text" }, transform: "() => 1" } }]
        }]
    ])("rejects %s before anything is previewed", async (_label, body) => {
        const { post, events } = harness();
        const res = await post("/apply", body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_CHANGE" } });
        expect(events).toEqual([]);
    });

    it("says why a slug rename is not an edit", async () => {
        const { post } = harness();
        const body = await (await post("/plan", { patches: [{ op: "setOption", table: "posts", option: "slug", value: "articles" }] })).json() as { error: { message: string } };
        expect(body.error.message).toMatch(/migration, not an edit/);
    });

    it.each(["/plan", "/apply"])("answers a body that is not JSON with a 400 on %s", async (route) => {
        const { post, events } = harness();
        const res = await post(route, "{ \"patches\": [");
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_CHANGE" } });
        expect(events).toEqual([]);
    });
});

/**
 * Applying is a second privilege, and the admin gate in front of these routes
 * only answers the first.
 */
describe("who may apply", () => {
    it("lets a person apply", async () => {
        const { post, events } = harness({ user: PERSON });
        expect((await post("/apply", change)).status).toBe(200);
        expect(events).toContain("commit");
    });

    it("lets an API key plan", async () => {
        const { post, events } = harness({ user: API_KEY });
        expect((await post("/plan", change)).status).toBe(200);
        expect(events).toEqual(["preview", "plan"]);
    });

    it("refuses an API key applying, and previews nothing", async () => {
        const { post, events } = harness({ user: API_KEY });
        const res = await post("/apply", change);
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_EDIT_REQUIRES_A_PERSON" } });
        expect(events).toEqual([]);
    });

    it("refuses the service key applying", async () => {
        const { post, events } = harness({ user: { uid: "service", roles: ["admin"] } });
        expect((await post("/apply", change)).status).toBe(403);
        expect(events).toEqual([]);
    });

    it("lets a machine apply when the project has said so", async () => {
        const { post, events } = harness({ user: API_KEY, policy: { allowMachineApply: true } });
        expect((await post("/apply", change)).status).toBe(200);
        expect(events).toContain("commit");
    });

    it("refuses a caller with no identity at all", async () => {
        const { post } = harness({ user: undefined });
        expect((await post("/plan", change)).status).toBe(403);
        expect((await post("/apply", change)).status).toBe(401);
    });

    it("lets a person holding only schema:read plan, and refuses their apply", async () => {
        configureAccess({ model: { roles: { developer: { scopes: ["schema:read"] } }, scopes: {} } });
        try {
            const { post, events } = harness({ user: { uid: "dev-1", roles: ["developer"] } });
            expect((await post("/plan", change)).status).toBe(200);
            const res = await post("/apply", change);
            expect(res.status).toBe(403);
            expect((await res.json() as { error: { details: { requiredScope: string } } }).error.details.requiredScope).toBe("schema:write");
            expect(events).not.toContain("commit");
        } finally {
            configureAccess({ model: EMPTY_ACCESS_MODEL });
        }
    });

    it("reports the caller's own capabilities on /status", async () => {
        const { get } = harness({ user: API_KEY });
        expect(await (await get("/status")).json()).toMatchObject({
            enabled: true,
            canPlan: true,
            canApply: false,
            applyRefusedCode: "SCHEMA_EDIT_REQUIRES_A_PERSON"
        });
    });
});

describe("a project that keeps versioned migrations", () => {
    it("says what still has to be done, on the plan and on the result", async () => {
        const { post } = harness({ usesVersionedMigrations: () => true });
        expect(((await (await post("/plan", change)).json()) as { followUp: string[] }).followUp[0]).toContain("rebase db generate");
        expect(((await (await post("/apply", change)).json()) as { followUp: string[] }).followUp[0]).toContain("rebase db generate");
    });

    it("stays quiet for a project that does not keep them, or a change with no DDL", async () => {
        expect(((await (await harness({ usesVersionedMigrations: () => false }).post("/plan", change)).json()) as { followUp: string[] }).followUp).toEqual([]);
        const noDdl = harness({ usesVersionedMigrations: () => true, plan: okPlan({ statements: [] }) });
        expect(((await (await noDdl.post("/plan", change)).json()) as { followUp: string[] }).followUp).toEqual([]);
    });
});

describe("a planner that rejects a blocked change", () => {
    class RefusedPlan extends Error {
        constructor(readonly classified: SchemaChangePlan["classified"]) {
            super("This change cannot be applied to a running database.");
        }
    }
    const refusing: DatabaseAdmin = {
        planSchemaChange: async () => { throw new RefusedPlan(blockedPlan().classified); },
        executeSql: async () => []
    };

    it("is planned as blocked, not answered with a 500", async () => {
        const { post } = harness({ getAdmin: () => refusing });
        expect(await (await post("/plan", change)).json()).toMatchObject({
            applicable: false,
            verdict: "needs-migration",
            changes: [{ kind: "remove-property", property: "subtitle" }],
            statements: []
        });
    });

    it("is refused on /apply as unapplicable, before anything is written", async () => {
        const { post, events } = harness({ getAdmin: () => refusing });
        const res = await post("/apply", change);
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SCHEMA_CHANGE_UNAPPLICABLE");
        expect(events).toEqual(["preview"]);
    });

    it("still fails loudly on anything else the planner throws", async () => {
        const { post } = harness({ getAdmin: () => ({ planSchemaChange: async () => { throw new Error("catalogue read failed"); }, executeSql: async () => [] }) });
        expect((await post("/plan", change)).status).toBe(500);
    });
});

/**
 * The routes over the real editor: the plan's `after` side is the edited
 * source, compiled and lowered.
 */
describe("over the real schema editor", () => {
    let fixture: ReturnType<typeof writeSchemaFixture>;
    let editor: TableSourceEditor;
    beforeEach(() => {
        fixture = writeSchemaFixture();
        editor = new TableSourceEditor(fixture.dir);
    });
    afterEach(() => fixture.cleanup());

    const realPreview = async (patches: readonly TablePatch[]): Promise<PreviewedSource> => {
        const edit = await editor.preview(patches);
        return {
            files: edit.files.map(file => ({ path: path.relative(fixture.root, file.path), contents: file.contents })),
            schema: edit.schema
        };
    };

    it("plans the edited table, its new column lowered for the planner", async () => {
        const planned: unknown[] = [];
        const { post } = harness({
            previewSource: realPreview,
            getAdmin: () => ({ planSchemaChange: async (_before: unknown[], after: unknown[]) => { planned.push(...after); return okPlan(); } })
        });
        const res = await post("/plan", change);
        expect(res.status).toBe(200);
        expect(((await res.json()) as { files: string[] }).files).toEqual(["backend/schema/posts.ts", "backend/src/schema.generated.ts"]);
        const posts = planned.find((each): each is PostgresCollectionConfig =>
            typeof each === "object" && each !== null && "slug" in each && each.slug === "posts");
        expect(Object.keys(posts?.properties ?? {})).toContain("subtitle");
    });

    it("refuses an edit whose result does not compile, naming the problem", async () => {
        const { post, events } = harness({ previewSource: realPreview });
        const res = await post("/plan", { patches: [{ op: "removeColumn", table: "tags", key: "id" }] });
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; details: { problems: { table: string }[] } } };
        expect(body.error.code).toBe("SCHEMA_EDIT_DOES_NOT_COMPILE");
        expect(body.error.details.problems.some(problem => problem.table === "tags")).toBe(true);
        expect(events).toEqual([]);
    });
});
