/**
 * E2E: the review plugin against a real backend and a real Postgres.
 *
 * - An `rk_live_` key that may only invoke the review function proposes an
 *   update; the live row does not move, and the key cannot write it directly.
 * - An operator approves; the row changes, and a batch approval applies all of
 *   its changes in one transaction or none of them.
 * - On a state-field collection, an agent role setting `status = 'published'`
 *   itself is refused by Postgres row-level security.
 *
 * Everything goes through what the server mounts: the boot, the built-in auth,
 * the API-key middleware, the functions router, the data routes and RLS.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Hono } from "hono";
import { createServer } from "node:http";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "../../../server-postgres/test/e2e/pg-setup.js";
import { createPostgresAdapter } from "../../../server-postgres/src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../../server-postgres/src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";
import { reviewFunction, reviewSecurityRules, type ReviewConfig, type StagedChange, type StateFieldReview } from "../../src/server/index.js";

const JWT_SECRET = "review-plugin-e2e-secret-that-is-long-enough-0123456789";

const postsReview: StateFieldReview = {
    mode: "state-field",
    field: "status",
    pendingValue: "draft",
    approvedValue: "published",
    rejectedValue: "rejected",
    agentRoles: ["agent"]
};

const review: ReviewConfig = {
    collections: {
        orders: { mode: "staged-table",
agentRoles: ["agent"],
reviewerRoles: ["ops"] },
        posts: postsReview
    }
};

const ordersCollection: CollectionConfig = {
    name: "Orders",
    slug: "orders",
    table: "orders",
    // Agents read orders; nothing lets them write one.
    securityRules: [{ name: "orders_agents_read",
operations: ["select"],
roles: ["agent"] }],
    properties: {
        id: { name: "ID",
type: "string",
isId: "uuid" },
        customer: { name: "Customer",
type: "string" },
        total: { name: "Total",
type: "number" }
    }
};

const postsCollection: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    securityRules: [
        { name: "posts_agents_write",
operations: ["select", "insert", "update"],
roles: ["agent"] },
        ...reviewSecurityRules("posts", postsReview)
    ],
    properties: {
        id: { name: "ID",
type: "string",
isId: "uuid" },
        title: { name: "Title",
type: "string" },
        status: {
            name: "Status",
            type: "string",
            enum: [{ id: "draft",
label: "Draft" }, { id: "published",
label: "Published" }, { id: "rejected",
label: "Rejected" }]
        }
    }
};

const ORDER = {
    one: "11111111-1111-4111-8111-111111111111",
    two: "22222222-2222-4222-8222-222222222222",
    three: "33333333-3333-4333-8333-333333333333"
};
const POST = "44444444-4444-4444-8444-444444444444";

describe("the review plugin (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const originalNodeEnv = process.env.NODE_ENV;
    const token = { admin: "",
adminUid: "" };
    const key = { stage: "",
postsWriter: "" };

    async function call(path: string, credential: string, init: { method?: string; body?: unknown } = {}) {
        const response = await app.request(path, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json",
Authorization: `Bearer ${credential}` },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const text = await response.text();
        const json: unknown = text ? JSON.parse(text) : undefined;
        return { status: response.status,
json };
    }

    const dataOf = (json: unknown): StagedChange => (json as { data: StagedChange }).data;
    const listOf = (json: unknown): StagedChange[] => (json as { data: StagedChange[] }).data;

    async function order(id: string): Promise<{ customer: string; total: number } | undefined> {
        const { rows } = await admin.query<{ customer: string; total: string }>("SELECT customer, total FROM public.orders WHERE id = $1", [id]);
        return rows[0] ? { customer: rows[0].customer,
total: Number(rows[0].total) } : undefined;
    }

    async function post(id: string): Promise<{ title: string; status: string } | undefined> {
        const { rows } = await admin.query<{ title: string; status: string }>("SELECT title, status::text AS status FROM public.posts WHERE id = $1", [id]);
        return rows[0];
    }

    async function stage(body: Record<string, unknown>) {
        const answer = await call("/api/functions/review/changes", key.stage, { method: "POST",
body });
        expect(answer.status, JSON.stringify(answer.json)).toBe(201);
        return dataOf(answer.json);
    }

    async function mint(name: string, scopes: string[], roles: string[]): Promise<string> {
        const minted = await call("/api/admin/api-keys", token.admin, { method: "POST",
body: { name,
scopes,
roles } });
        expect(minted.status, JSON.stringify(minted.json)).toBe(201);
        const secret = (minted.json as { key?: { key?: unknown } }).key?.key;
        if (typeof secret !== "string") throw new Error(`no key in ${JSON.stringify(minted.json)}`);
        return secret;
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
            app,
            server,
            collections: [ordersCollection, postsCollection],
            database: createPostgresAdapter({ connection: connection.db,
connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET },
            functions: { review: reviewFunction(review) }
        });

        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        const operator = await repo.createUser({ email: "operator@review.test",
emailVerified: true });
        await repo.setUserRoles(operator.id, ["admin"]);
        token.adminUid = operator.id;
        token.admin = await generateAccessToken(operator.id, ["admin"]);

        await admin.query(
            "INSERT INTO public.orders (id, customer, total) VALUES ($1, 'Ada', 100), ($2, 'Grace', 200), ($3, 'Linus', 300)",
            [ORDER.one, ORDER.two, ORDER.three]
        );
        await admin.query("INSERT INTO public.posts (id, title, status) VALUES ($1, 'Hello', 'draft')", [POST]);

        // An agent's key: it may call the review function and read orders,
        // and nothing else — no `data:write`.
        key.stage = await mint("outreach-agent", ["functions:invoke:review", "data:read:orders"], ["agent"]);
        // An agent's key that may write posts, held to drafts by RLS.
        key.postsWriter = await mint("posts-agent", ["data:read:posts", "data:write:posts"], ["agent"]);
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("stages an rk_live_ key's update without touching the live row", async () => {
        expect(key.stage.startsWith("rk_live_")).toBe(true);
        const change = await stage({ collection: "orders",
operation: "update",
recordId: ORDER.one,
data: { total: 150 },
reason: "Upsell accepted" });

        expect(change).toMatchObject({
            collection_slug: "orders",
            operation: "update",
            target_record_id: ORDER.one,
            status: "pending",
            actor_type: "api_key",
            proposed_data: { total: 150 },
            reason: "Upsell accepted"
        });
        expect(change.actor_label).toMatch(/^rk_live_.+… · outreach-agent$/);
        expect(change.before_data).toMatchObject({ customer: "Ada",
total: 100 });
        expect(await order(ORDER.one)).toEqual({ customer: "Ada",
total: 100 });

        // The same key cannot make the change itself.
        const direct = await call(`/api/data/orders/${ORDER.one}`, key.stage, { method: "PATCH",
body: { total: 150 } });
        expect(direct.status).toBe(403);
        expect(await order(ORDER.one)).toEqual({ customer: "Ada",
total: 100 });

        // The proposals sit where only the server can reach them.
        const { rows } = await admin.query<{ allowed: boolean }>(
            "SELECT has_table_privilege('rebase_user', 'rebase.staged_changes', 'SELECT') AS allowed");
        expect(rows[0].allowed).toBe(false);
    });

    it("lists the proposal for the operator and for the agent that made it", async () => {
        const asOperator = await call("/api/functions/review/changes?collection=orders&status=pending", token.admin);
        expect(asOperator.status).toBe(200);
        expect(listOf(asOperator.json).map(change => change.target_record_id)).toEqual([ORDER.one]);

        const asAgent = await call("/api/functions/review/changes?collection=orders", key.stage);
        expect(listOf(asAgent.json)).toHaveLength(1);

        const count = await call("/api/functions/review/changes/count?collection=orders&status=pending", token.admin);
        expect(count.json).toEqual({ count: 1 });

        // The agent proposes; it does not decide.
        const [change] = listOf(asOperator.json);
        const selfApproval = await call(`/api/functions/review/changes/${change.id}/approve`, key.stage, { method: "POST" });
        expect(selfApproval.status).toBe(403);
    });

    it("applies the change when the operator approves it, once", async () => {
        const [change] = listOf((await call("/api/functions/review/changes?collection=orders&status=pending", token.admin)).json);
        const approved = await call(`/api/functions/review/changes/${change.id}/approve`, token.admin, { method: "POST" });
        expect(approved.status, JSON.stringify(approved.json)).toBe(200);
        expect(dataOf(approved.json)).toMatchObject({ status: "approved",
reviewed_by: token.adminUid });
        expect(dataOf(approved.json).reviewed_at).toBeTruthy();
        expect(await order(ORDER.one)).toEqual({ customer: "Ada",
total: 150 });

        const again = await call(`/api/functions/review/changes/${change.id}/approve`, token.admin, { method: "POST" });
        expect(again.status).toBe(409);
    });

    it("approves a batch in one transaction: all of it, or none of it", async () => {
        const raise = await stage({ collection: "orders",
operation: "update",
recordId: ORDER.one,
data: { total: 175 } });
        const rename = await stage({ collection: "orders",
operation: "update",
recordId: ORDER.two,
data: { customer: "Grace H." } });
        const batch = await call("/api/functions/review/changes/batch", token.admin, {
            method: "POST",
            body: { action: "approve",
ids: [raise.id, rename.id] }
        });
        expect(batch.status, JSON.stringify(batch.json)).toBe(200);
        expect(listOf(batch.json).map(change => change.status)).toEqual(["approved", "approved"]);
        expect(await order(ORDER.one)).toEqual({ customer: "Ada",
total: 175 });
        expect(await order(ORDER.two)).toEqual({ customer: "Grace H.",
total: 200 });

        // A batch whose second change cannot land: its row is gone.
        const fine = await stage({ collection: "orders",
operation: "update",
recordId: ORDER.one,
data: { total: 999 } });
        const doomed = await stage({ collection: "orders",
operation: "update",
recordId: ORDER.three,
data: { total: 1 } });
        await admin.query("DELETE FROM public.orders WHERE id = $1", [ORDER.three]);
        const failed = await call("/api/functions/review/changes/batch", token.admin, {
            method: "POST",
            body: { action: "approve",
ids: [fine.id, doomed.id] }
        });
        expect(failed.status).toBeGreaterThanOrEqual(400);
        expect(await order(ORDER.one)).toEqual({ customer: "Ada",
total: 175 });
        const { rows } = await admin.query<{ status: string }>(
            "SELECT status FROM rebase.staged_changes WHERE id = ANY($1::uuid[]) ORDER BY created_at", [[fine.id, doomed.id]]);
        expect(rows.map(row => row.status)).toEqual(["pending", "pending"]);
    });

    it("rejects a change with a note, and the row stays as it was", async () => {
        const change = await stage({ collection: "orders",
operation: "delete",
recordId: ORDER.two,
reason: "Duplicate" });
        const rejected = await call(`/api/functions/review/changes/${change.id}/reject`, token.admin, {
            method: "POST",
            body: { note: "Not a duplicate" }
        });
        expect(rejected.status).toBe(200);
        expect(dataOf(rejected.json)).toMatchObject({ status: "rejected",
review_note: "Not a duplicate" });
        expect(await order(ORDER.two)).toEqual({ customer: "Grace H.",
total: 200 });
    });

    it("refuses a proposal to a collection the configuration does not stage, and to a row the agent cannot see", async () => {
        const notStaged = await call("/api/functions/review/changes", key.stage, {
            method: "POST",
            body: { collection: "posts",
operation: "update",
recordId: POST,
data: { title: "x" } }
        });
        expect(notStaged.status).toBe(404);
        const missing = await call("/api/functions/review/changes", key.stage, {
            method: "POST",
            body: { collection: "orders",
operation: "update",
recordId: ORDER.three,
data: { total: 5 } }
        });
        expect(missing.status).toBe(404);
    });

    it("lets Postgres refuse an agent role that publishes a state-field row itself", async () => {
        const { rows: policies } = await admin.query<{ policyname: string; permissive: string; cmd: string }>(
            "SELECT policyname, permissive, cmd FROM pg_policies WHERE tablename = 'posts' AND policyname LIKE 'posts_review_%' ORDER BY policyname");
        expect(policies).toEqual([
            { policyname: "posts_review_pending_only_insert",
permissive: "RESTRICTIVE",
cmd: "INSERT" },
            { policyname: "posts_review_pending_only_update",
permissive: "RESTRICTIVE",
cmd: "UPDATE" }
        ]);

        const publish = await call(`/api/data/posts/${POST}`, key.postsWriter, { method: "PATCH",
body: { status: "published" } });
        expect(publish.status).toBeGreaterThanOrEqual(400);
        expect(await post(POST)).toEqual({ title: "Hello",
status: "draft" });

        // A draft it may still edit, and create.
        const edit = await call(`/api/data/posts/${POST}`, key.postsWriter, { method: "PATCH",
body: { title: "Hello, world" } });
        expect(edit.status, JSON.stringify(edit.json)).toBe(200);
        expect(await post(POST)).toEqual({ title: "Hello, world",
status: "draft" });

        const createdPublished = await call("/api/data/posts", key.postsWriter, { method: "POST",
body: { title: "Sneaky",
status: "published" } });
        expect(createdPublished.status).toBeGreaterThanOrEqual(400);
        const createdDraft = await call("/api/data/posts", key.postsWriter, { method: "POST",
body: { title: "Honest",
status: "draft" } });
        expect(createdDraft.status, JSON.stringify(createdDraft.json)).toBe(201);

        // The operator approves by setting the state.
        const approve = await call(`/api/data/posts/${POST}`, token.admin, { method: "PATCH",
body: { status: "published" } });
        expect(approve.status, JSON.stringify(approve.json)).toBe(200);
        expect(await post(POST)).toEqual({ title: "Hello, world",
status: "published" });

        // And a published row is out of the agent's reach.
        const afterPublish = await call(`/api/data/posts/${POST}`, key.postsWriter, { method: "PATCH",
body: { title: "Edited live" } });
        expect(afterPublish.status).toBeGreaterThanOrEqual(400);
        expect(await post(POST)).toEqual({ title: "Hello, world",
status: "published" });
    });
});
