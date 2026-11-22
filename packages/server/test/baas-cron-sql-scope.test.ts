/**
 * A scheduled SQL job takes `database:write`, not just `cron:write`.
 *
 * `rebase.cron_jobs` rows of kind `"sql"` run their statement as the server's
 * own database connection, past every policy — the SQL console's power on a
 * schedule. The routes sat behind the cron surface's gate alone, so a key
 * minted to pause and trigger jobs could schedule a `DROP TABLE`. Writing a SQL
 * job, or turning a job into one, now also asks for the SQL console's scope;
 * an HTTP job is still `cron:write`'s business.
 */
import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { createCronJobsAdminRoutes, type CronJobsStore, type StoredCronJob } from "../src/baas/roles-and-crons-store";

function fakeStore(existing: StoredCronJob[] = []): CronJobsStore & { created: number; updated: number } {
    const store = {
        created: 0,
        updated: 0,
        list: async () => existing,
        create: async (input: Parameters<CronJobsStore["create"]>[0]): Promise<StoredCronJob> => {
            store.created++;
            return { ...job("new", input.kind), name: input.name };
        },
        update: async (id: string): Promise<StoredCronJob> => {
            store.updated++;
            return existing.find(j => j.id === id) ?? job(id, "http");
        },
        remove: async () => true,
        syncToScheduler: async () => undefined
    };
    return store;
}

function job(id: string, kind: "sql" | "http"): StoredCronJob {
    return {
        id,
        name: `job_${id}`,
        schedule: "*/5 * * * *",
        timezone: "UTC",
        kind,
        config: kind === "sql"
            ? { kind: "sql", sql: "select 1" }
            : { kind: "http", url: "https://example.com/hook" },
        enabled: true,
        createdAt: "",
        updatedAt: ""
    };
}

/** The routes, called by a key narrowed to `scopes`. */
function appFor(store: CronJobsStore, scopes: string[]): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>();
    app.use("/*", async (c, next) => {
        c.set("user", { uid: "key-owner", roles: [] });
        c.set("scopes", scopes);
        await next();
    });
    app.route("/jobs", createCronJobsAdminRoutes(store));
    return app;
}

const post = (body: unknown) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
});
const patch = (body: unknown) => ({ ...post(body), method: "PATCH" });

describe("zero-code cron jobs: a SQL job takes database:write", () => {
    it("refuses a SQL job to a caller with only cron:write, and creates nothing", async () => {
        const store = fakeStore();
        const res = await appFor(store, ["cron:read", "cron:write"]).request("/jobs", post({
            name: "wipe", schedule: "0 * * * *", kind: "sql", config: { sql: "drop table orders" }
        }));
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string; details?: { requiredScope?: string } } };
        expect(body.error.code).toBe("SCOPE_MISSING");
        expect(body.error.details?.requiredScope).toBe("database:write");
        expect(store.created).toBe(0);
    });

    it("lets cron:write alone create an HTTP job", async () => {
        const store = fakeStore();
        const res = await appFor(store, ["cron:write"]).request("/jobs", post({
            name: "ping", schedule: "0 * * * *", kind: "http", config: { url: "https://example.com/hook" }
        }));
        expect(res.status).toBe(201);
        expect(store.created).toBe(1);
    });

    it("creates a SQL job for a caller that also holds database:write", async () => {
        const store = fakeStore();
        const res = await appFor(store, ["cron:write", "database:write"]).request("/jobs", post({
            name: "rollup", schedule: "0 * * * *", kind: "sql", config: { sql: "select 1" }
        }));
        expect(res.status).toBe(201);
        expect(store.created).toBe(1);
    });

    it("refuses any change to an existing SQL job without database:write — pausing it included", async () => {
        const store = fakeStore([job("a", "sql")]);
        const res = await appFor(store, ["cron:write"]).request("/jobs/a", patch({ enabled: false }));
        expect(res.status).toBe(403);
        expect(store.updated).toBe(0);
    });

    it("refuses turning an HTTP job into a SQL one without database:write", async () => {
        const store = fakeStore([job("b", "http")]);
        const res = await appFor(store, ["cron:write"]).request("/jobs/b", patch({
            kind: "sql", config: { sql: "delete from users" }
        }));
        expect(res.status).toBe(403);
        expect(store.updated).toBe(0);
    });

    it("lets cron:write edit an HTTP job", async () => {
        const store = fakeStore([job("c", "http")]);
        const res = await appFor(store, ["cron:write"]).request("/jobs/c", patch({ enabled: false }));
        expect(res.status).toBe(200);
        expect(store.updated).toBe(1);
    });
});
