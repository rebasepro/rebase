/**
 * The live schema editing routes.
 *
 * Two properties carry most of the weight:
 *
 * - **`/plan` has no side effects.** It is what a UI calls to show someone what
 *   will happen before they agree to it, and a "preview" that wrote something
 *   would be worse than no preview.
 * - **A refused change writes nothing at all** — not the collection source, not
 *   the generated files, not the DDL. `writeSource` goes to disk through the AST
 *   editor, outside the repository's own checks, so the refusal has to come
 *   first or a rejected edit leaves a rewritten file behind and reports that
 *   nothing happened.
 *
 * The driver is faked. What the planner decides is tested against the real
 * generator in `@rebasepro/server-postgres`; what these routes do with the
 * answer is what is under test here.
 */
import { Hono } from "hono";
import type { CollectionConfig, DatabaseAdmin, SchemaChangePlan } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import {
    createLiveSchemaRoutes,
    proposedCollections,
    type LiveSchemaRoutesConfig
} from "../src/api/live-schema-routes";
import type { SchemaEditRepository } from "../src/schema-edit/apply-schema-change";

const collection = (slug: string, properties: Record<string, unknown> = {}): CollectionConfig =>
    ({ slug, name: slug, properties }) as unknown as CollectionConfig;

const okPlan = (over: Partial<SchemaChangePlan> = {}): SchemaChangePlan => ({
    files: [{ path: "drizzle/schema.sql", contents: "CREATE TABLE posts ();" }],
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

function harness(over: Partial<LiveSchemaRoutesConfig> & { plan?: SchemaChangePlan } = {}) {
    const events: string[] = [];
    const executed: string[] = [];

    const repository: SchemaEditRepository = {
        root: "/tmp/project",
        currentBranch: async () => "main",
        dirtyPaths: async () => [],
        writeFiles: async () => { events.push("write-generated"); },
        commit: async () => { events.push("commit"); return "abc123def456"; }
    };

    const admin = {
        planSchemaChange: async () => { events.push("plan"); return over.plan ?? okPlan(); },
        executeSql: async (sql: string) => { events.push("sql"); executed.push(sql); return { rows: [] }; }
    } as unknown as DatabaseAdmin;

    const config: LiveSchemaRoutesConfig = {
        getCollections: () => [collection("posts", { title: { type: "string" } })],
        getAdmin: () => admin,
        getRepository: () => repository,
        writeSource: async () => {
            events.push("write-source");
            return [{ path: "config/collections/posts.ts", contents: "export const posts = {};" }];
        },
        ...over
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/api/schema", createLiveSchemaRoutes(config));

    const post = (path: string, body: unknown) => app.fetch(new Request(`http://localhost/api/schema${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));

    return { post, events, executed };
}

const change = { collectionId: "posts", collection: { name: "Posts", properties: {} } };

describe("proposedCollections", () => {
    it("replaces the collection being edited", () => {
        const next = proposedCollections(
            [collection("posts"), collection("tags")],
            { collectionId: "posts", collection: { name: "Renamed" } }
        );
        expect(next).toHaveLength(2);
        expect(next.find(c => c.slug === "posts")).toMatchObject({ name: "Renamed" });
        expect(next.find(c => c.slug === "tags")).toBeDefined();
    });

    it("appends one that does not exist yet", () => {
        const next = proposedCollections([collection("posts")], { collectionId: "new", collection: {} });
        expect(next.map(c => c.slug)).toEqual(["posts", "new"]);
    });

    it("forces the slug to match the id, so the two cannot disagree", () => {
        const next = proposedCollections([], { collectionId: "posts", collection: { slug: "something-else" } });
        expect(next[0].slug).toBe("posts");
    });
});

describe("POST /plan", () => {
    it("answers what would happen without touching anything", async () => {
        const { post, events } = harness();
        const res = await post("/plan", change);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
            applicable: true,
            verdict: "safe",
            files: ["drizzle/schema.sql"]
        });
        // Planned, and nothing else.
        expect(events).toEqual(["plan"]);
    });

    it("reports a blocked change rather than refusing to answer", async () => {
        const { post } = harness({ plan: blockedPlan() });
        const res = await post("/plan", change);

        expect(res.status).toBe(200);
        const body = await res.json() as { applicable: boolean; changes: unknown[] };
        expect(body.applicable).toBe(false);
        expect(body.changes).toHaveLength(1);
    });

    it("answers even when there is nowhere to commit", async () => {
        // Knowing a change is blocked is useful before knowing where it lands.
        const { post } = harness({ getRepository: () => undefined });
        expect((await post("/plan", change)).status).toBe(200);
    });
});

describe("POST /apply", () => {
    it("writes the source, commits, then runs the DDL — in that order", async () => {
        const { post, events, executed } = harness();
        const res = await post("/apply", change);

        expect(res.status).toBe(200);
        expect(events).toEqual(["plan", "write-source", "write-generated", "commit", "sql"]);
        expect(executed[0]).toContain("ADD COLUMN");
        expect(await res.json()).toMatchObject({ applied: true, committed: { branch: "main" } });
    });

    it("commits the rewritten source alongside the generated files", async () => {
        let staged: string[] = [];
        const { post } = harness({
            getRepository: () => ({
                root: "/tmp/project",
                currentBranch: async () => "main",
                dirtyPaths: async () => [],
                writeFiles: async (files) => { staged = files.map(f => f.path); },
                commit: async () => "sha"
            })
        });
        await post("/apply", change);
        expect(staged).toEqual(["config/collections/posts.ts", "drizzle/schema.sql"]);
    });

    it("writes NOTHING when the change is refused", async () => {
        const { post, events } = harness({ plan: blockedPlan() });
        const res = await post("/apply", change);

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_CHANGE_UNAPPLICABLE" } });
        // The source must not have been rewritten — that is the whole ordering.
        expect(events).toEqual(["plan"]);
    });

    it("puts the remedy in the refusal, not just the problem", async () => {
        const { post } = harness({ plan: blockedPlan() });
        const body = await (await post("/apply", change)).json() as { error: { message: string } };
        expect(body.error.message).toContain("migration you have read");
    });

    it("reports committed-but-not-applied when the DDL fails", async () => {
        const admin = {
            planSchemaChange: async () => okPlan(),
            executeSql: async () => { throw new Error("connection refused"); }
        } as unknown as DatabaseAdmin;

        const { post } = harness({ getAdmin: () => admin });
        const res = await post("/apply", change);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ applied: false, applyError: expect.stringContaining("connection refused") });
    });

    it("409s on a dirty tree, naming it as a conflict rather than a failure", async () => {
        const { post } = harness({
            getRepository: () => ({
                root: "/tmp/project",
                currentBranch: async () => "main",
                dirtyPaths: async () => ["drizzle/schema.sql"],
                writeFiles: async () => undefined,
                commit: async () => "sha"
            })
        });
        const res = await post("/apply", change);
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_EDIT_DIRTY_TREE" } });
    });
});

describe("refusing where the capability is absent", () => {
    it("says so when the driver cannot plan — Mongo, Firebase", async () => {
        const { post } = harness({ getAdmin: () => ({ executeSql: async () => ({ rows: [] }) }) as DatabaseAdmin });
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
});

describe("input validation", () => {
    it.each([
        ["no collectionId", { collection: {} }],
        ["no collection", { collectionId: "posts" }],
        ["a non-object collection", { collectionId: "posts", collection: "nope" }]
    ])("rejects %s", async (_label, body) => {
        const { post } = harness();
        const res = await post("/apply", body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_CHANGE" } });
    });
});
