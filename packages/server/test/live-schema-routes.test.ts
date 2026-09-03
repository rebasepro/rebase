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

/**
 * Who is asking.
 *
 * In production the admin gate has run before any of this and `user` is always
 * set. A harness that left it undefined would be exercising a request that
 * cannot happen, and would hide the thing worth pinning: these routes refuse a
 * credential the admin gate lets straight through.
 */
const PERSON = { uid: "u_1", roles: ["admin"], displayName: "Ada", email: "ada@example.com" };
const API_KEY = { uid: "api-key:7c3f", roles: ["admin", "service"] };

function harness(over: Partial<LiveSchemaRoutesConfig> & {
    plan?: SchemaChangePlan;
    user?: unknown;
} = {}) {
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
    // Stands in for the admin gate. Before `route`, or it never runs — Hono
    // collects matching handlers in registration order.
    const user = "user" in over ? over.user : PERSON;
    app.use("/*", async (c, next) => {
        if (user) c.set("user", user as never);
        await next();
    });
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

    /**
     * Only `collectionId` was checked here, and it is the one name that becomes
     * a FILENAME. The names that become Postgres IDENTIFIERS — `table`,
     * `schema`, a property's `columnName` — went through unexamined into DDL
     * that is quoted and concatenated, on the owner connection: the one
     * connection in the system that no RLS policy applies to.
     */
    it.each([
        ["a table that closes the statement", {
            collectionId: "posts",
            collection: { table: 'x" (id int); DROP TABLE users; --', properties: {} }
        }],
        ["a schema that closes the statement", {
            collectionId: "posts",
            collection: { schema: 'public"; DROP TABLE users; --', properties: {} }
        }],
        ["a column name that closes the statement", {
            collectionId: "posts",
            collection: { properties: { title: { type: "string", columnName: 'a" ); DROP TABLE users; --' } } }
        }],
        ["a table name that is not a string at all", {
            collectionId: "posts",
            collection: { table: { toString: "nope" }, properties: {} }
        }]
    ])("rejects %s", async (_label, body) => {
        const { post, events } = harness();
        const res = await post("/apply", body);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_CHANGE" } });
        // And nothing happened on the way to the refusal: no plan, no write.
        expect(events).toEqual([]);
    });

    it("still accepts an ordinary table, schema and column name", async () => {
        const { post } = harness();
        const res = await post("/plan", {
            collectionId: "posts",
            collection: { table: "posts", schema: "public", properties: { title: { type: "string", columnName: "title" } } }
        });
        expect(res.status).toBe(200);
    });
});

/**
 * Applying is a second privilege, and the admin gate in front of these routes
 * only answers the first.
 *
 * The failure with consequences is a machine applying: an API key sitting in a
 * CI environment variable that can rewrite the project's source and push a
 * commit to its default branch, under a name that identifies nobody.
 */
describe("who may apply", () => {
    it("lets a person apply", async () => {
        const { post, events } = harness({ user: PERSON });
        const res = await post("/apply", change);
        expect(res.status).toBe(200);
        expect(events).toContain("commit");
    });

    it("lets an API key plan", async () => {
        // Planning has no side effects, and a CI job asking whether a proposed
        // change is applicable is a good use of this API.
        const { post, events } = harness({ user: API_KEY });
        const res = await post("/plan", change);
        expect(res.status).toBe(200);
        expect(events).toEqual(["plan"]);
    });

    it("refuses an API key applying, and writes nothing at all", async () => {
        const { post, events } = harness({ user: API_KEY });
        const res = await post("/apply", change);

        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({
            error: { code: "SCHEMA_EDIT_REQUIRES_A_PERSON" }
        });
        // Refused before the source is rewritten, not after. `writeSource`
        // writes to disk outside the repository's checks, so a late refusal
        // leaves a rewritten file behind and reports that nothing happened.
        expect(events).toEqual([]);
    });

    it("refuses the service key applying", async () => {
        const { post, events } = harness({ user: { uid: "service", roles: ["admin"] } });
        const res = await post("/apply", change);
        expect(res.status).toBe(403);
        expect(events).toEqual([]);
    });

    it("lets a machine apply when the project has said so", async () => {
        const { post, events } = harness({
            user: API_KEY,
            policy: { allowMachineApply: true }
        });
        const res = await post("/apply", change);
        expect(res.status).toBe(200);
        expect(events).toContain("commit");
    });

    it("refuses a caller with no identity at all", async () => {
        // Cannot happen in production — the admin gate runs first. Checked
        // anyway: a capability function that trusts its caller to have checked
        // is one refactor away from granting everything.
        const { post } = harness({ user: undefined });
        expect((await post("/plan", change)).status).toBe(403);
        expect((await post("/apply", change)).status).toBe(403);
    });

    it("reports the caller's own capabilities on /status", async () => {
        // So the panel can grey out the button *and say why*, rather than
        // letting somebody read a plan, decide, press, and only then be refused.
        const { post: _post } = harness({ user: API_KEY });
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => { c.set("user", API_KEY as never); await next(); });
        app.route("/api/schema", createLiveSchemaRoutes({
            getCollections: () => [collection("posts")],
            getAdmin: () => ({
                planSchemaChange: async () => okPlan(),
                executeSql: async () => ({ rows: [] })
            } as unknown as DatabaseAdmin),
            getRepository: () => ({
                root: "/tmp/project",
                currentBranch: async () => "main",
                dirtyPaths: async () => [],
                writeFiles: async () => {},
                commit: async () => "abc"
            }),
            writeSource: async () => []
        }));

        const res = await app.fetch(new Request("http://localhost/api/schema/status"));
        expect(await res.json()).toMatchObject({
            enabled: true,
            canPlan: true,
            canApply: false,
            applyRefusedCode: "SCHEMA_EDIT_REQUIRES_A_PERSON"
        });
    });
});

/**
 * The dirty-tree check must not see this change's own edit.
 *
 * `writeSource` goes through the filesystem, not through the repository, so
 * ordering is the whole correctness argument. Written first, the tree is dirty
 * *because of this change* by the time the check runs — and since
 * `git status --porcelain` reports untracked files too, a new collection's
 * source file is always untracked and the change is always refused. The file is
 * left behind either way, so the retry finds a dirty tree as well.
 *
 * That is not a hypothetical: it was the behaviour, and it meant `/apply` could
 * never succeed through its own HTTP surface. Every existing test missed it
 * because they hand `applySchemaChange` a set of files that is already written,
 * which is precisely the shape that cannot reproduce it.
 */
describe("writing the source without tripping the dirty check", () => {
    /**
     * A repository whose `dirtyPaths` answers what a real `git status` would:
     * nothing at first, and the source file once it has been written.
     */
    function withRealisticDirtiness(over: { alreadyDirty?: string[] } = {}) {
        const events: string[] = [];
        const onDisk = new Set<string>(over.alreadyDirty ?? []);
        const SOURCE = "config/collections/posts.ts";

        const repository: SchemaEditRepository = {
            root: "/tmp/project",
            currentBranch: async () => "main",
            dirtyPaths: async () => {
                events.push(`dirty-check(${[...onDisk].join(",") || "clean"})`);
                return [...onDisk];
            },
            writeFiles: async () => { events.push("write-generated"); },
            commit: async () => { events.push("commit"); return "abc123def456"; }
        };

        const admin = {
            planSchemaChange: async () => { events.push("plan"); return okPlan(); },
            executeSql: async () => { events.push("sql"); return { rows: [] }; }
        } as unknown as DatabaseAdmin;

        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => { c.set("user", PERSON as never); await next(); });
        app.route("/api/schema", createLiveSchemaRoutes({
            getCollections: () => [collection("posts", { title: { type: "string" } })],
            getAdmin: () => admin,
            getRepository: () => repository,
            sourcePathsFor: () => [SOURCE],
            writeSource: async () => {
                // What the AST editor does: touch the disk. From here on a real
                // `git status` reports this path.
                events.push("write-source");
                onDisk.add(SOURCE);
                return [{ path: SOURCE, contents: "export const posts = {};" }];
            }
        }));

        return {
            events,
            post: (body: unknown) => app.fetch(new Request("http://localhost/api/schema/apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }))
        };
    }

    it("applies, rather than refusing on the file it just wrote", async () => {
        const { post, events } = withRealisticDirtiness();
        const res = await post(change);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ applied: true });
        // The check runs while the tree is still clean, and only then is the
        // source written.
        expect(events.indexOf("dirty-check(clean)")).toBeLessThan(events.indexOf("write-source"));
        expect(events).toContain("commit");
    });

    it("commits the source it wrote, not just the generated files", async () => {
        let committed: string[] = [];
        const { post } = withRealisticDirtiness();
        const res = await post(change);
        committed = ((await res.json()) as { committed: { files: string[] } }).committed.files;

        expect(committed).toContain("config/collections/posts.ts");
        expect(committed).toContain("drizzle/schema.sql");
    });

    it("still refuses when somebody else's work is in the way", async () => {
        // The check has to keep doing its job: a half-finished edit to a file
        // this commit would sweep up is exactly what it exists to catch.
        const { post, events } = withRealisticDirtiness({
            alreadyDirty: ["config/collections/posts.ts"]
        });
        const res = await post(change);

        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_EDIT_DIRTY_TREE" } });
        // And nothing was written, so the refusal leaves the tree as it found it.
        expect(events).not.toContain("write-source");
        expect(events).not.toContain("commit");
    });
});

/**
 * A capability that is absent should say so, not die when it is used.
 *
 * `writeSource` used to be a function that existed and threw when the AST
 * editor was unavailable. `/status` can only see whether the field is *set*, so
 * it answered `enabled: true`, the panel offered the control, and `/apply` came
 * back 500 the moment somebody confirmed — after they had read a plan and
 * agreed to it.
 */
describe("when the source cannot be rewritten", () => {
    const withoutWriteSource = () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => { c.set("user", PERSON as never); await next(); });
        app.route("/api/schema", createLiveSchemaRoutes({
            getCollections: () => [collection("posts")],
            getAdmin: () => ({
                planSchemaChange: async () => okPlan(),
                executeSql: async () => ({ rows: [] })
            } as unknown as DatabaseAdmin),
            getRepository: () => ({
                root: "/tmp/project",
                currentBranch: async () => "main",
                dirtyPaths: async () => [],
                writeFiles: async () => {},
                commit: async () => "abc123def456"
            })
            // writeSource deliberately absent.
        }));
        return app;
    };

    it("reports itself unavailable rather than enabled", async () => {
        const res = await withoutWriteSource().fetch(
            new Request("http://localhost/api/schema/status")
        );
        expect(await res.json()).toMatchObject({
            enabled: false,
            code: "SCHEMA_EDITOR_MISSING_DEPENDENCY",
            // Planning needs no source rewrite, so it is still on offer.
            canPlan: true
        });
    });

    it("turns a failure between the check and the commit into a refusal, not a 500", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => { c.set("user", PERSON as never); await next(); });
        app.route("/api/schema", createLiveSchemaRoutes({
            getCollections: () => [collection("posts")],
            getAdmin: () => ({
                planSchemaChange: async () => okPlan(),
                executeSql: async () => ({ rows: [] })
            } as unknown as DatabaseAdmin),
            getRepository: () => ({
                root: "/tmp/project",
                currentBranch: async () => "main",
                dirtyPaths: async () => [],
                writeFiles: async () => {},
                commit: async () => "abc"
            }),
            sourcePathsFor: () => ["config/collections/posts.ts"],
            writeSource: async () => { throw new Error("posts.ts could not be parsed"); }
        }));

        const res = await app.fetch(new Request("http://localhost/api/schema/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(change)
        }));

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
            error: { code: "SCHEMA_CHANGE_FAILED", message: "posts.ts could not be parsed" }
        });
    });
});


/**
 * The id becomes a filename, so the boundary is where it gets checked.
 *
 * `<collectionsDir>/<id>.ts` is derived in two places: the AST editor, which
 * sanitises before it writes, and the caller, which derives the same path
 * *first* so the dirty check knows what is about to be touched. Only the editor
 * checked. A refusal that arrives one layer in is a refusal the layer above has
 * already acted on.
 */
describe("the collection id", () => {
    it.each([
        ["a parent traversal", "../../../etc/passwd"],
        ["a nested path", "nested/collection"],
        ["an absolute path", "/etc/passwd"],
        ["a null byte", "posts\u0000.ts"],
        ["a space", "my collection"],
        ["only whitespace", "   "],
        ["a dot", "."]
    ])("refuses %s", async (_label, collectionId) => {
        const { post, events } = harness();
        const res = await post("/apply", { collectionId, collection: { name: "X" } });

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_CHANGE" } });
        // Refused before anything is planned, let alone written.
        expect(events).toEqual([]);
    });

    it("refuses it on /plan too, which also derives the path", async () => {
        const { post } = harness();
        const res = await post("/plan", { collectionId: "../escape", collection: {} });
        expect(res.status).toBe(400);
    });

    it("accepts the ids a scaffold actually produces", async () => {
        for (const id of ["posts", "blog_posts", "order-items", "Products2"]) {
            const { post } = harness();
            const res = await post("/plan", { collectionId: id, collection: { name: id } });
            expect(res.status).toBe(200);
        }
    });
});


/**
 * A project that replays migrations needs this change recorded as one.
 *
 * Live editing cannot write a migration: that is Atlas's format with an
 * integrity file, minted by an external binary against a throwaway database,
 * and a running server has neither. What it *does* write is
 * `drizzle/schema.sql`, which is exactly what `rebase db generate` diffs
 * against — so the migration is one command away, and the only real hazard is
 * nobody saying so. A project that deploys by replaying migrations would build
 * its next environment without this change, having been told it was applied.
 */
describe("a project that keeps versioned migrations", () => {
    const withMigrations = (usesMigrations: boolean) => harness({
        usesVersionedMigrations: () => usesMigrations
    } as never);

    it("says what still has to be done, on the plan", async () => {
        const { post } = withMigrations(true);
        const body = await (await post("/plan", change)).json() as { followUp: string[] };
        expect(body.followUp).toHaveLength(1);
        expect(body.followUp[0]).toContain("rebase db generate");
    });

    it("says it again on the result, where the person who applied will see it", async () => {
        const { post } = withMigrations(true);
        const body = await (await post("/apply", change)).json() as { followUp: string[] };
        expect(body.followUp[0]).toContain("rebase db generate");
    });

    it("stays quiet for a project that does not keep them", async () => {
        const { post } = withMigrations(false);
        const body = await (await post("/plan", change)).json() as { followUp: string[] };
        expect(body.followUp).toEqual([]);
    });

    it("stays quiet when the change needs no DDL at all", async () => {
        // Nothing ran against the database, so there is nothing to record.
        const { post } = harness({
            usesVersionedMigrations: () => true,
            plan: okPlan({ statements: [] })
        } as never);
        const body = await (await post("/plan", change)).json() as { followUp: string[] };
        expect(body.followUp).toEqual([]);
    });
});
