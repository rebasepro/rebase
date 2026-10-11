import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createFunctionsRequestTimeout } from "../src/functions/request-timeout";
import { getSignal } from "../src/functions/context";

/**
 * A function that outlasts its ceiling is answered 504, and its handler kept
 * running with nothing to tell it so — a `fetch` it passed no signal to went on
 * holding a connection to a third party for as long as that party took.
 * `getSignal(c)` is the signal the 504 aborts: hand it to `fetch` and the work
 * stops with the request.
 */
function app(ms: number, handler: (signal: AbortSignal) => Promise<void>) {
    const a = new Hono<HonoEnv>();
    a.onError(errorHandler);
    a.use("/*", createFunctionsRequestTimeout(ms));
    a.get("/fn", async (c) => {
        await handler(getSignal(c));
        return c.json({ ok: true });
    });
    return a;
}

describe("the signal a function handler gets", () => {
    it("is aborted when the request times out", async () => {
        let seen: AbortSignal | undefined;
        let abortedWhileRunning = false;
        const a = app(10, async (signal) => {
            seen = signal;
            await new Promise<void>(resolve => signal.addEventListener("abort", () => {
                abortedWhileRunning = true;
                resolve();
            }));
        });

        const res = await a.request("/fn");

        expect(res.status).toBe(504);
        expect(seen?.aborted).toBe(true);
        expect(abortedWhileRunning).toBe(true);
    });

    it("stays live for a handler that finishes in time", async () => {
        let seen: AbortSignal | undefined;
        const a = app(1_000, async (signal) => { seen = signal; });

        const res = await a.request("/fn");

        expect(res.status).toBe(200);
        expect(seen?.aborted).toBe(false);
    });

    it("exists, and never aborts, when the ceiling is off", async () => {
        let seen: AbortSignal | undefined;
        const a = app(0, async (signal) => { seen = signal; });

        expect((await a.request("/fn")).status).toBe(200);
        expect(seen).toBeInstanceOf(AbortSignal);
        expect(seen?.aborted).toBe(false);
    });
});
