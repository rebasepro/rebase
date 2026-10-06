/**
 * E2E: what one REST read costs the database — statements per request, and
 * rows sent back by them — on a booted schema, through the routes and the
 * request-scoped driver the auth middleware builds.
 *
 * ## Why this is pinned
 *
 * A read path gets slow one statement at a time, and every one of those
 * statements is correct on its own: a second transaction for the count, a
 * query to re-read foreign keys the rows already carry, a related table read
 * whole and cut down in JavaScript. None of that fails a behaviour test. So
 * this file counts what node-postgres actually sends, at two page sizes:
 *
 * - the count of statements does not grow with the page (no per-row N+1), for
 *   every relation kind and for a nested include;
 * - the count itself stays at the number written here, so an extra round trip
 *   is a red test rather than a slower request nobody profiles;
 * - a per-relation `limit` is applied by Postgres, so the rows that leave the
 *   database are the rows served, not every related row of every parent.
 *
 * The figures in the tables below are the budget. Lowering one is welcome;
 * raising one needs a reason in the commit that does it.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import type { CollectionConfig, DataDriver, User } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";

// ── statement capture ───────────────────────────────────────────────────────

interface Statement {
    text: string;
    /** Rows the statement returned to Node. */
    rows: number;
}

let capturing = false;
let statements: Statement[] = [];

type QueryResultLike = { rowCount?: number | null; rows?: unknown[] } | undefined;
type QueryCallback = (error: unknown, result: QueryResultLike) => void;

const rowsOf = (result: QueryResultLike): number =>
    Array.isArray(result?.rows) ? result.rows.length : (result?.rowCount ?? 0);

const originalQuery = pg.Client.prototype.query;
// Every statement drizzle sends goes through `Client#query`, whether it came
// in through the pool (callback form) or a checked-out transaction client
// (promise form). Both are counted, with the rows each one returned.
pg.Client.prototype.query = function capture(this: pg.Client, ...args: unknown[]) {
    const call = originalQuery as unknown as (this: pg.Client, ...a: unknown[]) => unknown;
    if (!capturing) return call.apply(this, args);
    const first = args[0];
    const text = typeof first === "string" ? first : String((first as { text?: unknown })?.text ?? first);
    const entry: Statement = { text: text.replace(/\s+/g, " ").trim(), rows: 0 };
    statements.push(entry);
    const last = args[args.length - 1];
    if (typeof last === "function") {
        const callback = last as QueryCallback;
        args[args.length - 1] = (error: unknown, result: QueryResultLike) => {
            entry.rows = rowsOf(result);
            callback(error, result);
        };
        return call.apply(this, args);
    }
    const out = call.apply(this, args);
    if (out && typeof (out as Promise<unknown>).then === "function") {
        return (out as Promise<QueryResultLike>).then((result) => {
            entry.rows = rowsOf(result);
            return result;
        });
    }
    return out;
} as typeof pg.Client.prototype.query;

// ── collections ─────────────────────────────────────────────────────────────

const companies = {
    name: "Companies", slug: "companies", table: "companies",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

const authors: CollectionConfig = {
    name: "Authors", slug: "authors", table: "authors",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        company: { name: "Company", type: "relation", relation: { kind: "belongsTo", target: () => companies, localKey: "company_id" } },
        // A one-step `via` whose last `to` is a foreign key, not the target's key.
        writings: {
            name: "Writings", type: "relation",
            relation: {
                kind: "via", target: () => posts, cardinality: "many",
                joinPath: [{ table: "posts", on: { from: "id", to: "author_id" } }]
            }
        }
    }
} as unknown as CollectionConfig;

const tags = {
    name: "Tags", slug: "tags", table: "tags",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

const comments: CollectionConfig = {
    name: "Comments", slug: "comments", table: "comments",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        body: { name: "Body", type: "string" },
        createdAt: { name: "Created", type: "date", columnName: "created_at" },
        post: { name: "Post", type: "relation", relation: { kind: "belongsTo", target: () => posts, localKey: "post_id" } }
    }
} as unknown as CollectionConfig;

const postDetails: CollectionConfig = {
    name: "Post details", slug: "post_details", table: "post_details",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        summary: { name: "Summary", type: "string" },
        post: { name: "Post", type: "relation", relation: { kind: "belongsTo", target: () => posts, localKey: "post_id" } }
    }
} as unknown as CollectionConfig;

const posts: CollectionConfig = {
    name: "Posts", slug: "posts", table: "posts",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        views: { name: "Views", type: "number" },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } },
        comments: { name: "Comments", type: "relation", relation: { kind: "hasMany", target: () => comments, foreignKeyOnTarget: "post_id" } },
        tags: {
            name: "Tags", type: "relation",
            relation: { kind: "manyToMany", target: () => tags, through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }
        },
        detail: { name: "Detail", type: "relation", relation: { kind: "hasOne", target: () => postDetails, foreignKeyOnTarget: "post_id" } },
        // Written in column terms, as the `JoinStep` docs say to.
        company: {
            name: "Company", type: "relation",
            relation: {
                kind: "via", target: () => companies, cardinality: "one",
                joinPath: [
                    { table: "authors", on: { from: "author_id", to: "id" } },
                    { table: "companies", on: { from: "company_id", to: "id" } }
                ]
            }
        }
    }
} as unknown as CollectionConfig;

// A wide to-many pair for the per-relation `limit`: 2,000 messages and 300
// labels under every thread.
const labels = {
    name: "Labels", slug: "labels", table: "labels",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

const messages: CollectionConfig = {
    name: "Messages", slug: "messages", table: "messages",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        body: { name: "Body", type: "string" },
        rank: { name: "Rank", type: "number" },
        thread: { name: "Thread", type: "relation", relation: { kind: "belongsTo", target: () => threads, localKey: "thread_id" } }
    }
} as unknown as CollectionConfig;

const threads: CollectionConfig = {
    name: "Threads", slug: "threads", table: "threads",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        messages: { name: "Messages", type: "relation", relation: { kind: "hasMany", target: () => messages, foreignKeyOnTarget: "thread_id" } },
        labels: {
            name: "Labels", type: "relation",
            relation: { kind: "manyToMany", target: () => labels, through: { table: "threads_labels", sourceColumn: "thread_id", targetColumn: "label_id" } }
        }
    }
} as unknown as CollectionConfig;

const ALL = [companies, authors, tags, comments, postDetails, posts, labels, messages, threads];
const USER = { uid: "query-count-user", roles: ["admin"] } as unknown as User;

const THREADS = 100;
const MESSAGES_PER_THREAD = 2_000;
const LABELS_PER_THREAD = 300;

type Row = Record<string, unknown>;

describe("REST read cost: statements and rows per request (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono();
    const originalNodeEnv = process.env.NODE_ENV;

    /** One request, with every statement it sent. */
    async function measure(path: string): Promise<{ status: number; json: { data?: Row[]; meta?: Row } & Row; statements: Statement[] }> {
        statements = [];
        capturing = true;
        let res: Response;
        let text: string;
        try {
            res = await app.request(`/api/data${path}`);
            text = await res.text();
        } finally {
            capturing = false;
        }
        const captured = statements;
        statements = [];
        if (res.status !== 200) throw new Error(`${path} answered ${res.status}: ${text.slice(0, 500)}`);
        return { status: res.status, json: JSON.parse(text), statements: captured };
    }

    /** The statements that read `table`, by its quoted name in a FROM or JOIN. */
    const reading = (captured: Statement[], table: string) =>
        captured.filter(s => new RegExp(`(from|join) "${table}"`, "i").test(s.text));

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
            collections: ALL,
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString })
        } as never);

        await admin.query(`
            INSERT INTO companies (name) SELECT 'Company ' || g FROM generate_series(1, 5) g;
            INSERT INTO authors (name, company_id) SELECT 'Author ' || g, (g % 5) + 1 FROM generate_series(1, 20) g;
            INSERT INTO tags (name) SELECT 'tag-' || g FROM generate_series(1, 10) g;
            INSERT INTO posts (title, views, author_id) SELECT 'Post ' || g, g % 7, (g % 20) + 1 FROM generate_series(1, 150) g;
            INSERT INTO comments (body, created_at, post_id) SELECT 'c' || c || ' on ' || p, now(), p FROM generate_series(1, 150) p, generate_series(1, 3) c;
            INSERT INTO post_details (summary, post_id) SELECT 'summary ' || g, g FROM generate_series(1, 150) g;
            INSERT INTO posts_tags (post_id, tag_id) SELECT p, ((p + k) % 10) + 1 FROM generate_series(1, 150) p, generate_series(1, 2) k;

            INSERT INTO labels (name) SELECT 'label-' || g FROM generate_series(1, ${LABELS_PER_THREAD}) g;
            INSERT INTO threads (title) SELECT 'Thread ' || g FROM generate_series(1, ${THREADS}) g;
            INSERT INTO messages (body, rank, thread_id)
                SELECT 'm' || m || ' in ' || t, (m * 7919) % 1000, t
                FROM generate_series(1, ${THREADS}) t, generate_series(1, ${MESSAGES_PER_THREAD}) m;
            INSERT INTO threads_labels (thread_id, label_id)
                SELECT t, l FROM generate_series(1, ${THREADS}) t, generate_series(1, ${LABELS_PER_THREAD}) l;
            ANALYZE;
        `);

        const driver = backend.driver as DataDriver & { withAuth(user: User): Promise<DataDriver> };
        app.onError(errorHandler as never);
        app.use("/api/data/*", async (c, next) => {
            c.set("user" as never, USER as never);
            c.set("driver" as never, await driver.withAuth(USER) as never);
            await next();
        });
        app.route("/api/data", new RestApiGenerator(ALL, driver).generateRoutes() as never);
    }, 240_000);

    afterAll(async () => {
        pg.Client.prototype.query = originalQuery;
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    // ── an included row is the target's REST row ─────────────────────────────

    describe("an included row", () => {
        /** Every `{ __type: … }` envelope anywhere under `value`, by path. */
        const envelopes = (value: unknown, path = "$"): string[] => {
            if (Array.isArray(value)) return value.flatMap((item, i) => envelopes(item, `${path}[${i}]`));
            if (value && typeof value === "object") {
                if ("__type" in value) return [path];
                return Object.entries(value).flatMap(([key, item]) => envelopes(item, `${path}.${key}`));
            }
            return [];
        };

        it("carries no admin `{ __type }` envelope, at any depth", async () => {
            const { json } = await measure("/posts?limit=10&orderBy=id:asc&include=author.company,comments,detail,tags,company");
            expect(envelopes(json.data)).toEqual([]);
            const one = await measure("/posts/3?include=comments.post,detail");
            expect(envelopes(one.json)).toEqual([]);
        });

        it("is the same row its own route serves", async () => {
            const { json } = await measure("/posts/4?include=comments,detail,author");
            const comments = json.comments as Row[];
            expect(comments.length).toBeGreaterThan(0);
            for (const comment of comments) {
                const own = await measure(`/comments/${comment.id}`);
                expect(comment).toEqual(own.json);
            }
            expect(json.detail).toEqual((await measure(`/post_details/${(json.detail as Row).id}`)).json);
            expect(json.author).toEqual((await measure(`/authors/${(json.author as Row).id}`)).json);
        });
    });

    // ── `via` on a booted schema ───────────────────────────────────────────

    describe("a `via` relation, written in column terms", () => {
        /** Each post's company, by the join the relation describes. */
        async function companyOfPost(): Promise<Map<number, number>> {
            const { rows } = await admin.query<{ post: number; company: number }>(`
                SELECT p.id AS post, c.id AS company
                FROM posts p JOIN authors a ON a.id = p.author_id JOIN companies c ON c.id = a.company_id
            `);
            return new Map(rows.map(r => [Number(r.post), Number(r.company)]));
        }

        it("loads the related row through `include`", async () => {
            const expected = await companyOfPost();
            const { json } = await measure("/posts?limit=25&orderBy=id:asc&include=company");
            const rows = json.data ?? [];
            expect(rows).toHaveLength(25);
            for (const post of rows) {
                expect(post.company).toMatchObject({ id: expected.get(Number(post.id)) });
            }
        });

        it("loads it on the get-by-id route", async () => {
            const expected = await companyOfPost();
            const { json } = await measure("/posts/7?include=company");
            expect(json.company).toMatchObject({ id: expected.get(7) });
        });

        it("loads a to-many `via`, and its per-parent limit, through `include`", async () => {
            const { json } = await measure(`/authors?limit=5&orderBy=id:asc&include=${encodeURIComponent(JSON.stringify({ writings: { limit: 2, orderBy: "id:desc" } }))}`);
            const { rows } = await admin.query<{ author: number; ids: number[] }>(`
                SELECT author_id AS author, (array_agg(id ORDER BY id DESC))[1:2] AS ids FROM posts GROUP BY author_id
            `);
            const expected = new Map(rows.map(r => [Number(r.author), r.ids.map(Number)]));
            for (const author of json.data ?? []) {
                expect((author.writings as Row[]).map(p => Number(p.id))).toEqual(expected.get(Number(author.id)));
            }
        });

        it("lists a to-many `via` under the parent's nested path", async () => {
            const { rows } = await admin.query<{ id: number }>("SELECT id FROM posts WHERE author_id = 3 ORDER BY id");
            const { json } = await measure("/authors/3/writings?limit=100&orderBy=id:asc");
            expect((json.data ?? []).map(row => Number(row.id))).toEqual(rows.map(r => Number(r.id)));
            expect(json.meta?.total).toBe(rows.length);
        });

        it("lists it under the parent's nested path, with a count that agrees", async () => {
            const expected = await companyOfPost();
            const { json } = await measure("/posts/7/company");
            expect((json.data ?? []).map(row => Number(row.id))).toEqual([expected.get(7)]);
            expect(json.meta?.total).toBe(1);
        });
    });

    // ── a per-relation `limit` is applied by Postgres ──────────────────────

    describe("a to-many include with a limit", () => {
        const limited = (spec: Record<string, unknown>) =>
            `/threads?limit=${THREADS}&orderBy=id:asc&include=${encodeURIComponent(JSON.stringify(spec))}`;

        it("reads at most `limit` messages per thread out of the database (hasMany)", async () => {
            const { json, statements: sent } = await measure(limited({ messages: { limit: 2 } }));

            const rows = json.data ?? [];
            expect(rows).toHaveLength(THREADS);
            for (const thread of rows) expect((thread.messages as Row[]).length).toBe(2);

            // 100 threads × 2,000 messages: the related read returns the 200
            // rows served, not the 200,000 a JavaScript slice would discard.
            const read = reading(sent, "messages");
            expect(read.length).toBeGreaterThan(0);
            expect(read.reduce((sum, s) => sum + s.rows, 0)).toBeLessThanOrEqual(THREADS * 2);
        });

        it("keeps the rows the include's `orderBy` puts first", async () => {
            const { json } = await measure(limited({ messages: { limit: 3, orderBy: "rank:desc" } }));
            const expected = await admin.query<{ thread_id: number; ids: number[] }>(`
                SELECT thread_id, array_agg(id ORDER BY rank DESC, id ASC) AS ids FROM (
                    SELECT id, rank, thread_id,
                           row_number() OVER (PARTITION BY thread_id ORDER BY rank DESC, id ASC) AS rn
                    FROM messages
                ) s WHERE rn <= 3 GROUP BY thread_id ORDER BY thread_id
            `);
            const served = (json.data ?? []).map(thread => (thread.messages as Row[]).map(m => Number(m.id)));
            expect(served).toEqual(expected.rows.map(r => r.ids.map(Number)));
        });

        it("reads at most `limit` labels per thread out of the database (manyToMany)", async () => {
            const { json, statements: sent } = await measure(limited({ labels: { limit: 2 } }));

            const rows = json.data ?? [];
            expect(rows).toHaveLength(THREADS);
            for (const thread of rows) expect((thread.labels as Row[]).length).toBe(2);

            const read = reading(sent, "threads_labels");
            expect(read.length).toBeGreaterThan(0);
            expect(read.reduce((sum, s) => sum + s.rows, 0)).toBeLessThanOrEqual(THREADS * 2);
        });

        it("still loads every related row when no limit is asked for", async () => {
            const { json } = await measure(`/threads?limit=3&orderBy=id:asc&include=labels`);
            for (const thread of json.data ?? []) expect((thread.labels as Row[]).length).toBe(LABELS_PER_THREAD);
        });
    });
});
