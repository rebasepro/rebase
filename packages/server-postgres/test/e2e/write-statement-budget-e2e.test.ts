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

const collections = [authorsCollection, tagsCollection, commentsCollection, postsCollection, notesCollection] as unknown as CollectionConfig[];

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
