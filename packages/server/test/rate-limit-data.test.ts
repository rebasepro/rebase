import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import { createDataRateLimiter, createDataRateLimitCheck } from "../src/auth/rate-limiter";
import { MemoryRateLimitStore, RateLimitStore } from "../src/auth/rate-limit-store";

/**
 * The data API's limiter buckets every request: an API key by its id, a
 * signed-in user by their uid, anyone else by IP.
 *
 * Only the first of those used to be limited at all — the middleware returned
 * early for any request carrying no API key — so JWT and anonymous traffic to
 * `/api/data/*` was unbounded, which is most of what a BaaS serves.
 */
describe("createDataRateLimiter", () => {
    let store: MemoryRateLimitStore;

    beforeEach(() => {
        store = new MemoryRateLimitStore();
    });

    afterEach(() => {
        store.dispose();
    });

    /** An app whose principal is whatever `principal` sets on the context. */
    const appWith = (
        principal: (c: Parameters<Parameters<Hono["use"]>[1]>[0]) => void,
        config: Parameters<typeof createDataRateLimiter>[0] = {}
    ) => {
        const app = new Hono();
        app.use("/*", async (c, next) => {
            principal(c as never);
            await next();
        });
        app.use("/*", createDataRateLimiter({ store,
...config }));
        app.get("/data", (c) => c.json({ ok: true }));
        return app;
    };

    const hit = (app: Hono, ip = "1.2.3.4") =>
        app.fetch(new Request("http://localhost/data", { headers: { "x-real-ip": ip } }));

    /**
     * The service key is the deployment's own credential. It already reaches
     * every row, so throttling it protects nothing that is not already open to
     * whoever holds it — while reliably breaking the backfills and migrations
     * the key exists for. It used to be bucketed as `user:service` and given
     * the ordinary signed-in allowance, and a managed deployment has no
     * `rateLimit` surface to raise.
     */
    it("never limits the service identity", async () => {
        const app = appWith((c) => c.set("user", { uid: "service", roles: ["admin"] }), { user: 2 });

        for (let i = 0; i < 25; i += 1) {
            expect((await hit(app)).status).toBe(200);
        }
    });

    it("does not let the service identity spend another bucket's allowance", async () => {
        // Skipping the limiter must mean skipping the counter too: if the
        // service key still hit the store, a backfill would exhaust the bucket
        // for whoever shares its key and lock real callers out.
        const app = new Hono();
        app.use("/*", async (c, next) => {
            c.set("user", c.req.header("x-as-service") ? { uid: "service", roles: ["admin"] } : { uid: "user-1" });
            await next();
        });
        app.use("/*", createDataRateLimiter({ store, user: 2 }));
        app.get("/data", (c) => c.json({ ok: true }));

        for (let i = 0; i < 10; i += 1) {
            const res = await app.fetch(new Request("http://localhost/data", { headers: { "x-as-service": "1" } }));
            expect(res.status).toBe(200);
        }
        // user-1 still has its full allowance of 2.
        expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(200);
        expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(200);
        expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(429);
    });

    it("limits a signed-in user, which nothing did before", async () => {
        const app = appWith((c) => c.set("user", { uid: "user-1" }), { user: 2 });

        expect((await hit(app)).status).toBe(200);
        expect((await hit(app)).status).toBe(200);
        const limited = await hit(app);

        expect(limited.status).toBe(429);
        expect(await limited.json()).toEqual({ error: { message: expect.any(String),
code: "RATE_LIMITED" } });
        expect(limited.headers.get("Retry-After")).toBeTruthy();
    });

    it("gives each user their own allowance", async () => {
        const appA = appWith((c) => c.set("user", { uid: "user-a" }), { user: 1 });
        const appB = appWith((c) => c.set("user", { uid: "user-b" }), { user: 1 });

        expect((await hit(appA)).status).toBe(200);
        expect((await hit(appA)).status).toBe(429);
        // A different user is a different bucket, even on a shared store.
        expect((await hit(appB)).status).toBe(200);
    });

    it("limits anonymous callers per IP", async () => {
        // `hit` distinguishes callers with `X-Real-IP`, which is a proxy header:
        // it is only evidence of anything when a proxy has been declared. The
        // default is now to trust no hops, so a test that simulates two clients
        // through a proxy header has to say the proxy is there — otherwise both
        // collapse into the socket's bucket, which is the correct behaviour for
        // a directly-exposed server and is asserted in `rate-limiter.test.ts`.
        const app = appWith(() => undefined, { anonymous: 1, trustedProxyHops: 1 });

        expect((await hit(app, "9.9.9.9")).status).toBe(200);
        expect((await hit(app, "9.9.9.9")).status).toBe(429);
        // A different caller is unaffected.
        expect((await hit(app, "8.8.8.8")).status).toBe(200);
    });

    it("treats the anon principal as anonymous, not as a user named 'anon'", async () => {
        // The auth middleware scopes unauthenticated requests as `anon` so RLS
        // can evaluate them — all of them, so they must not share one bucket
        // and they must not be counted as a signed-in user.
        // Same reason as above: two callers are simulated through a proxy
        // header, so the proxy has to be declared.
        const app = appWith((c) => c.set("user", { uid: "anon" }), { anonymous: 1,
user: 100,
trustedProxyHops: 1 });

        expect((await hit(app, "7.7.7.7")).status).toBe(200);
        expect((await hit(app, "7.7.7.7")).status).toBe(429);
        expect((await hit(app, "6.6.6.6")).status).toBe(200);
    });

    it("honours an API key's own limit over the default", async () => {
        const app = appWith((c) => c.set("apiKey", { id: "key-1",
rate_limit: 1 }), { apiKey: 500 });

        expect((await hit(app)).status).toBe(200);
        expect((await hit(app)).status).toBe(429);
    });

    it("falls back to the configured API-key limit when the key sets none", async () => {
        const app = appWith((c) => c.set("apiKey", { id: "key-2",
rate_limit: null }), { apiKey: 1 });

        expect((await hit(app)).status).toBe(200);
        expect((await hit(app)).status).toBe(429);
    });

    it("prefers the API key's bucket over the user's", async () => {
        const app = appWith((c) => {
            c.set("apiKey", { id: "key-3",
rate_limit: 1 });
            c.set("user", { uid: "user-1" });
        }, { user: 100 });

        expect((await hit(app)).status).toBe(200);
        // Limited by the key (1), not the user (100).
        expect((await hit(app)).status).toBe(429);
    });

    it("reports what is left", async () => {
        const app = appWith((c) => c.set("user", { uid: "user-h" }), { user: 5 });

        const res = await hit(app);
        expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
        expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
    });
});

/**
 * The same buckets, for a door that is not an HTTP request.
 *
 * The realtime socket serves the same rows the data API does, one frame per
 * request, and used to count them only per connection — so opening more
 * connections bought more budget. It counts through this check now, which must
 * put a caller in the bucket the HTTP limiter would, or the two doors are two
 * allowances.
 */
describe("createDataRateLimitCheck", () => {
    let store: MemoryRateLimitStore;

    beforeEach(() => {
        store = new MemoryRateLimitStore();
    });

    afterEach(() => {
        store.dispose();
    });

    const from = (uid: string | undefined, address = "5.5.5.5") => ({
        uid,
        header: (name: string) => name === "x-forwarded-for" ? address : undefined,
        socketAddress: "10.0.0.1"
    });

    it("spends the allowance the HTTP limiter spends, for the same person", async () => {
        const app = new Hono();
        app.use("/*", async (c, next) => {
            c.set("user" as never, { uid: "user-1" } as never);
            await next();
        });
        app.use("/*", createDataRateLimiter({ store, user: 3 }));
        app.get("/data", (c) => c.json({ ok: true }));
        const check = createDataRateLimitCheck({ store, user: 3 });

        expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(200);
        expect((await check(from("user-1")))?.allowed).toBe(true);
        expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(200);
        // Three spent between the two doors.
        expect((await check(from("user-1")))?.allowed).toBe(false);
        expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(429);
    });

    it("counts an API key's frames in the key's own bucket, at the key's own limit", async () => {
        // The key's `rate_limit` is what the API keys panel shows. Bucketed as
        // its uid instead, a key limited to 2 got the per-user 100 over the
        // socket, on top of its 2 over HTTP.
        const key = { id: "k1", rate_limit: 2 };
        const app = new Hono();
        app.use("/*", async (c, next) => {
            c.set("user" as never, { uid: "api-key:k1" } as never);
            c.set("apiKey" as never, key as never);
            await next();
        });
        app.use("/*", createDataRateLimiter({ store, user: 100, apiKey: 100 }));
        app.get("/data", (c) => c.json({ ok: true }));
        const check = createDataRateLimitCheck({ store, user: 100, apiKey: 100 });
        const asKey = { ...from("api-key:k1"), apiKey: key };

        expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(200);
        expect((await check(asKey))?.allowed).toBe(true);
        // Two spent between the two doors: the key's own allowance is gone.
        expect((await check(asKey))?.allowed).toBe(false);
        expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(429);

        // A key with no limit of its own gets the API-key default, not the user one.
        const unlimited = { ...from("api-key:k2"), apiKey: { id: "k2", rate_limit: null } };
        const strict = createDataRateLimitCheck({ store, user: 100, apiKey: 1 });
        expect((await strict(unlimited))?.allowed).toBe(true);
        expect((await strict(unlimited))?.allowed).toBe(false);
    });

    it("never limits the service identity", async () => {
        const check = createDataRateLimitCheck({ store, user: 1 });
        expect(await check(from("service"))).toBeNull();
        expect(await check(from("service"))).toBeNull();
    });

    it("buckets a caller with no account by address, at the anonymous allowance", async () => {
        const check = createDataRateLimitCheck({ store, anonymous: 1, user: 100, trustedProxyHops: 1 });

        expect((await check(from(undefined, "9.9.9.9")))?.allowed).toBe(true);
        expect((await check(from("anon", "9.9.9.9")))?.allowed).toBe(false);
        expect((await check(from(undefined, "8.8.8.8")))?.allowed).toBe(true);
    });

    it("reads the connection's own address when no proxy is declared", async () => {
        const check = createDataRateLimitCheck({ store, anonymous: 1 });

        expect((await check(from(undefined, "9.9.9.9")))?.allowed).toBe(true);
        // A different forwarded address from the same connection is the same caller.
        expect((await check(from(undefined, "8.8.8.8")))?.allowed).toBe(false);
    });
});

interface StoreHarness {
    store: RateLimitStore;
    /**
     * Move the store's clock forward. Windows are asserted by advancing this
     * rather than by sleeping: a real sleep of half a window overruns it on a
     * loaded machine, and the window-sliding assertions then flip.
     */
    advance: (ms: number) => Promise<void>;
}

/**
 * The store contract, run against every implementation. A Postgres-backed store
 * (so several replicas share one limit) has to satisfy exactly this.
 */
describe.each<[string, () => StoreHarness]>([
    ["MemoryRateLimitStore", () => {
        let clock = 1_700_000_000_000;
        return {
            store: new MemoryRateLimitStore(15 * 60 * 1000, () => clock),
            advance: async (ms) => {
                clock += ms;
            }
        };
    }]
])("%s satisfies the RateLimitStore contract", (_name, create) => {
    let store: RateLimitStore;
    let advance: StoreHarness["advance"];

    beforeEach(() => {
        ({ store, advance } = create());
    });

    afterEach(() => {
        store.dispose?.();
    });

    it("allows up to the limit, then refuses", async () => {
        expect((await store.hit("k", 60_000, 2)).allowed).toBe(true);
        expect((await store.hit("k", 60_000, 2)).allowed).toBe(true);
        expect((await store.hit("k", 60_000, 2)).allowed).toBe(false);
    });

    it("counts down what is remaining", async () => {
        expect((await store.hit("k", 60_000, 3)).remaining).toBe(2);
        expect((await store.hit("k", 60_000, 3)).remaining).toBe(1);
        expect((await store.hit("k", 60_000, 3)).remaining).toBe(0);
    });

    it("keeps keys apart", async () => {
        expect((await store.hit("a", 60_000, 1)).allowed).toBe(true);
        expect((await store.hit("a", 60_000, 1)).allowed).toBe(false);
        expect((await store.hit("b", 60_000, 1)).allowed).toBe(true);
    });

    it("says how long to wait when it refuses", async () => {
        await store.hit("k", 60_000, 1);
        const refused = await store.hit("k", 60_000, 1);

        expect(refused.allowed).toBe(false);
        expect(refused.retryAfterMs).toBeGreaterThan(0);
        expect(refused.retryAfterMs).toBeLessThanOrEqual(60_000);
        expect(refused.remaining).toBe(0);
    });

    it("forgets hits that have left the window", async () => {
        expect((await store.hit("k", 1_000, 1)).allowed).toBe(true);
        await advance(1_001);
        expect((await store.hit("k", 1_000, 1)).allowed).toBe(true);
    });

    it("slides rather than resetting on a boundary", async () => {
        // A fixed window would let a caller spend its whole allowance at the
        // end of one window and again at the start of the next.
        await store.hit("k", 1_000, 2);
        await store.hit("k", 1_000, 2);
        await advance(600);
        // Past where a fixed window would have reset, and the two earlier hits
        // are still in the sliding one.
        expect((await store.hit("k", 1_000, 2)).allowed).toBe(false);
        // They leave it only once they are a full window old.
        await advance(401);
        expect((await store.hit("k", 1_000, 2)).allowed).toBe(true);
    });
});

/**
 * The limiter also has to recognise a caller whose auth middleware has not run
 * yet.
 *
 * On the storage router it never has: the limiter is registered before
 * `route("/")` so that it actually guards the routes, and the JWT middlewares
 * live inside them. A signed-in caller therefore arrived with an empty context
 * and was bucketed `ip:` at the anonymous allowance — 300 shared by everyone
 * behind one address, where a signed-in user should have had 1000 of their own.
 * The admin panel mints a download token per file, so a single page of
 * thumbnails spent the budget and every image on it failed with a 429.
 */
describe("createDataRateLimiter — identity with no auth middleware ahead of it", () => {
    let store: MemoryRateLimitStore;

    beforeEach(() => {
        store = new MemoryRateLimitStore();
    });

    afterEach(() => {
        store.dispose();
    });

    /** No principal middleware at all — the storage router's actual shape. */
    const bareApp = (config: Parameters<typeof createDataRateLimiter>[0] = {}) => {
        const app = new Hono();
        app.use("/*", createDataRateLimiter({ store, ...config }));
        app.get("/file", (c) => c.json({ ok: true }));
        return app;
    };

    const hitWith = (app: Hono, headers: Record<string, string>) =>
        app.fetch(new Request("http://localhost/file", { headers: { "x-real-ip": "9.9.9.9", ...headers } }));

    it("gives a bearer-token caller the user allowance, not the anonymous one", async () => {
        const { configureJwt, generateAccessToken } = await import("../src/auth/jwt");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });
        const token = await generateAccessToken("user-with-token", []);

        const app = bareApp({ anonymous: 1, user: 3 });

        // Three requests: past the anonymous allowance of 1, inside the user
        // allowance of 3. Before this, the second was a 429.
        expect((await hitWith(app, { authorization: `Bearer ${token}` })).status).toBe(200);
        expect((await hitWith(app, { authorization: `Bearer ${token}` })).status).toBe(200);
        expect((await hitWith(app, { authorization: `Bearer ${token}` })).status).toBe(200);
        expect((await hitWith(app, { authorization: `Bearer ${token}` })).status).toBe(429);
    });

    it("buckets two signed-in callers separately even from one address", async () => {
        const { configureJwt, generateAccessToken } = await import("../src/auth/jwt");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });
        const one = await generateAccessToken("caller-one", []);
        const two = await generateAccessToken("caller-two", []);

        const app = bareApp({ anonymous: 1, user: 1 });

        expect((await hitWith(app, { authorization: `Bearer ${one}` })).status).toBe(200);
        // Same IP, different person: their own budget, not the first one's.
        expect((await hitWith(app, { authorization: `Bearer ${two}` })).status).toBe(200);
        expect((await hitWith(app, { authorization: `Bearer ${one}` })).status).toBe(429);
    });

    /**
     * An `<img src=…/file/x?token=…>` carries no Authorization header, so a
     * signed-in editor's thumbnails were bucketed by IP at the anonymous
     * allowance — 300 per 15 minutes for everyone behind one office NAT, and
     * the 301st image load a 429 while the same editor's API calls went
     * through. The download token now carries an opaque mark of the user who
     * minted it, and the read is charged to that user.
     */
    it("charges a download-token read to the user who minted it, not to the address", async () => {
        const { configureJwt, generateDownloadToken } = await import("../src/auth/jwt");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });
        const editor = await generateDownloadToken("default/a.png", 300, undefined, "editor-1");
        const other = await generateDownloadToken("default/a.png", 300, undefined, "editor-2");

        const app = bareApp({ anonymous: 1, user: 3 });
        const read = (token: string) => app.fetch(new Request(`http://localhost/file?token=${token}`, { headers: { "x-real-ip": "9.9.9.9" } }));

        expect((await read(editor)).status).toBe(200);
        expect((await read(editor)).status).toBe(200);
        expect((await read(editor)).status).toBe(200);
        expect((await read(editor)).status).toBe(429);
        // Same address, another editor: their own allowance.
        expect((await read(other)).status).toBe(200);
    });

    it("keeps the minting user out of the token in the clear", async () => {
        const { configureJwt, generateDownloadToken } = await import("../src/auth/jwt");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });
        const token = await generateDownloadToken("default/a.png", 300, undefined, "editor-with-a-findable-uid");
        const payload = Buffer.from(token.split(".")[1], "base64url").toString("utf-8");
        expect(payload).not.toContain("editor-with-a-findable-uid");
    });

    it("charges a download token minted for nobody to the address, as before", async () => {
        const { configureJwt, generateDownloadToken } = await import("../src/auth/jwt");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });
        const token = await generateDownloadToken("default/a.png", 300);

        const app = bareApp({ anonymous: 1, user: 50 });
        const read = () => app.fetch(new Request(`http://localhost/file?token=${token}`, { headers: { "x-real-ip": "9.9.9.9" } }));
        expect((await read()).status).toBe(200);
        expect((await read()).status).toBe(429);
    });

    /**
     * `rebase.storage` in functions and cron sends the internal service key,
     * which is not a JWT, and the storage router's limiter runs before any auth
     * middleware has put the service identity on the context — so a cron job
     * processing 300 files got 429s, and every call logged a verification
     * failure carrying the first characters of the key.
     */
    it("never limits the service key, recognised before any auth middleware", async () => {
        const { configureJwt } = await import("../src/auth/jwt");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });
        const serviceKey = "svc_" + "k".repeat(60);

        const app = bareApp({ anonymous: 1, user: 1, serviceKey });

        for (let i = 0; i < 5; i++) {
            expect((await hitWith(app, { authorization: `Bearer ${serviceKey}` })).status).toBe(200);
        }
        // A key that is not the service key buys nothing.
        expect((await hitWith(app, { authorization: `Bearer ${serviceKey}x` })).status).toBe(200);
        expect((await hitWith(app, { authorization: `Bearer ${serviceKey}x` })).status).toBe(429);
    });

    it("never writes any part of a refused token to the log", async () => {
        const { configureJwt, verifyAccessToken } = await import("../src/auth/jwt");
        const { logger } = await import("../src/utils/logger");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });
        const error = jest.spyOn(logger, "error").mockImplementation(() => undefined);
        try {
            expect(await verifyAccessToken("svc_secretsecretsecret")).toBeNull();
            expect(JSON.stringify(error.mock.calls)).not.toContain("svc_secret");
        } finally {
            error.mockRestore();
        }
    });

    it("still buckets an unverifiable token by IP, so a forged one buys nothing", async () => {
        const { configureJwt } = await import("../src/auth/jwt");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });

        const app = bareApp({ anonymous: 1, user: 50 });

        expect((await hitWith(app, { authorization: "Bearer not-a-real-token" })).status).toBe(200);
        expect((await hitWith(app, { authorization: "Bearer not-a-real-token" })).status).toBe(429);
    });
});
