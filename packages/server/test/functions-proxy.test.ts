import { describe, expect, it, afterAll, beforeAll } from "@jest/globals";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";

/**
 * The `api` role forwarding `/api/functions/*` to the process that serves them.
 *
 * The thing most likely to break here, and to break quietly, is the caller's
 * identity. A function reads `c.get("user")`; if the hop drops or rewrites the
 * `Authorization` header, every handler still runs — it just runs anonymous, so
 * an authorised endpoint answers 401 and an optional-auth one answers 200 with
 * the wrong data. So the central test compares what a function sees through the
 * proxy against what the same function sees when called directly, rather than
 * asserting a status code.
 *
 * Two real HTTP servers, not a mocked `fetch`: the header handling, the body
 * streaming and the duplex requirement are all properties of the transport, and
 * a double would assert this file's idea of them instead of undici's.
 */

const FUNCTIONS_DIR = path.join(__dirname, "fixtures", "functions-proxy");
const JWT_SECRET = "functions-proxy-test-secret-1234567890";

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

const bootstrapper: BackendBootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return {
            driver: {
                fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
                fetchEntity: async () => undefined,
                saveEntity: async () => ({}),
                deleteEntity: async () => undefined,
                countCollection: async () => 0,
                checkUniqueField: async () => true,
                healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
                admin: { executeSql: async () => [] }
            },
            collections: [],
            internals: {}
        } as unknown as InitializedDriver;
    },
    async initializeAuth() {
        return { userService: {}, authRepository: {} };
    }
} as unknown as BackendBootstrapper;

async function buildBackend(over: Record<string, unknown>): Promise<Hono> {
    const app = new Hono();
    await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("jobs")],
        bootstrappers: [bootstrapper],
        auth: { jwtSecret: JWT_SECRET },
        ...over
    } as never);
    return app;
}

/**
 * Put a Hono app on a real ephemeral port and return its origin.
 *
 * Resolved from `serve`'s own listening callback rather than after a sleep: a
 * fixed delay is a race that only loses when the machine is busy, which in this
 * suite means "when jest is running everything else in parallel".
 */
function listen(app: Hono): Promise<{ url: string; server: ReturnType<typeof serve> }> {
    return new Promise(resolve => {
        const server = serve({ fetch: app.fetch, port: 0 }, (address: AddressInfo) => {
            resolve({ url: `http://127.0.0.1:${address.port}`, server });
        });
    });
}

let upstream: Awaited<ReturnType<typeof listen>>;
let apiServer: Awaited<ReturnType<typeof listen>>;
/** Call the api process over a real socket, so the proxy has an address to see. */
const callApi = (pathname: string, init?: RequestInit) => fetch(`${apiServer.url}${pathname}`, init);

beforeAll(async () => {
    // The functions process: serves functions, nothing else.
    const functionsApp = await buildBackend({
        functionsDir: FUNCTIONS_DIR,
        surfaces: { auth: false, data: false, storage: false, admin: false, cron: false, meta: false }
    });
    upstream = await listen(functionsApp);

    // The api process: everything but functions, which it forwards. On a real
    // port too — `app.request()` has no socket, so `getConnInfo` cannot report a
    // client address and the X-Forwarded-For behaviour would go untested.
    apiServer = await listen(await buildBackend({
        surfaces: { functions: false },
        functionsUpstream: upstream.url
    }));
});

afterAll(async () => {
    await new Promise<void>(resolve => apiServer.server.close(() => resolve()));
    await new Promise<void>(resolve => upstream.server.close(() => resolve()));
});

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("the api role forwarding /api/functions", () => {
    it("forwards a plain GET and returns the upstream's body", async () => {
        const res = await callApi("/api/functions/echo/hello");

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true });
    });

    it("shows the function the same caller it would see directly", async () => {
        // The assertion this file exists for. Not a status code: an identity
        // lost on the way through leaves every handler running, just anonymous.
        const token = generateAccessToken("user-42", ["editor"]);

        const direct = await (await fetch(`${upstream.url}/api/functions/echo/whoami`, bearer(token))).json();
        const proxied = await (await callApi("/api/functions/echo/whoami", bearer(token))).json();

        expect(proxied).toEqual(direct);
        expect(proxied).toMatchObject({ uid: "user-42", roles: ["editor"] });
    });

    it("passes the query string through untouched", async () => {
        const res = await callApi("/api/functions/echo/query?a=1&b=two%20words");

        expect(await res.json()).toMatchObject({ a: "1", b: "two words" });
    });

    it("forwards a POST body and its content type", async () => {
        const res = await callApi("/api/functions/echo/body", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hello: "world" })
        });

        expect(await res.json()).toMatchObject({ received: { hello: "world" } });
    });

    it("preserves the upstream's status code", async () => {
        // A function's own 4xx must arrive as itself. Collapsing it to 200 or
        // 500 on the way through would make every error look like a proxy fault.
        expect((await callApi("/api/functions/echo/teapot")).status).toBe(418);
    });

    it("appends the client address to X-Forwarded-For", async () => {
        // Without this every forwarded request reaches the upstream from one
        // address — the api pod's — so all callers share a rate-limit bucket and
        // every login is logged from the same IP.
        const res = await callApi("/api/functions/echo/headers", {
            headers: { "x-forwarded-for": "203.0.113.7" }
        });
        const body = await res.json() as { forwardedFor?: string };

        expect(body.forwardedFor).toMatch(/^203\.0\.113\.7, /);
    });

    it("does not claim the body is still gzipped after fetch decoded it", async () => {
        // The runtime compresses its own responses, so every forwarded response
        // arrives carrying `content-encoding: gzip` — and undici has already
        // gunzipped the body by the time the proxy sees it. Copying the header
        // across tells the client to decode plain bytes, which does not fail
        // cleanly: it hangs. Asserted directly because a hang is a terrible
        // failure signal to leave a future reader with.
        const res = await callApi("/api/functions/echo/hello", {
            headers: { "accept-encoding": "gzip" }
        });

        // That the body parses at all is the assertion. There is no header to
        // check on this side: the api process legitimately re-compresses on its
        // own way out, so `content-encoding: gzip` here is correct — what was
        // wrong was claiming it over a body that had already been decoded once.
        // A regression shows up as this call never resolving — a timeout on this
        // test rather than an assertion failure. Left on the default budget on
        // purpose: a tighter one would also fail on a busy machine, and a flaky
        // test that cries wolf about a real bug is worse than a slow one.
        expect(await res.json()).toMatchObject({ ok: true });
    });

    it("does not forward the api process's Host header", async () => {
        // Forwarded unchanged it names the wrong service, and an upstream doing
        // any virtual-host routing answers for it.
        const body = await (await callApi("/api/functions/echo/headers")).json() as { host?: string };

        expect(body.host).not.toContain("localhost:80");
        expect(body.host).toContain(new URL(upstream.url).host);
    });

    it("answers 502, naming the upstream, when it cannot be reached", async () => {
        const broken = await buildBackend({
            surfaces: { functions: false },
            // Port 1 is reserved and never listening.
            functionsUpstream: "http://127.0.0.1:1"
        });

        const res = await broken.request("/api/functions/anything");

        expect(res.status).toBe(502);
        expect(await res.json()).toMatchObject({
            error: { code: "FUNCTIONS_UPSTREAM_UNREACHABLE" }
        });
    });

    it("serves the functions itself, and does not forward, when the surface is on", async () => {
        // Both configured is a deployment mistake; the local copy must not
        // silently win over a stated upstream, so the surface decides.
        const both = await buildBackend({
            functionsDir: FUNCTIONS_DIR,
            functionsUpstream: "http://127.0.0.1:1"
        });

        // Reaches the local function rather than the unreachable upstream.
        expect((await both.request("/api/functions/echo/hello")).status).toBe(200);
    });
});
