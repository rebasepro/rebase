import { describe, it, expect, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { errorHandler } from "../src/api/errors";
import { HonoEnv } from "../src/api/types";
import { addLogSink } from "../src/utils/logger";

/**
 * The request path prints the same cause chain the boot path does.
 *
 * `errorHandler` used to log `String(error.stack || error)`. A string is a leaf
 * to the logger — `serialiseError`'s `.cause`/`AggregateError` walk never runs
 * on one — so a function that threw `new Error("outer", { cause: … })` produced
 * the wrapper's stack and nothing about the reason. `inner reason: ECONNRESET`,
 * two links down, appeared nowhere in the log at all, while the identical error
 * at boot printed its whole chain.
 */
describe("errorHandler logs the cause chain", () => {
    const unsubscribes: Array<() => void> = [];

    afterEach(() => {
        while (unsubscribes.length > 0) unsubscribes.pop()!();
    });

    function captureLines() {
        const lines: Array<{ level: string; message: string; data: Record<string, unknown> }> = [];
        unsubscribes.push(addLogSink((level, message, data) => { lines.push({ level, message, data }); }));
        return lines;
    }

    function appThrowing(error: unknown) {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.get("/boom", () => { throw error; });
        return app;
    }

    it("hands the sink the error itself, cause and all", async () => {
        const lines = captureLines();
        const thrown = new Error("outer wrapper", {
            cause: new Error("middle layer", {
                cause: Object.assign(new Error("inner reason: ECONNRESET"), { code: "ECONNRESET" })
            })
        });

        const res = await appThrowing(thrown).request("/boom");
        expect(res.status).toBe(500);

        const logged = lines.find(line => line.level === "error" && line.message === "unhandled request error");
        expect(logged).toBeDefined();

        const serialised = logged!.data.error as { message: string; cause?: { message: string; cause?: { message: string; code?: string } } };
        expect(serialised.message).toBe("outer wrapper");
        expect(serialised.cause?.message).toBe("middle layer");
        expect(serialised.cause?.cause?.message).toContain("ECONNRESET");
        expect(serialised.cause?.cause?.code).toBe("ECONNRESET");
    });

    it("still says nothing extra for a handled database error", async () => {
        // The suppression above this call site is unchanged: a SQLSTATE-bearing
        // error carries its diagnosis on the `[PG …]` line, and the stack — or
        // now the serialised chain — would only repeat it.
        const lines = captureLines();
        const pgError = Object.assign(new Error("relation \"posts\" does not exist"), { code: "42P01" });

        await appThrowing(pgError).request("/boom");

        expect(lines.some(line => line.message === "unhandled request error")).toBe(false);
    });
});
