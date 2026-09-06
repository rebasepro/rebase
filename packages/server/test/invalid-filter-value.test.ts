import { Hono } from "hono";
import { errorHandler } from "../src/api/errors";
import { HonoEnv } from "../src/api/types";

/**
 * A filter value the column's type cannot hold is the caller's mistake, and it
 * used to answer 500 INTERNAL_ERROR.
 *
 * `?id=eq.abc` on an integer key, `?status=eq.nope` on an enum, a timestamp
 * that is not one: every *other* bad query parameter already had a precise 400
 * naming what to fix, and a bad *value* fell off the end of the chain. In
 * production `dbMessage` is stripped from the envelope, so what the caller
 * actually received was a bare 500 that named nothing — indistinguishable from
 * the database being down.
 */
function driverError(code: string, message: string, column?: string): Error {
    // The shape node-postgres produces, wrapped the way drizzle wraps it: the
    // outer message is the whole failed statement, which is exactly what must
    // NOT reach the caller.
    const pg = Object.assign(new Error(message), { code, column });
    return Object.assign(
        new Error("Failed query: select \"id\" from \"posts\" where \"id\" = $1\nparams: abc"),
        { cause: pg }
    );
}

function appThrowing(error: Error) {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.get("/api/data/posts", () => {
        throw error;
    });
    return app;
}

async function answerFor(error: Error) {
    const res = await appThrowing(error).request("/api/data/posts");
    return { status: res.status, body: await res.json() as { error: { message: string; code: string; details?: { dbCode?: string } } } };
}

describe("a filter value the column cannot hold", () => {
    it("22P02 (unparseable literal) is a 400 naming the value and the type", async () => {
        const { status, body } = await answerFor(
            driverError("22P02", "invalid input syntax for type integer: \"abc\"")
        );
        expect(status).toBe(400);
        expect(body.error.code).toBe("INVALID_FILTER_VALUE");
        expect(body.error.message).toContain("\"abc\"");
        expect(body.error.message).toContain("integer");
    });

    it("22P02 on an enum names the enum", async () => {
        const { status, body } = await answerFor(
            driverError("22P02", "invalid input value for enum post_status: \"nope\"", "status")
        );
        expect(status).toBe(400);
        expect(body.error.code).toBe("INVALID_FILTER_VALUE");
        expect(body.error.message).toContain("post_status");
        expect(body.error.message).toContain("\"status\"");
    });

    it("22007 (a timestamp that is not one) is a 400", async () => {
        const { status, body } = await answerFor(
            driverError("22007", "invalid input syntax for type timestamp: \"yesterday\"")
        );
        expect(status).toBe(400);
        expect(body.error.code).toBe("INVALID_FILTER_VALUE");
        expect(body.error.message).toContain("timestamp");
    });

    it("22003 (out of range) is a 400", async () => {
        const { status, body } = await answerFor(
            driverError("22003", "value \"99999999999\" is out of range for type integer")
        );
        expect(status).toBe(400);
        expect(body.error.code).toBe("INVALID_FILTER_VALUE");
        expect(body.error.message).toContain("out of range");
    });

    it("never echoes the failed statement back to the caller", async () => {
        const { body } = await answerFor(
            driverError("22P02", "invalid input syntax for type integer: \"abc\"")
        );
        expect(body.error.message).not.toContain("Failed query");
        expect(body.error.message).not.toContain("select");
    });

    it("keeps the SQLSTATE in details, where a client can branch on it", async () => {
        const { body } = await answerFor(
            driverError("22P02", "invalid input syntax for type integer: \"abc\"")
        );
        expect(body.error.details?.dbCode).toBe("22P02");
    });

    it("leaves a SQLSTATE outside class 22 alone", async () => {
        const { status, body } = await answerFor(
            driverError("42501", "new row violates row-level security policy for table \"posts\"")
        );
        expect(status).toBe(500);
        expect(body.error.code).toBe("DB_PERMISSION_DENIED");
    });
});
