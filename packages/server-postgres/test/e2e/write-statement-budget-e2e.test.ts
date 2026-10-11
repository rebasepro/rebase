/**
 * E2E: what a write costs, in statements, and that the cheap version still
 * answers exactly what the expensive one did.
 *
 * The REST update and delete routes used to read the row in a transaction of
 * their own before writing it, through the admin's view-model walk — which
 * loads every declared relation of the row. A `PATCH /posts/:id {title}` on a
 * post with 200,000 comments loaded all of them (0.9 s, 147 MB of heap) to
 * learn that the post existed, then threw them away; the write's own read of
 * the row then made the same lookup again. The bulk update, `_batch` update
 * and the history routes did the same.
 *
 * The statement log is the guard: a write must not read a table it does not
 * write, and must run in one transaction. The answers are the other half —
 * the 404 for a missing row and for a row the caller's policies hide, the 412
 * for a stale `If-Match`, the same bodies as before — and a conditional write
 * now holds: two writes carrying one tag cannot both pass.
 *
 * Nothing is faked: the real boot creates the tables and their policies, the
 * real REST generator serves the routes, and every request runs as a user
 * under the restricted role.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import { createHistoryRoutes } from "../../../server/src/history/history-routes.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { HistoryService } from "../../src/history/HistoryService.js";
import { ensureHistoryIndexes } from "../../src/history/ensure-history-table.js";
import { MetricsRegistry } from "../../../server/src/metrics/index.js";
import { recordPoolWaits } from "../../../server/src/metrics/pool-wait.js";

// ── statement capture ──────────────────────────────────────────────────────
//
// Every query any pooled client sends, while a capture is open. The pool's
// clients are `pg.Client`s, so the prototype is the one place they all pass.
let captured: string[] | undefined;
const originalQuery = pg.Client.prototype.query;
(pg.Client.prototype as unknown as { query: unknown }).query = function (this: unknown, config: unknown, ...rest: unknown[]) {
    if (captured) {
        const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "";
        captured.push(text.replace(/\s+/g, " ").trim());
    }
    return (originalQuery as (...args: unknown[]) => unknown).call(this, config, ...rest);
};

/** The statements `run` sends, including the ones it leaves to run after it answers. */
async function statementsOf<T>(run: () => Promise<T>): Promise<{ result: T; statements: string[] }> {
    captured = [];
    try {
        const result = await run();
        // History's fire-and-forget pruning lands after the answer.
        await new Promise(resolve => setTimeout(resolve, 200));
        return { result, statements: captured };
    } finally {
        captured = undefined;
    }
}

const reads = (statements: string[], table: string) =>
    statements.filter(s => /^select/i.test(s) && new RegExp(`from "?(public"?\\.)?"?${table}"?\\b`, "i").test(s));
const begins = (statements: string[]) => statements.filter(s => /^begin/i.test(s));

// ── collections ────────────────────────────────────────────────────────────

const authorsCollection = {
    name: "Authors", slug: "authors", table: "authors",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
};
const tagsCollection = {
    name: "Tags", slug: "tags", table: "tags",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
};
const commentsCollection: Record<string, unknown> = {
    name: "Comments", slug: "comments", table: "comments",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        body: { name: "Body", type: "string" }
    }
};

/**
 * `beforeSave` waits on this when a test sets it: a write that is inside its
 * transaction, past its precondition, and not yet committed.
 */
let holdFirstSave: Promise<void> | undefined;

const postsCollection: Record<string, unknown> = {
    name: "Posts", slug: "posts", table: "posts", history: true,
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        updatedAt: { name: "Updated", type: "date", autoValue: "on_update" },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authorsCollection, localKey: "author_id" } },
        tags: {
            name: "Tags", type: "relation", relation: {
                kind: "manyToMany", target: () => tagsCollection,
                through: { table: "post_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }
        },
        comments: { name: "Comments", type: "relation", relation: { kind: "hasMany", target: () => commentsCollection, foreignKeyOnTarget: "post_id" } }
    },
    callbacks: {
        beforeSave: async ({ values }: { values: Record<string, unknown> }) => {
            const hold = holdFirstSave;
            holdFirstSave = undefined;
            if (hold) await hold;
            return values;
        }
    }
};
(commentsCollection.properties as Record<string, unknown>).post = {
    name: "Post", type: "relation", relation: { kind: "belongsTo", target: () => postsCollection, localKey: "post_id" }
};

/** Rows only their owner can see: the RLS-invisible case. */
const notesCollection = {
    name: "Notes", slug: "notes", table: "notes",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
        { name: "owner_update", operation: "update", ownerField: "ownerId" },
        { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id" },
        text: { name: "Text", type: "string" }
    }
};

/** A child collection whose `beforeQuery` hides some rows from everybody. */
const tasksCollection: Record<string, unknown> = {
    name: "Tasks", slug: "tasks", table: "tasks",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        hidden: { name: "Hidden", type: "boolean" }
    },
    callbacks: {
        beforeQuery: () => ({ filter: { hidden: ["==", false] } })
    }
};
const projectsCollection = {
    name: "Projects", slug: "projects", table: "projects",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        tasks: { name: "Tasks", type: "relation", relation: { kind: "hasMany", target: () => tasksCollection, foreignKeyOnTarget: "project_id" } }
    }
};
(tasksCollection.properties as Record<string, unknown>).project = {
    name: "Project", type: "relation", relation: { kind: "belongsTo", target: () => projectsCollection, localKey: "project_id" }
};

/** A many-to-many whose links carry columns of their own. */
const membersCollection = {
    name: "Members", slug: "members", table: "members",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
};
const teamsCollection = {
    name: "Teams", slug: "teams", table: "teams",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        members: {
            name: "Members", type: "relation", relation: {
                kind: "manyToMany", target: () => membersCollection,
                through: {
                    table: "team_members", sourceColumn: "team_id", targetColumn: "member_id",
                    properties: {
                        role: { name: "Role", type: "string" },
                        rank: { name: "Rank", type: "number" }
                    }
                }
            }
        }
    }
};

/**
 * Every kind of column a create answers with: a generated key, a declared
 * default, numbers, a boolean, dates (one the server stamps), an array, a map,
 * a foreign key, a soft-delete column and a search index column the API never
 * serves — so that the INSERT's own row and a read of the row can be compared
 * byte for byte.
 */
const eventsCollection = {
    name: "Events", slug: "events", table: "events",
    softDelete: true,
    search: { fields: ["title"] },
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", defaultValue: "draft" },
        seats: { name: "Seats", type: "number" },
        ratio: { name: "Ratio", type: "number" },
        open: { name: "Open", type: "boolean" },
        startsAt: { name: "Starts", type: "date" },
        createdAt: { name: "Created", type: "date", autoValue: "on_create" },
        deletedAt: { name: "Deleted", type: "date" },
        labels: { name: "Labels", type: "array", of: { name: "Label", type: "string" } },
        details: { name: "Details", type: "map", properties: { room: { name: "Room", type: "string" } } },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authorsCollection, localKey: "author_id" } }
    }
};

/** A row anyone may add and nobody may read back: an insert-only policy. */
const dropboxCollection = {
    name: "Dropbox", slug: "dropbox", table: "dropbox",
    securityRules: [{ name: "anyone_inserts", operation: "insert", access: "public" }],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        text: { name: "Text", type: "string" }
    }
};

/** Anyone may write a letter to anyone; only its addressee reads it. */
const lettersCollection = {
    name: "Letters", slug: "letters", table: "letters",
    securityRules: [
        { name: "anyone_writes", operation: "insert", access: "public" },
        { name: "addressee_reads", operation: "select", ownerField: "toId" }
    ],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        toId: { name: "To", type: "string", columnName: "to_id" },
        text: { name: "Text", type: "string" }
    }
};

/** A field only admins may read: the read back is projected per viewer. */
const badgesCollection = {
    name: "Badges", slug: "badges", table: "badges",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        label: { name: "Label", type: "string" },
        secret: { name: "Secret", type: "string", access: { read: ["admin"] } }
    }
};

/** How long `drafts`' `beforeSave` awaits, when a test sets it: a hook calling something slow. */
let draftHookMs = 0;
const draftsCollection = {
    name: "Drafts", slug: "drafts", table: "drafts",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" }
    },
    callbacks: {
        beforeSave: async ({ values }: { values: Record<string, unknown> }) => {
            if (draftHookMs > 0) await new Promise(resolve => setTimeout(resolve, draftHookMs));
            return values;
        }
    }
};

const collections = [
    authorsCollection, tagsCollection, commentsCollection, postsCollection, notesCollection, tasksCollection, projectsCollection,
    membersCollection, teamsCollection, eventsCollection, dropboxCollection, lettersCollection, badgesCollection, draftsCollection
] as unknown as CollectionConfig[];

const ADMIN = { uid: "admin-1", roles: ["admin"] };
const STRANGER = { uid: "stranger-1", roles: [] as string[] };
const OWNER = "owner-1";
const CHILDREN = 300;

describe("a write's statements (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;

    async function http(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; as?: typeof ADMIN } = {}) {
        const response = await app.request(`/api/data${path}`, {
            method,
            headers: {
                ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
                ...(options.as === STRANGER ? { "x-test-user": "stranger" } : {}),
                ...options.headers
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
        const text = await response.text();
        return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : undefined };
    }

    async function newPost(title: string, children = 0): Promise<number> {
        const { rows } = await admin.query<{ id: number }>("INSERT INTO public.posts (title, author_id) VALUES ($1, 1) RETURNING id", [title]);
        const id = rows[0].id;
        if (children > 0) {
            await admin.query(
                "INSERT INTO public.comments (body, post_id) SELECT 'c' || g, $1 FROM generate_series(1, $2) g",
                [id, children]
            );
            await admin.query("INSERT INTO public.post_tags (post_id, tag_id) SELECT $1, id FROM public.tags", [id]);
        }
        return id;
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app: new Hono() as never,
            server: createServer(),
            collections,
            history: true,
            database: createPostgresAdapter({
                connection: connection.db,
                connectionString: container.connectionString
            })
        } as never);

        const driver = backend.driver as DataDriver & { withAuth(user: { uid: string; roles: string[] }): Promise<DataDriver> };
        const historyService = backend.history?.historyService;
        app.onError(errorHandler);
        app.use("/api/data/*", async (c, next) => {
            const user = c.req.header("x-test-user") === "stranger" ? STRANGER : ADMIN;
            c.set("user", user as never);
            c.set("driver", await driver.withAuth(user) as never);
            await next();
        });
        if (historyService) {
            app.route("/api/data", createHistoryRoutes({ historyService, registry: backend.collectionRegistry, driver }));
        }
        app.route("/api/data", new RestApiGenerator(collections, driver).generateRoutes());

        await admin.query("INSERT INTO public.authors (name) VALUES ('Ada')");
        await admin.query("INSERT INTO public.tags (name) SELECT 'tag ' || g FROM generate_series(1, 20) g");
    }, 180_000);

    afterAll(async () => {
        (pg.Client.prototype as unknown as { query: unknown }).query = originalQuery;
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    describe("an update or a delete of a parent reads none of its children", () => {
        it("PATCH /posts/:id: one transaction, no read of comments, tags or authors", async () => {
            const id = await newPost("before", CHILDREN);
            const { result, statements } = await statementsOf(() => http("PATCH", `/posts/${id}`, { body: { title: "after" } }));

            expect(result.status).toBe(200);
            expect(result.json.title).toBe("after");
            expect(reads(statements, "comments")).toEqual([]);
            expect(reads(statements, "post_tags")).toEqual([]);
            expect(reads(statements, "authors")).toEqual([]);
            expect(begins(statements)).toHaveLength(1);
        });

        it("DELETE /posts/:id: one transaction, no read of comments, tags or authors", async () => {
            const id = await newPost("doomed", CHILDREN);
            await admin.query("UPDATE public.comments SET post_id = NULL WHERE post_id = $1", [id]);
            await admin.query("DELETE FROM public.post_tags WHERE post_id = $1", [id]);
            await admin.query("INSERT INTO public.comments (body, post_id) SELECT 'orphan', NULL FROM generate_series(1, 10)");
            const { result, statements } = await statementsOf(() => http("DELETE", `/posts/${id}`));

            expect(result.status).toBe(204);
            expect(reads(statements, "comments")).toEqual([]);
            expect(reads(statements, "authors")).toEqual([]);
            expect(begins(statements)).toHaveLength(1);
        });

        it("PATCH /posts/bulk and a _batch update read no children", async () => {
            const id = await newPost("bulk", CHILDREN);
            const bulk = await statementsOf(() => http("PATCH", "/posts/bulk", { body: { updates: [{ id, data: { title: "bulk 2" } }] } }));
            expect(bulk.result.status).toBe(200);
            expect(reads(bulk.statements, "comments")).toEqual([]);

            const batch = await statementsOf(() => http("POST", "/_batch", {
                body: { operations: [{ op: "update", collection: "posts", id, values: { title: "batch" } }] }
            }));
            expect(batch.result.status).toBe(200);
            expect(reads(batch.statements, "comments")).toEqual([]);
        });

        it("the history list reads no children", async () => {
            const id = await newPost("history", CHILDREN);
            await http("PATCH", `/posts/${id}`, { body: { title: "history 2" } });
            const { result, statements } = await statementsOf(() => http("GET", `/posts/${id}/history`));
            expect(result.status).toBe(200);
            expect(result.json.data.length).toBeGreaterThan(0);
            expect(reads(statements, "comments")).toEqual([]);
        });
    });

    describe("a write with no hook pays for no hook", () => {
        const savepoints = (statements: string[]) => statements.filter(s => /^savepoint/i.test(s));
        const commitChecks = (statements: string[]) => statements.filter(s => /^select 1$/i.test(s));

        it("a create runs no savepoint and no pre-commit check", async () => {
            const { result, statements } = await statementsOf(() => http("POST", "/authors", { body: { name: "Grace" } }));
            expect(result.status).toBe(201);
            expect(savepoints(statements)).toEqual([]);
            expect(commitChecks(statements)).toEqual([]);
        });

        it("a bulk create of 50 rows opens one savepoint for the batch, not one per row", async () => {
            const rows = Array.from({ length: 50 }, (_, i) => ({ name: `bulk ${i}` }));
            const { result, statements } = await statementsOf(() => http("POST", "/authors/bulk", { body: { rows } }));
            expect(result.status).toBe(200);
            expect(savepoints(statements).length).toBeLessThanOrEqual(1);
            expect(commitChecks(statements)).toEqual([]);
        });

        it("a write whose collection has a hook still asks the transaction before committing", async () => {
            const id = await newPost("hooked");
            const { result, statements } = await statementsOf(() => http("PATCH", `/posts/${id}`, { body: { title: "hooked 2" } }));
            expect(result.status).toBe(200);
            expect(commitChecks(statements)).toHaveLength(1);
        });
    });

    describe("a create answers with the row its INSERT returned", () => {
        const inserts = (statements: string[], table: string) =>
            statements.filter(s => new RegExp(`^insert into "?(public"?\\.)?"?${table}"?\\b`, "i").test(s));

        it("reads nothing back, and answers exactly what a read of the row answers", async () => {
            const body = {
                title: "Launch", seats: 120, ratio: 0.25, open: true, startsAt: "2026-10-07T09:30:00.000Z",
                labels: ["a", "b"], details: { room: "Hall 2" }, author: 1
            };
            const { result, statements } = await statementsOf(() => http("POST", "/events", { body }));
            expect(result.status).toBe(201);
            expect(reads(statements, "events")).toEqual([]);

            const read = await http("GET", `/events/${result.json.id}`);
            expect(read.status).toBe(200);
            expect(JSON.stringify(result.json)).toBe(JSON.stringify(read.json));
            // What was declared and what the server stamped are both there.
            expect(result.json.status).toBe("draft");
            expect(typeof result.json.createdAt).toBe("string");
        });

        it("a create of a row already in the trash answers it too", async () => {
            const { result } = await statementsOf(() => http("POST", "/events", { body: { title: "Gone", deletedAt: "2026-10-01T00:00:00.000Z" } }));
            expect(result.status).toBe(201);
            const read = await http("GET", `/events/${result.json.id}?deleted=include`);
            expect(JSON.stringify(result.json)).toBe(JSON.stringify(read.json));
        });

        it("a bulk create of 50 rows sends one statement per row", async () => {
            const rows = Array.from({ length: 50 }, (_, i) => ({ name: `returned ${i}` }));
            const { result, statements } = await statementsOf(() => http("POST", "/authors/bulk", { body: { rows } }));
            expect(result.status).toBe(200);
            expect(inserts(statements, "authors")).toHaveLength(50);
            expect(reads(statements, "authors")).toEqual([]);
            expect(statements.length).toBeLessThanOrEqual(50 + 6);
            expect(result.json.data.map((row: { name: string }) => row.name)).toEqual(rows.map(row => row.name));
        });

        it("still reads the row back when the collection has a beforeQuery or per-field read access", async () => {
            const scoped = await statementsOf(() => http("POST", "/tasks", { body: { title: "scoped", hidden: false } }));
            expect(scoped.result.status).toBe(201);
            expect(reads(scoped.statements, "tasks")).toHaveLength(1);
            await admin.query("DELETE FROM public.tasks WHERE id = $1", [scoped.result.json.id]);

            const restricted = await statementsOf(() => http("POST", "/badges", { body: { label: "gold", secret: "s3" } }));
            expect(restricted.result.status).toBe(201);
            expect(reads(restricted.statements, "badges")).toHaveLength(1);
            expect(restricted.result.json.secret).toBe("s3");
        });

        it("a policy that lets a caller write a row it may not read refuses the create, as it did", async () => {
            const dropped = await http("POST", "/dropbox", { body: { text: "anonymous tip" }, as: STRANGER });
            expect(dropped.status).toBe(403);
            expect(dropped.json.error).toEqual({
                code: "WRITE_DENIED",
                message: "Not permitted to write this row in \"dropbox\": it does not satisfy the row-level security policy."
            });
            const { rows } = await admin.query("SELECT count(*)::int AS n FROM public.dropbox");
            expect(rows).toEqual([{ n: 0 }]);

            const toSomeoneElse = await http("POST", "/letters", { body: { toId: OWNER, text: "hello" }, as: STRANGER });
            expect(toSomeoneElse.status).toBe(403);
            expect(toSomeoneElse.json.error).toEqual({
                code: "WRITE_DENIED",
                message: "Not permitted to write this row in \"letters\": it does not satisfy the row-level security policy."
            });
        });

        it("a row the policies let the caller read back is answered as their read of it", async () => {
            const own = await statementsOf(() => http("POST", "/letters", { body: { toId: STRANGER.uid, text: "note to self" }, as: STRANGER }));
            expect(own.result.status).toBe(201);
            expect(reads(own.statements, "letters")).toEqual([]);
            const read = await http("GET", `/letters/${own.result.json.id}`, { as: STRANGER });
            expect(JSON.stringify(own.result.json)).toBe(JSON.stringify(read.json));
        });
    });

    describe("a hasMany membership write", () => {
        /** Each child's row version: an UPDATE, even one that changes nothing, gives it a new one. */
        const versions = async (postId: number) => (await admin.query<{ id: number; xmin: string }>(
            "SELECT id, xmin::text FROM public.comments WHERE post_id = $1 ORDER BY id", [postId]
        )).rows;

        it("re-sending the children a post already has rewrites none of them", async () => {
            const id = await newPost("resend", 25);
            const before = await versions(id);
            const answer = await http("PATCH", `/posts/${id}`, { body: { title: "resend 2", comments: before.map(row => row.id) } });
            expect(answer.status).toBe(200);
            expect(await versions(id)).toEqual(before);
        });

        it("still links a new child and unlinks a dropped one", async () => {
            const id = await newPost("membership", 3);
            const [kept, , dropped] = (await versions(id)).map(row => row.id);
            const { rows } = await admin.query<{ id: number }>("INSERT INTO public.comments (body) VALUES ('new') RETURNING id");
            const added = rows[0].id;
            const answer = await http("PATCH", `/posts/${id}`, {
                body: { comments: (await versions(id)).map(row => row.id).filter(c => c !== dropped).concat(added) }
            });
            expect(answer.status).toBe(200);
            const now = (await versions(id)).map(row => row.id);
            expect(now).toContain(kept);
            expect(now).toContain(added);
            expect(now).not.toContain(dropped);
        });

        it("does not take a child the target's beforeQuery hides from another parent", async () => {
            const { rows: projects } = await admin.query<{ id: number }>(
                "INSERT INTO public.projects (name) VALUES ('mine'), ('theirs') RETURNING id"
            );
            const [mine, theirs] = projects.map(row => row.id);
            const { rows: tasks } = await admin.query<{ id: number }>(
                "INSERT INTO public.tasks (title, hidden, project_id) VALUES ('open', false, NULL), ('secret', true, $1) RETURNING id",
                [theirs]
            );
            const [open, secret] = tasks.map(row => row.id);

            const answer = await http("PATCH", `/projects/${mine}`, { body: { tasks: [open, secret] } });
            expect(answer.status).toBe(200);
            const { rows } = await admin.query("SELECT id, project_id FROM public.tasks ORDER BY id");
            expect(rows).toEqual([{ id: open, project_id: mine }, { id: secret, project_id: theirs }]);
        });
    });

    describe("a many-to-many write whose links carry columns", () => {
        const junctionUpdates = (statements: string[]) => statements.filter(s => /^update "?team_members"?/i.test(s));

        it("updates only the links whose columns changed", async () => {
            const { rows: teams } = await admin.query<{ id: number }>("INSERT INTO public.teams (name) VALUES ('core') RETURNING id");
            const team = teams[0].id;
            const { rows: members } = await admin.query<{ id: number }>(
                "INSERT INTO public.members (name) SELECT 'm' || g FROM generate_series(1, 20) g RETURNING id"
            );
            await admin.query(
                "INSERT INTO public.team_members (team_id, member_id, role, rank) SELECT $1, id, 'member', id FROM public.members WHERE id = ANY($2)",
                [team, members.map(row => row.id)]
            );
            const links = members.map(row => ({ id: row.id, _pivot: { role: "member", rank: row.id } }));

            const unchanged = await statementsOf(() => http("PATCH", `/teams/${team}`, { body: { members: links } }));
            expect(unchanged.result.status).toBe(200);
            expect(junctionUpdates(unchanged.statements)).toEqual([]);

            const promoted = links.map((link, i) => i === 3 ? { ...link, _pivot: { role: "admin", rank: link._pivot.rank } } : link);
            const oneChanged = await statementsOf(() => http("PATCH", `/teams/${team}`, { body: { members: promoted } }));
            expect(oneChanged.result.status).toBe(200);
            expect(junctionUpdates(oneChanged.statements)).toHaveLength(1);
            const { rows } = await admin.query(
                "SELECT member_id, role FROM public.team_members WHERE team_id = $1 AND role <> 'member'", [team]
            );
            expect(rows).toEqual([{ member_id: members[3].id, role: "admin" }]);
        });
    });

    describe("an upsert that meets a stored row", () => {
        it("reads the row once before writing it, and hands the hooks and history the same previous values", async () => {
            const patched = await newPost("twin");
            const upserted = await newPost("twin");

            const patch = await http("PATCH", `/posts/${patched}`, { body: { title: "twin 2" } });
            expect(patch.status).toBe(200);
            const { result, statements } = await statementsOf(() =>
                http("POST", "/posts?on_conflict=id", { body: { id: upserted, title: "twin 2" } }));
            expect(result.status).toBeLessThan(300);
            expect(result.json.title).toBe("twin 2");
            // One read to find the row, one read back after the write: not a
            // second read of the row the first one already found.
            expect(reads(statements, "posts")).toHaveLength(2);

            const { rows } = await admin.query<{ entity_id: string; previous_values: Record<string, unknown> }>(
                `SELECT entity_id, previous_values FROM rebase.entity_history
                  WHERE table_name = 'posts' AND entity_id = ANY($1) AND action = 'update'`,
                [[String(patched), String(upserted)]]
            );
            // The two rows differ only in their key and in the instant each
            // was stamped; the rendering of every column must be the same.
            const previous = (id: number) => {
                const { id: _id, updatedAt, ...rest } = rows.find(row => row.entity_id === String(id))!.previous_values;
                return { ...rest, updatedAt: typeof updatedAt };
            };
            expect(previous(upserted)).toEqual(previous(patched));
        });
    });

    describe("history pruning after a write", () => {
        const prunes = (statements: string[]) => statements.filter(s => /^delete from rebase\.entity_history/i.test(s));

        async function seedHistory(entityId: string, expired: number, fresh: number): Promise<string[]> {
            await admin.query(
                `INSERT INTO rebase.entity_history (table_name, entity_id, action, updated_at)
                 SELECT 'pruned', $1, 'update', NOW() - INTERVAL '3 days' - g * INTERVAL '1 minute' FROM generate_series(1, $2) g`,
                [entityId, expired]
            );
            const { rows } = await admin.query<{ id: string }>(
                `INSERT INTO rebase.entity_history (table_name, entity_id, action, updated_at)
                 SELECT 'pruned', $1, 'update', NOW() - g * INTERVAL '1 minute' FROM generate_series(1, $2) g
                 RETURNING id`,
                [entityId, fresh]
            );
            return rows.map(row => row.id);
        }
        const remaining = async (entityId: string) => (await admin.query<{ id: string }>(
            "SELECT id FROM rebase.entity_history WHERE table_name = 'pruned' AND entity_id = $1", [entityId]
        )).rows.map(row => row.id).sort();

        it("is one statement, and keeps exactly the newest entries inside the retention period", async () => {
            const service = new HistoryService(connection.db as never, { maxEntries: 5, ttlDays: 1 });

            // More fresh entries than the cap: the expired ones and the oldest fresh ones go.
            const fresh = await seedHistory("crowded", 3, 8);
            const crowded = await statementsOf(() => service.pruneEntity("pruned", "crowded"));
            expect(prunes(crowded.statements)).toHaveLength(1);
            expect(crowded.result).toBe(6);
            expect(await remaining("crowded")).toEqual(fresh.slice(0, 5).sort());

            // Fewer than the cap: only the expired ones go.
            const few = await seedHistory("sparse", 3, 2);
            const sparse = await statementsOf(() => service.pruneEntity("pruned", "sparse"));
            expect(prunes(sparse.statements)).toHaveLength(1);
            expect(sparse.result).toBe(3);
            expect(await remaining("sparse")).toEqual([...few].sort());
        });
    });

    describe("write callbacks and the connection pool", () => {
        /** Checkouts that waited longer than `ms`, from the histogram's text. */
        const slowerThan = (text: string, ms: number) => {
            const count = Number(text.match(/rebase_db_pool_wait_ms_count\{source="default"\} (\d+)/)?.[1] ?? 0);
            const within = Number(text.match(new RegExp(`rebase_db_pool_wait_ms_bucket\\{source="default",le="${ms}"\\} (\\d+)`))?.[1] ?? 0);
            return { count, slower: count - within };
        };

        it("a read queued behind connections that slow beforeSave hooks hold is measured, by the pool-wait histogram", async () => {
            const registry = new MetricsRegistry();
            recordPoolWaits(registry, [{ key: "default", connection: { pool: connection.pool } }]);

            // The real driver's checkouts — the request's transaction — are timed.
            expect((await http("GET", "/authors?limit=1")).status).toBe(200);
            expect(slowerThan(registry.render(), 100).count).toBeGreaterThan(0);

            // More saves than the pool has connections (20), each holding its
            // connection for the 300 ms its beforeSave awaits.
            draftHookMs = 300;
            try {
                const saves = Array.from({ length: 25 }, (_, i) => http("POST", "/drafts", { body: { title: `draft ${i}` } }));
                await new Promise(resolve => setTimeout(resolve, 50));
                const started = performance.now();
                const read = await http("GET", "/authors?limit=1");
                const waited = performance.now() - started;
                expect((await Promise.all(saves)).every(save => save.status === 201)).toBe(true);

                expect(read.status).toBe(200);
                // The read did nothing slow itself; it waited for a connection.
                expect(waited).toBeGreaterThan(100);
                expect(slowerThan(registry.render(), 100).slower).toBeGreaterThan(0);
            } finally {
                draftHookMs = 0;
            }
        });
    });

    describe("a history entry of an update", () => {
        type Stored = { id: string; format: number; changed_fields: string[]; values: Record<string, unknown>; previous_values: Record<string, unknown>; previous_bytes: number; values_bytes: number };
        const updateEntries = async (id: number) => (await admin.query<Stored>(
            `SELECT id, format, changed_fields, "values", previous_values,
                    pg_column_size(previous_values) AS previous_bytes, pg_column_size("values") AS values_bytes
             FROM rebase.entity_history WHERE table_name = 'posts' AND entity_id = $1 AND action = 'update'
             ORDER BY updated_at`,
            [String(id)]
        )).rows;

        it("keeps the previous values of the changed fields only, and says so", async () => {
            const id = await newPost("first draft");
            const answer = await http("PATCH", `/posts/${id}`, { body: { title: "second draft" } });
            expect(answer.status).toBe(200);

            const [entry] = await updateEntries(id);
            expect(entry.format).toBe(2);
            // Nothing outside the changed fields — and the key, which no
            // update changes, is not one of them.
            expect(entry.changed_fields).not.toContain("id");
            expect(Object.keys(entry.previous_values).every(key => entry.changed_fields.includes(key))).toBe(true);
            expect(Object.keys(entry.previous_values).sort()).toEqual(["title", "updatedAt"]);
            expect(entry.previous_values.title).toBe("first draft");
            // The rest of the row is in `values`, once.
            expect(entry.values.title).toBe("second draft");
            expect(Object.keys(entry.values).length).toBeGreaterThan(Object.keys(entry.previous_values).length);
            expect(entry.previous_bytes).toBeLessThan(entry.values_bytes);

            const listed = await http("GET", `/posts/${id}/history`);
            expect(listed.json.data[0]).toMatchObject({ format: 2, previous_values: entry.previous_values });
        });

        it("an entry stored whole, before 0.24, is still listed as it was and still reverts", async () => {
            const id = await newPost("kept");
            const before = (await http("GET", `/posts/${id}`)).json;
            await admin.query(
                `INSERT INTO rebase.entity_history (table_name, entity_id, action, changed_fields, "values", previous_values, updated_by, updated_at)
                 VALUES ('posts', $1, 'update', ARRAY['title'], $2::jsonb, $3::jsonb, 'someone', NOW() - INTERVAL '1 hour')`,
                [String(id), JSON.stringify({ ...before, title: "old title" }), JSON.stringify({ ...before, title: "older title" })]
            );
            await http("PATCH", `/posts/${id}`, { body: { title: "newest" } });

            const listed = await http("GET", `/posts/${id}/history`);
            const old = listed.json.data.find((e: { updated_by: string }) => e.updated_by === "someone");
            expect(old.format).toBe(1);
            expect(old.previous_values).toEqual({ ...before, title: "older title" });
            const fresh = listed.json.data.find((e: { updated_by: string; action: string }) => e.updated_by !== "someone" && e.action === "update");
            expect(fresh.format).toBe(2);

            const toOld = await http("POST", `/posts/${id}/history/${old.id}/revert`);
            expect(toOld.status).toBe(200);
            expect((await http("GET", `/posts/${id}`)).json.title).toBe("old title");

            const toFresh = await http("POST", `/posts/${id}/history/${fresh.id}/revert`);
            expect(toFresh.status).toBe(200);
            expect((await http("GET", `/posts/${id}`)).json.title).toBe("newest");
        });
    });

    describe("history retention without a write", () => {
        const historyIndexes = async () => (await admin.query<{ indexname: string }>(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'rebase' AND tablename = 'entity_history' ORDER BY indexname"
        )).rows.map(row => row.indexname);

        it("the sweep deletes every expired entry of every row, in batches, and nothing else", async () => {
            const service = new HistoryService(connection.db as never, { maxEntries: 200, ttlDays: 1 });
            // Rows nobody writes again: 12,000 entries past retention, over
            // 4,000 rows, and a few that are not.
            await admin.query(
                `INSERT INTO rebase.entity_history (table_name, entity_id, action, updated_at)
                 SELECT 'abandoned', (g % 4000)::text, 'delete', NOW() - INTERVAL '2 days' - g * INTERVAL '1 second'
                 FROM generate_series(1, 12000) g`
            );
            const { rows: kept } = await admin.query<{ id: string }>(
                `INSERT INTO rebase.entity_history (table_name, entity_id, action, updated_at)
                 SELECT 'abandoned', g::text, 'delete', NOW() - INTERVAL '1 hour' FROM generate_series(1, 5) g RETURNING id`
            );

            const sweep = await statementsOf(() => service.pruneExpired());

            expect(sweep.result).toBe(12_000);
            // 5,000 + 5,000 + 2,000: one statement per batch, the last one short.
            expect(sweep.statements.filter(s => /^delete from rebase\.entity_history/i.test(s))).toHaveLength(3);
            const { rows } = await admin.query<{ id: string }>("SELECT id FROM rebase.entity_history WHERE table_name = 'abandoned'");
            expect(rows.map(row => row.id).sort()).toEqual(kept.map(row => row.id).sort());
            expect(await service.pruneExpired()).toBe(0);
        });

        it("a sweep asked to stop ends after the batch in flight, and the next one takes the rest", async () => {
            const service = new HistoryService(connection.db as never, { maxEntries: 200, ttlDays: 1 });
            await admin.query(
                `INSERT INTO rebase.entity_history (table_name, entity_id, action, updated_at)
                 SELECT 'interrupted', g::text, 'delete', NOW() - INTERVAL '2 days' FROM generate_series(1, 12000) g`
            );
            const stopping = new AbortController();
            const first = service.pruneExpired({ signal: stopping.signal });
            stopping.abort();
            expect(await first).toBeLessThanOrEqual(5_000);
            expect(await service.pruneExpired()).toBe(12_000 - await first);
        });

        it("is started by the boot: its first hour is claimed", async () => {
            const { rows } = await admin.query("SELECT job_id FROM rebase.cron_claims WHERE job_id = 'rebase:history:retention'");
            expect(rows).toHaveLength(1);
        });

        it("the boot keeps one per-row index and builds the sweep's index in the background", async () => {
            // Built after the boot, concurrently: give it the few seconds it waits.
            for (let i = 0; i < 40 && !(await historyIndexes()).includes("idx_history_updated_at"); i++) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            expect(await historyIndexes()).toEqual(["entity_history_pkey", "idx_history_time", "idx_history_updated_at"]);
            const { rows } = await admin.query<{ valid: boolean }>(
                "SELECT indisvalid AS valid FROM pg_index WHERE indexrelid = 'rebase.idx_history_updated_at'::regclass"
            );
            expect(rows).toEqual([{ valid: true }]);
        });

        it("a database from before drops the redundant index, and a held table keeps it for the next boot", async () => {
            await admin.query("CREATE INDEX IF NOT EXISTS idx_history_entity ON rebase.entity_history (table_name, entity_id)");

            // Something holds the table for longer than the lock budget.
            const holder = new pg.Client({ connectionString: container.connectionString });
            await holder.connect();
            await holder.query("BEGIN");
            await holder.query("LOCK TABLE rebase.entity_history IN ACCESS SHARE MODE");
            try {
                const started = Date.now();
                await ensureHistoryIndexes(connection.db as never, { lockTimeoutMs: 100, attempts: 2, retryBudgetMs: 500, backoffMs: () => 50 });
                expect(Date.now() - started).toBeLessThan(5_000);
                expect(await historyIndexes()).toContain("idx_history_entity");
            } finally {
                await holder.query("ROLLBACK");
                await holder.end();
            }

            expect(await ensureHistoryIndexes(connection.db as never)).toEqual([]);
            expect(await historyIndexes()).toEqual(["entity_history_pkey", "idx_history_time", "idx_history_updated_at"]);
        });
    });

    describe("a batch on the server's own driver", () => {
        it("tells realtime subscribers once the batch has committed, and nothing when it rolls back", async () => {
            type Notify = (path: string, id: string, ...rest: unknown[]) => Promise<void>;
            const driver = backend.driver as unknown as {
                realtimeService: { notifyUpdate: Notify };
                saveMany(props: { path: string; rows: Record<string, unknown>[] }): Promise<unknown>;
            };
            const realtime = driver.realtimeService;
            const original = realtime.notifyUpdate;
            const seen: { id: string; committed: boolean }[] = [];
            realtime.notifyUpdate = async function (this: unknown, path, id, ...rest) {
                if (path === "authors") {
                    // Asked from another connection: what a subscriber's refetch would see.
                    const { rowCount } = await admin.query("SELECT 1 FROM public.authors WHERE id = $1", [Number(id)]);
                    seen.push({ id: String(id), committed: rowCount === 1 });
                }
                return original.call(this, path, id, ...rest);
            };
            try {
                // The change feed may announce the same rows again once they
                // commit; what matters is that no announcement comes earlier.
                await driver.saveMany({ path: "authors", rows: [{ name: "batch a" }, { name: "batch b" }] });
                expect(new Set(seen.map(notice => notice.id)).size).toBe(2);
                expect(seen.every(notice => notice.committed)).toBe(true);

                seen.length = 0;
                await expect(driver.saveMany({
                    path: "authors",
                    rows: [{ id: 990001, name: "first" }, { id: 990001, name: "duplicate key" }]
                })).rejects.toThrow();
                await new Promise(resolve => setTimeout(resolve, 300));
                expect(seen).toEqual([]);
            } finally {
                realtime.notifyUpdate = original;
            }
        });
    });

    describe("the answers stay the same", () => {
        it("a missing row is the route's 404, on PATCH and DELETE", async () => {
            for (const method of ["PATCH", "DELETE"]) {
                const answer = await http(method, "/posts/987654", method === "PATCH" ? { body: { title: "x" } } : {});
                expect(answer.status).toBe(404);
                expect(answer.json.error.code).toBe("NOT_FOUND");
                expect(answer.json.error.message).toBe(
                    "No row with id '987654' in 'posts'. It may not exist, or it may be hidden from this caller by row-level security."
                );
            }
        });

        it("a missing row in a bulk update and a batch keeps its message", async () => {
            const bulk = await http("PATCH", "/posts/bulk", { body: { updates: [{ id: 987654, data: { title: "x" } }] } });
            expect(bulk.status).toBe(404);
            expect(bulk.json.error.message).toContain("No row with id 987654");
            const batch = await http("POST", "/_batch", {
                body: { operations: [{ op: "update", collection: "posts", id: "987654", values: { title: "x" } }] }
            });
            expect(batch.status).toBe(404);
            expect(batch.json.error.message).toContain("No row with id \"987654\"");
        });

        it("a row the caller's policies hide is the same 404, and is not written", async () => {
            const { rows } = await admin.query<{ id: number }>(
                "INSERT INTO public.notes (owner_id, text) VALUES ($1, 'private') RETURNING id", [OWNER]
            );
            const id = rows[0].id;
            for (const method of ["PATCH", "DELETE"]) {
                const answer = await http(method, `/notes/${id}`, { as: STRANGER, ...(method === "PATCH" ? { body: { text: "mine now" } } : {}) });
                expect(answer.status).toBe(404);
                expect(answer.json.error.message).toBe(
                    `No row with id '${id}' in 'notes'. It may not exist, or it may be hidden from this caller by row-level security.`
                );
            }
            const { rows: after } = await admin.query("SELECT text FROM public.notes WHERE id = $1", [id]);
            expect(after).toEqual([{ text: "private" }]);
        });

        it("a stale If-Match is a 412 on PATCH and DELETE, and the current one passes", async () => {
            const id = await newPost("tagged");
            const read = await http("GET", `/posts/${id}`);
            const etag = read.headers.get("etag")!;
            expect(etag).toBeTruthy();

            const first = await http("PATCH", `/posts/${id}`, { body: { title: "v2" }, headers: { "If-Match": etag } });
            expect(first.status).toBe(200);
            const stale = await http("PATCH", `/posts/${id}`, { body: { title: "v3" }, headers: { "If-Match": etag } });
            expect(stale.status).toBe(412);
            expect(stale.json.error.code).toBe("PRECONDITION_FAILED");
            const staleDelete = await http("DELETE", `/posts/${id}`, { headers: { "If-Match": etag } });
            expect(staleDelete.status).toBe(412);

            const current = (await http("GET", `/posts/${id}`)).headers.get("etag")!;
            expect((await http("DELETE", `/posts/${id}`, { headers: { "If-Match": current } })).status).toBe(204);
        });

        it("two writes carrying the same tag cannot both pass", async () => {
            const id = await newPost("contested");
            const etag = (await http("GET", `/posts/${id}`)).headers.get("etag")!;

            // The first write stops inside its transaction, after its
            // precondition and before its commit; the second is sent then.
            let release!: () => void;
            holdFirstSave = new Promise<void>(resolve => { release = resolve; });
            const first = http("PATCH", `/posts/${id}`, { body: { title: "first" }, headers: { "If-Match": etag } });
            await new Promise(resolve => setTimeout(resolve, 300));
            const second = http("PATCH", `/posts/${id}`, { body: { title: "second" }, headers: { "If-Match": etag } });
            await new Promise(resolve => setTimeout(resolve, 300));
            release();

            const statuses = (await Promise.all([first, second])).map(answer => answer.status);
            expect(statuses).toEqual([200, 412]);
            const { rows } = await admin.query("SELECT title FROM public.posts WHERE id = $1", [id]);
            expect(rows).toEqual([{ title: "first" }]);
        });
    });
});
