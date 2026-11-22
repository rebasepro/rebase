/**
 * A function declares its own timeout: `defineFunction(…, { timeoutMs })`.
 *
 * Ported Supabase edge functions that call an LLM ran into the 30 s default
 * (Supabase allows 150 s), and the only fix was raising
 * `REBASE_FUNCTIONS_TIMEOUT_MS` for every function on the server. A function
 * now says how long it needs; the server caps that at
 * `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s by default), so a project file
 * cannot hold a request open forever, and the 504 names the limit it hit and
 * where that limit was set.
 *
 * Driven through the functions router's own pieces: the timeout middleware in
 * front, the function app mounted under it as the loader mounts it.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import {
    createFunctionsRequestTimeout,
    resolveFunctionsMaxTimeout,
    resolveFunctionsTimeout,
    DEFAULT_FUNCTIONS_MAX_TIMEOUT_MS,
    type FunctionsMaxTimeout,
    type FunctionsTimeout
} from "../src/functions/request-timeout";
import { defineFunction } from "../src/functions/define-function";
import { getSignal } from "../src/functions/context";

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); });
});

/** A functions router: the timeout in front, one function mounted at `/slow`. */
function router(
    serverWide: FunctionsTimeout,
    max: FunctionsMaxTimeout,
    fn: Hono<HonoEnv>
) {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", createFunctionsRequestTimeout(serverWide, max));
    app.route("/slow", fn);
    return app;
}

/**
 * A function that takes `takesMs`, or answers 200 the moment its signal
 * aborts — which it reaches before the 504 does, so the 504 must replace it.
 */
function slowFunction(takesMs: number, options?: { timeoutMs?: number }) {
    return defineFunction((app) => {
        app.get("/", async (c) => {
            await sleep(takesMs, getSignal(c));
            return c.json({ ok: true, aborted: getSignal(c).aborted });
        });
    }, options);
}

interface TimeoutAnswer { error: { code: string; message: string; details: Record<string, unknown> } }

const DEFAULT_MAX: FunctionsMaxTimeout = { ms: DEFAULT_FUNCTIONS_MAX_TIMEOUT_MS, source: "default" };

describe("a function's own timeout", () => {
    it("outlasts the server-wide one", async () => {
        const app = router({ ms: 20, source: "default" }, DEFAULT_MAX, slowFunction(80, { timeoutMs: 1_000 }));

        const res = await app.request("/slow");

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, aborted: false });
    });

    it("answers 504 when it runs out, naming the declaration", async () => {
        const app = router({ ms: 5_000, source: "env" }, DEFAULT_MAX, slowFunction(2_000, { timeoutMs: 30 }));

        const res = await app.request("/slow");
        const body = await res.json() as TimeoutAnswer;

        expect(res.status).toBe(504);
        expect(body.error.code).toBe("FUNCTION_TIMEOUT");
        expect(body.error.message).toContain("timeoutMs: 30");
        expect(body.error.details).toEqual({ timeoutMs: 30, source: "function", declaredMs: 30, maxTimeoutMs: DEFAULT_FUNCTIONS_MAX_TIMEOUT_MS });
    });

    it("is cut to the server's cap, and the 504 says so", async () => {
        const app = router({ ms: 10, source: "default" }, { ms: 40, source: "env" }, slowFunction(2_000, { timeoutMs: 600_000 }));

        const started = Date.now();
        const res = await app.request("/slow");
        const body = await res.json() as TimeoutAnswer;

        expect(res.status).toBe(504);
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(body.error.message).toMatch(/declares `timeoutMs: 600000`.*caps a function's own timeout at 40ms \(REBASE_FUNCTIONS_MAX_TIMEOUT_MS\)/);
        expect(body.error.details).toMatchObject({ timeoutMs: 40, source: "function", declaredMs: 600_000, maxTimeoutMs: 40 });
    });

    it("counts from the request's arrival, not from when the function was reached", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createFunctionsRequestTimeout({ ms: 10_000, source: "default" }, DEFAULT_MAX));
        // An auth middleware that takes most of the function's budget.
        app.use("/*", async (_c, next) => { await sleep(60); await next(); });
        app.route("/slow", slowFunction(60, { timeoutMs: 90 }));

        expect((await app.request("/slow")).status).toBe(504);
    });

    it("applies where the server-wide timeout is off", async () => {
        const app = router({ ms: 0, source: "option" }, DEFAULT_MAX, slowFunction(2_000, { timeoutMs: 30 }));

        expect((await app.request("/slow")).status).toBe(504);
    });

    it("covers an app the definition returns of its own", async () => {
        const fn = defineFunction(() => {
            const own = new Hono<HonoEnv>();
            own.get("/", async (c) => { await sleep(2_000, getSignal(c)); return c.json({ ok: true }); });
            return own;
        }, { timeoutMs: 30 });
        const app = router({ ms: 10_000, source: "default" }, DEFAULT_MAX, fn);

        expect((await app.request("/slow")).status).toBe(504);
    });

    it("leaves every other function on the server-wide timeout", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", createFunctionsRequestTimeout({ ms: 30, source: "default" }, DEFAULT_MAX));
        app.route("/patient", slowFunction(80, { timeoutMs: 1_000 }));
        app.route("/plain", slowFunction(2_000));

        expect((await app.request("/patient")).status).toBe(200);
        const plain = await app.request("/plain");
        const body = await plain.json() as TimeoutAnswer;
        expect(plain.status).toBe(504);
        expect(body.error.details).toEqual({ timeoutMs: 30, source: "default" });
        expect(body.error.message).toContain("defineFunction(…, { timeoutMs })");
        expect(body.error.message).toContain("REBASE_FUNCTIONS_TIMEOUT_MS");
    });

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("refuses %p as it is defined", (timeoutMs) => {
        expect(() => defineFunction(() => undefined, { timeoutMs })).toThrow(/timeoutMs.*above 0/);
    });

    it("does nothing outside the functions router", async () => {
        const fn = slowFunction(5, { timeoutMs: 1 });
        expect((await fn.request("/")).status).toBe(200);
    });
});

describe("the server-wide timeout, as the 504 names it", () => {
    it.each([
        [{ ms: 20, source: "default" } as const, /the default timeout.*REBASE_FUNCTIONS_TIMEOUT_MS/],
        [{ ms: 20, source: "env" } as const, /the timeout REBASE_FUNCTIONS_TIMEOUT_MS sets/],
        [{ ms: 20, source: "option" } as const, /the timeout the `functionsTimeoutMs` option sets/]
    ])("%j", async (serverWide, message) => {
        const app = router(serverWide, DEFAULT_MAX, slowFunction(2_000));

        const body = await (await app.request("/slow")).json() as TimeoutAnswer;

        expect(body.error.message).toMatch(message);
        expect(body.error.details).toEqual({ timeoutMs: 20, source: serverWide.source });
    });
});

describe("where the limits come from", () => {
    const KEYS = ["REBASE_FUNCTIONS_TIMEOUT_MS", "REBASE_FUNCTIONS_MAX_TIMEOUT_MS"] as const;
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } });
    afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

    it("says which setting gave the server-wide timeout", () => {
        expect(resolveFunctionsTimeout()).toEqual({ ms: 30_000, source: "default" });
        process.env.REBASE_FUNCTIONS_TIMEOUT_MS = "45000";
        expect(resolveFunctionsTimeout()).toEqual({ ms: 45_000, source: "env" });
        expect(resolveFunctionsTimeout(1234)).toEqual({ ms: 1234, source: "option" });
    });

    it("caps a function's own at 300 s unless REBASE_FUNCTIONS_MAX_TIMEOUT_MS says otherwise, and has no off", () => {
        expect(resolveFunctionsMaxTimeout()).toEqual({ ms: 300_000, source: "default" });
        process.env.REBASE_FUNCTIONS_MAX_TIMEOUT_MS = "120000";
        expect(resolveFunctionsMaxTimeout()).toEqual({ ms: 120_000, source: "env" });
        for (const unset of ["", "0", "-1", "soon"]) {
            process.env.REBASE_FUNCTIONS_MAX_TIMEOUT_MS = unset;
            expect(resolveFunctionsMaxTimeout()).toEqual({ ms: 300_000, source: "default" });
        }
    });
});
