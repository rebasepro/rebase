import { describe, expect, it, afterEach } from "@jest/globals";
import { Hono } from "hono";
import path from "node:path";
import type { BackendBootstrapper, BranchDiff, BranchDiffOptions, BranchMergeOptions, BranchMergeResult, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";
import { ApiError } from "../src/api/errors";

/**
 * `GET /api/admin/branches/:name/diff` and `POST …/merge` — Studio's review
 * of a database branch.
 *
 * The comparison is the driver's; what is pinned here is the door: who may
 * call it, what it passes the driver, and that a driver's refusal keeps its
 * status — a stale diff is a 409 the pane can act on, not a 500.
 */

const JWT_SECRET = "branch-review-route-test-secret-123456";
const CRONS_DIR = path.join(__dirname, "fixtures", "crons");

const calls: { diff: [string, BranchDiffOptions | undefined][]; merge: [string, BranchMergeOptions][] } = { diff: [], merge: [] };
let mergeRefusal: Error | undefined;

const DIFF: BranchDiff = {
    branch: "agent",
    branchDatabase: "rb_agent",
    targetDatabase: "app",
    schemas: ["public"],
    forkPointKnown: true,
    fingerprint: "f1",
    schema: [],
    data: [],
    sampleLimit: 100,
    computedAt: "2026-10-20T00:00:00.000Z"
};

const MERGED: BranchMergeResult = {
    branch: "agent",
    targetDatabase: "app",
    tables: [{ schema: "public", table: "posts", inserted: 1, updated: 0, deleted: 0 }],
    skipped: [],
    conflictsKept: 0,
    schemaChangesNotMerged: 0,
    warnings: []
};

function stubDriver(canDiff: boolean) {
    return {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        admin: {
            executeSql: async () => [],
            createBranch: async () => { throw new Error("unused"); },
            deleteBranch: async () => undefined,
            listBranches: async () => [],
            getBranchInfo: async () => undefined,
            ...(canDiff ? {
                diffBranch: async (name: string, options?: BranchDiffOptions) => {
                    calls.diff.push([name, options]);
                    return DIFF;
                },
                mergeBranch: async (name: string, options: BranchMergeOptions) => {
                    calls.merge.push([name, options]);
                    if (mergeRefusal) throw mergeRefusal;
                    return MERGED;
                }
            } : {})
        }
    };
}

const started: Array<() => void> = [];

async function boot(options: { canDiff?: boolean } = {}): Promise<Hono> {
    const bootstrapper = {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: stubDriver(options.canDiff ?? true), collections: [], internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            const authRepository = {
                getUserRoleIds: async (uid: string) => (uid.startsWith("admin") ? ["admin"] : ["editor"]),
                getTokensValidAfter: async () => null
            };
            return { userService: authRepository, authRepository };
        }
    } as unknown as BackendBootstrapper;
    const app = new Hono();
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [{ name: "jobs", slug: "jobs", table: "jobs", properties: { id: { name: "ID", type: "string", isId: "uuid" } } } as unknown as CollectionConfig],
        cronsDir: CRONS_DIR,
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        enableSwagger: false,
        auth: { requireAuth: false, jwtSecret: JWT_SECRET }
    } as never);
    started.push(() => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.());
    return app;
}

afterEach(() => {
    while (started.length) started.pop()!();
    calls.diff = [];
    calls.merge = [];
    mergeRefusal = undefined;
});

const admin = () => generateAccessToken("admin-1", ["admin"]);

async function merge(app: Hono, body: unknown, token?: string): Promise<Response> {
    return app.request("/api/admin/branches/agent/merge", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body)
    });
}

describe("who may review a branch", () => {
    it("refuses a request with no credential", async () => {
        const app = await boot();
        expect((await app.request("/api/admin/branches/agent/diff")).status).toBe(401);
        expect((await merge(app, { expectedFingerprint: "f1" })).status).toBe(401);
        expect(calls).toEqual({ diff: [], merge: [] });
    });

    it("refuses a signed-in person without the database scopes", async () => {
        const app = await boot();
        const token = await generateAccessToken("editor-1", ["editor"]);
        const res = await app.request("/api/admin/branches/agent/diff", { headers: { authorization: `Bearer ${token}` } });
        expect(res.status).toBe(403);
        expect((await merge(app, { expectedFingerprint: "f1" }, token)).status).toBe(403);
        expect(calls).toEqual({ diff: [], merge: [] });
    });
});

describe("the diff", () => {
    it("passes the branch and its options to the driver, and answers with its diff", async () => {
        const app = await boot();
        const res = await app.request("/api/admin/branches/agent/diff?sampleLimit=5&schemas=public,%20app", {
            headers: { authorization: `Bearer ${await admin()}` }
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(DIFF);
        expect(calls.diff).toEqual([["agent", { sampleLimit: 5, maxRowsPerTable: undefined, schemas: ["public", "app"] }]]);
    });

    it("refuses a sample limit that is not a number", async () => {
        const app = await boot();
        const res = await app.request("/api/admin/branches/agent/diff?sampleLimit=lots", { headers: { authorization: `Bearer ${await admin()}` } });
        expect(res.status).toBe(400);
        expect(calls.diff).toEqual([]);
    });

    it("answers 501, with a reason, on a driver that cannot compare branches", async () => {
        const app = await boot({ canDiff: false });
        const res = await app.request("/api/admin/branches/agent/diff", { headers: { authorization: `Bearer ${await admin()}` } });
        expect(res.status).toBe(501);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("BRANCH_DIFF_UNSUPPORTED");
    });
});

describe("the merge", () => {
    it("needs the fingerprint of the diff that was reviewed", async () => {
        const app = await boot();
        const res = await merge(app, {}, await admin());
        expect(res.status).toBe(400);
        expect(calls.merge).toEqual([]);
    });

    it("refuses a conflict rule it does not know", async () => {
        const app = await boot();
        expect((await merge(app, { expectedFingerprint: "f1", onConflict: "ours" }, await admin())).status).toBe(400);
        expect(calls.merge).toEqual([]);
    });

    it("passes what wins to the driver, and answers with what it wrote", async () => {
        const app = await boot();
        const res = await merge(app, { expectedFingerprint: "f1", onConflict: "branch", skipBlocked: true }, await admin());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(MERGED);
        expect(calls.merge).toEqual([["agent", {
            expectedFingerprint: "f1",
            onConflict: "branch",
            skipBlocked: true,
            schemas: undefined,
            maxRowsPerTable: undefined
        }]]);
    });

    it("keeps the driver's 409 for a diff that went stale, with its details", async () => {
        mergeRefusal = new ApiError(409, "BRANCH_DIFF_STALE", "The branch changed since the diff was read.", { tables: [] }, true);
        const app = await boot();
        const res = await merge(app, { expectedFingerprint: "old" }, await admin());
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: { code: "BRANCH_DIFF_STALE", details: { tables: [] } } });
    });
});
