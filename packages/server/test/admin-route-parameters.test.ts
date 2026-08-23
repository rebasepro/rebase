/**
 * What the admin surfaces do with a parameter they cannot use.
 *
 * The data plane refuses one: `?limit=abc` is a 400 naming the bound. The admin
 * routers each did something else, and each did it silently — `parseInt` into
 * `NaN`, then a query that fails, or a window that slices to nothing, or a
 * default that quietly replaces what was asked for. A caller cannot tell any of
 * those from "there is nothing here", which is the answer they all produce.
 *
 * These four routers had no route-level tests at all. This is the first.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { Hono } from "hono";
import { createCronRoutes } from "../src/cron/cron-routes";
import { createLogsRoutes, logBuffer } from "../src/api/logs-routes";
import { createFunctionRoutes } from "../src/functions/function-routes";
import { createSchemaEditorRoutes } from "../src/api/schema-editor-routes";
import type { CronScheduler } from "../src/cron/cron-scheduler";
import type { HonoEnv } from "../src/api/types";

const mount = (router: Hono<HonoEnv>, at = "/") => {
    const app = new Hono<HonoEnv>();
    app.route(at, router);
    return app;
};

describe("GET /admin/cron/:id/logs", () => {
    const getJobLogsFromDb = jest.fn(async () => []);
    const scheduler = {
        getJob: () => ({ id: "nightly", name: "Nightly" }),
        getJobLogsFromDb
    } as unknown as CronScheduler;

    const app = mount(createCronRoutes(scheduler));

    it("refuses a limit that is not a number", async () => {
        // It used to reach the store as `NaN`: Postgres rejects `LIMIT NaN`, the
        // store logs and returns `[]`, and the caller is told 200 with no logs —
        // which reads as "this job has never run".
        const res = await app.request("/nightly/logs?limit=abc");
        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_LIMIT");
    });

    it("refuses a negative limit", async () => {
        expect((await app.request("/nightly/logs?limit=-5")).status).toBe(400);
    });

    it("takes a limit it can use", async () => {
        const res = await app.request("/nightly/logs?limit=10");
        expect(res.status).toBe(200);
        expect(getJobLogsFromDb).toHaveBeenCalledWith("nightly", 10);
    });

    it("defaults when none is given", async () => {
        expect((await app.request("/nightly/logs")).status).toBe(200);
    });
});

describe("the logs windows", () => {
    const app = mount(createLogsRoutes());

    it.each([
        ["/?limit=abc"],
        ["/?limit=-5"],
        ["/?limit=0"],
        ["/latest?count=abc"],
        ["/latest?count=-1"]
    ])("refuses %s", async (path) => {
        const res = await app.request(path);
        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_PARAM");
    });

    it("still answers when nothing is asked for", async () => {
        const res = await app.request("/latest");
        expect(res.status).toBe(200);
        expect(Array.isArray((await res.json() as { entries: unknown[] }).entries)).toBe(true);
        expect(logBuffer).toBeDefined();
    });

    it("refuses a window larger than the buffer rather than clamping it", async () => {
        // A clamped answer is indistinguishable from "that is all there is".
        expect((await app.request("/?limit=10001")).status).toBe(400);
    });
});

describe("GET /functions", () => {
    it("advertises the path it is actually mounted at", async () => {
        // The listing hardcoded `/functions/<name>`, which is wrong under every
        // `basePath` — including the default `/api`.
        const router = createFunctionRoutes(
            [{ name: "hello", app: new Hono() }] as never,
            0,
            "/api/functions"
        );
        const res = await mount(router, "/api/functions").request("/api/functions");
        const body = await res.json() as { functions: { name: string; endpoint: string }[] };
        expect(body.functions).toEqual([{ name: "hello", endpoint: "/api/functions/hello" }]);
    });
});

describe("POST /admin/schema-editor/*", () => {
    const app = mount(createSchemaEditorRoutes("/tmp/rebase-schema-editor-test"));

    const post = (path: string, body: string) => app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
    });

    it("refuses a body with no collectionId", async () => {
        const res = await post("/collection/delete", JSON.stringify({}));
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("INVALID_INPUT");
        expect(body.error.message).toContain("collectionId");
    });

    it("refuses a body that is not JSON", async () => {
        expect((await post("/collection/delete", "not json")).status).toBe(400);
    });

    it("hands the editor's own refusal to the caller", async () => {
        // These messages are written for the person in the panel — "Only
        // alphanumeric characters, underscores, and hyphens are allowed". They
        // were thrown as plain `Error`s, so every one of them arrived as a 500
        // reading "Internal Server Error".
        const res = await post("/collection/delete", JSON.stringify({ collectionId: "../../etc/passwd" }));
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("SCHEMA_EDIT_REFUSED");
        expect(body.error.message).toMatch(/Invalid collection ID/i);
    });
});
