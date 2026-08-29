import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { createDataRateLimiter } from "../src/auth/rate-limiter";
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

    it("still buckets an unverifiable token by IP, so a forged one buys nothing", async () => {
        const { configureJwt } = await import("../src/auth/jwt");
        configureJwt({ secret: "test-secret-for-rate-limiter-identity-0123456789" });

        const app = bareApp({ anonymous: 1, user: 50 });

        expect((await hitWith(app, { authorization: "Bearer not-a-real-token" })).status).toBe(200);
        expect((await hitWith(app, { authorization: "Bearer not-a-real-token" })).status).toBe(429);
    });
});
