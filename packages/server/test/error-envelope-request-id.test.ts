import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthAdapter, DataDriver } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { ApiError, errorHandler } from "../src/api/errors";
import { requestId, REQUEST_ID_HEADER } from "../src/utils/request-id";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { createFunctionsRequestTimeout } from "../src/functions/request-timeout";

/**
 * Every JSON error body on `/api/*` carries the `requestId` the header carries.
 *
 * `errors.md` promises it "whenever the request passed through the request-ID
 * middleware, which is every route under `basePath`", and six paths hand-built
 * their envelope with `c.json({ error: { message, code } })` instead of going
 * through `errorHandler`. The `X-Request-ID` header was there on all of them,
 * so the join key existed and simply was not in the body — on the 401 an
 * unauthenticated read gets, which is the single most common error the API
 * returns.
 *
 * Hand-built also meant `handOffToRequestLog` never ran, so the 504's entry in
 * Studio's Logs Explorer had no `errorCode` while every handler-routed failure
 * did.
 */

const FIXED_ID = "0d922e48-1f9f-4d0f-9a0a-2b3c4d5e6f70";

const driver = {
    withAuth: () => driver
} as unknown as DataDriver;

/** An adapter that refuses whatever it is handed, the way a real one would. */
const rejectingAdapter: AuthAdapter = {
    verifyRequest: async () => null
} as unknown as AuthAdapter;

const throwingAdapter: AuthAdapter = {
    verifyRequest: async () => { throw new Error("upstream is down"); }
} as unknown as AuthAdapter;

function app(build: (a: Hono<HonoEnv>) => void) {
    const a = new Hono<HonoEnv>();
    a.use("/api/*", requestId());
    build(a);
    return a;
}

async function envelope(res: Response) {
    return {
        header: res.headers.get(REQUEST_ID_HEADER),
        body: await res.json() as { error: { code: string; message: string; requestId?: string } }
    };
}

const withId = { headers: { [REQUEST_ID_HEADER]: FIXED_ID } };

describe("every error body carries the request id its header carries", () => {
    it("401 — no credential, `requireAuth` on", async () => {
        const a = app(x => {
            x.use("/api/*", createAdapterAuthMiddleware({ adapter: rejectingAdapter, driver }));
            x.get("/api/data/posts", c => c.json({ data: [] }));
        });

        const { header, body } = await envelope(await a.request("/api/data/posts", withId));
        expect(body.error.code).toBe("UNAUTHORIZED");
        expect(header).toBe(FIXED_ID);
        expect(body.error.requestId).toBe(header);
    });

    it("401 — a token that does not verify", async () => {
        const a = app(x => {
            x.use("/api/*", createAdapterAuthMiddleware({
                adapter: rejectingAdapter, driver, requireAuth: false
            }));
            x.get("/api/data/posts", c => c.json({ data: [] }));
        });

        const { header, body } = await envelope(await a.request("/api/data/posts", {
            headers: { ...withId.headers, authorization: "Bearer nope" }
        }));
        expect(body.error.code).toBe("UNAUTHORIZED");
        expect(body.error.message).toBe("Invalid or expired token");
        expect(body.error.requestId).toBe(header);
    });

    it("401 — the adapter itself threw", async () => {
        const a = app(x => {
            x.use("/api/*", createAdapterAuthMiddleware({ adapter: throwingAdapter, driver }));
            x.get("/api/data/posts", c => c.json({ data: [] }));
        });

        const { header, body } = await envelope(await a.request("/api/data/posts", withId));
        expect(body.error.code).toBe("UNAUTHORIZED");
        expect(body.error.requestId).toBe(header);
    });

    it("413 — the body limit", async () => {
        const a = app(x => {
            x.use("/api/*", bodyLimit({
                maxSize: 8,
                onError: (c) => errorHandler(
                    new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large. Maximum size is 1MB."),
                    c
                ) as Response
            }));
            x.post("/api/data/posts", c => c.json({ ok: true }));
        });

        const { header, body } = await envelope(await a.request("/api/data/posts", {
            method: "POST",
            headers: { ...withId.headers, "content-type": "application/json" },
            body: JSON.stringify({ title: "well past eight bytes" })
        }));
        expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
        expect(body.error.requestId).toBe(header);
    });

    it("504 — a function that outlasts its ceiling", async () => {
        const a = app(x => {
            x.use("/api/functions/*", createFunctionsRequestTimeout(5));
            x.get("/api/functions/slow", async () => {
                await new Promise(resolve => setTimeout(resolve, 200));
                return new Response("never seen");
            });
        });

        const { header, body } = await envelope(await a.request("/api/functions/slow", withId));
        expect(body.error.code).toBe("FUNCTION_TIMEOUT");
        expect(body.error.requestId).toBe(header);
    });

    it("mints an id when the caller sends none, and the body quotes that one", async () => {
        const a = app(x => {
            x.use("/api/*", createAdapterAuthMiddleware({ adapter: rejectingAdapter, driver }));
            x.get("/api/data/posts", c => c.json({ data: [] }));
        });

        const { header, body } = await envelope(await a.request("/api/data/posts"));
        expect(header).toMatch(/^[0-9a-f-]{36}$/);
        expect(body.error.requestId).toBe(header);
    });
});
