import { createRateLimiter } from "../src/auth/rate-limiter";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";

describe("Rate Limiter", () => {

    function createTestApp(options: { windowMs?: number; limit?: number } = {}) {
        const app = new Hono<HonoEnv>();
        const limiter = createRateLimiter({
            windowMs: options.windowMs ?? 60 * 1000, // 1 minute
            limit: options.limit ?? 3,
            keyGenerator: (c) => c.req.header("x-forwarded-for") || "test-ip"
        });
        app.use("/api/*", limiter);
        app.get("/api/test", (c) => c.json({ ok: true }));
        return app;
    }

    it("allows requests under the limit", async () => {
        const app = createTestApp({ limit: 5 });

        const res = await app.request("/api/test", {
            headers: { "x-forwarded-for": "1.2.3.4" }
        });

        expect(res.status).toBe(200);
        expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
        expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
    });

    it("returns 429 when limit is exceeded", async () => {
        const app = createTestApp({ limit: 2 });

        // First two should pass
        await app.request("/api/test", { headers: { "x-forwarded-for": "10.0.0.1" } });
        await app.request("/api/test", { headers: { "x-forwarded-for": "10.0.0.1" } });

        // Third should be rate limited
        const res = await app.request("/api/test", {
            headers: { "x-forwarded-for": "10.0.0.1" }
        });

        expect(res.status).toBe(429);
        const body = await res.json() as any;
        expect(body.error.code).toBe("RATE_LIMITED");
    });

    it("includes Retry-After header when rate limited", async () => {
        // `Headers.get` returns null for a header that was never set, and
        // `expect(null).toBeDefined()` passes — so the old assertion here was
        // green whether or not the header existed. Retry-After is the only thing
        // that tells a client when to come back, so the value is what matters:
        // the window is 60s and the blocked request follows the first one inside
        // the same second, leaving a full 60 to wait.
        const app = createTestApp({ limit: 1,
windowMs: 60 * 1000 });

        await app.request("/api/test", { headers: { "x-forwarded-for": "10.0.0.2" } });
        const before = Date.now();
        const res = await app.request("/api/test", {
            headers: { "x-forwarded-for": "10.0.0.2" }
        });

        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBe("60");
        expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");

        // The reset stamp is a unix time in seconds, not a duration.
        const reset = Number(res.headers.get("X-RateLimit-Reset"));
        expect(reset).toBeGreaterThanOrEqual(Math.floor((before + 59 * 1000) / 1000));
        expect(reset).toBeLessThanOrEqual(Math.ceil((Date.now() + 60 * 1000) / 1000));
    });

    it("does not send Retry-After on an allowed request", async () => {
        // The counterpart: a header emitted unconditionally would satisfy the
        // test above while telling every successful caller to back off.
        const app = createTestApp({ limit: 5 });

        const res = await app.request("/api/test", { headers: { "x-forwarded-for": "10.0.0.3" } });

        expect(res.status).toBe(200);
        expect(res.headers.get("Retry-After")).toBeNull();
    });

    it("tracks different IPs separately", async () => {
        const app = createTestApp({ limit: 1 });

        const res1 = await app.request("/api/test", {
            headers: { "x-forwarded-for": "ip-a" }
        });
        const res2 = await app.request("/api/test", {
            headers: { "x-forwarded-for": "ip-b" }
        });

        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
    });

    it("decrements remaining count with each request", async () => {
        const app = createTestApp({ limit: 3 });
        const ip = "counter-ip";

        const r1 = await app.request("/api/test", { headers: { "x-forwarded-for": ip } });
        expect(r1.headers.get("X-RateLimit-Remaining")).toBe("2");

        const r2 = await app.request("/api/test", { headers: { "x-forwarded-for": ip } });
        expect(r2.headers.get("X-RateLimit-Remaining")).toBe("1");

        const r3 = await app.request("/api/test", { headers: { "x-forwarded-for": ip } });
        expect(r3.headers.get("X-RateLimit-Remaining")).toBe("0");
    });

    it("uses custom message", async () => {
        const app = new Hono<HonoEnv>();
        const limiter = createRateLimiter({
            limit: 0,
            message: "Slow down!",
            keyGenerator: () => "always-same"
        });
        app.use("/api/*", limiter);
        app.get("/api/test", (c) => c.json({ ok: true }));

        const res = await app.request("/api/test");
        const body = await res.json() as any;
        expect(body.error.message).toBe("Slow down!");
    });

    describe("X-Forwarded-For trust (default key generator)", () => {
        function appWith(options: { limit?: number; trustedProxyHops?: number } = {}) {
            const app = new Hono<HonoEnv>();
            // No custom keyGenerator: exercise the real defaultKeyGenerator.
            app.use("/api/*", createRateLimiter({
                windowMs: 60 * 1000,
                limit: options.limit ?? 1,
                trustedProxyHops: options.trustedProxyHops
            }));
            app.get("/api/test", (c) => c.json({ ok: true }));
            return app;
        }

        /**
         * The default is the one value the other cases never exercise — every
         * test below passes `trustedProxyHops` explicitly, which is exactly how
         * a default of 1 survived: `X-Forwarded-For` was believed on any server
         * with no proxy in front of it, so one header per request reset every
         * IP-keyed limiter in the process.
         */
        it("does not trust X-Forwarded-For when nothing configured a proxy", async () => {
            const saved = process.env.TRUSTED_PROXY_HOPS;
            delete process.env.TRUSTED_PROXY_HOPS;
            try {
                const app = appWith({ limit: 1 }); // no trustedProxyHops, no env

                const first = await app.request("/api/test", {
                    headers: { "x-forwarded-for": "1.1.1.1" }
                });
                expect(first.status).toBe(200);

                // A different spoofed address must NOT buy a fresh bucket.
                const second = await app.request("/api/test", {
                    headers: { "x-forwarded-for": "2.2.2.2" }
                });
                expect(second.status).toBe(429);
            } finally {
                if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
                else process.env.TRUSTED_PROXY_HOPS = saved;
            }
        });

        it("honours TRUSTED_PROXY_HOPS from the environment", async () => {
            const saved = process.env.TRUSTED_PROXY_HOPS;
            process.env.TRUSTED_PROXY_HOPS = "1";
            try {
                const app = appWith({ limit: 1 }); // opted in via env only

                const first = await app.request("/api/test", {
                    headers: { "x-forwarded-for": "spoof-1, 9.9.9.9" }
                });
                expect(first.status).toBe(200);

                const second = await app.request("/api/test", {
                    headers: { "x-forwarded-for": "spoof-2, 9.9.9.9" }
                });
                expect(second.status).toBe(429);
            } finally {
                if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
                else process.env.TRUSTED_PROXY_HOPS = saved;
            }
        });

        it("ignores client-prepended X-Forwarded-For entries (1 trusted hop)", async () => {
            const app = appWith({ limit: 1, trustedProxyHops: 1 });

            // The proxy appended the real client (9.9.9.9); the leftmost entry is
            // attacker-controlled. Varying it must NOT create a fresh bucket.
            const first = await app.request("/api/test", {
                headers: { "x-forwarded-for": "spoof-1, 9.9.9.9" }
            });
            expect(first.status).toBe(200);

            const second = await app.request("/api/test", {
                headers: { "x-forwarded-for": "spoof-2, 9.9.9.9" }
            });
            expect(second.status).toBe(429);
        });

        it("ignores X-Forwarded-For entirely when trustedProxyHops is 0", async () => {
            const app = appWith({ limit: 1, trustedProxyHops: 0 });

            const first = await app.request("/api/test", {
                headers: { "x-forwarded-for": "1.1.1.1" }
            });
            expect(first.status).toBe(200);

            const second = await app.request("/api/test", {
                headers: { "x-forwarded-for": "2.2.2.2" }
            });
            expect(second.status).toBe(429);
        });

        it("ignores X-Real-IP too when trustedProxyHops is 0", async () => {
            // `trustedProxyHops: 0` means "nothing is in front of me", and
            // `X-Real-IP` is a proxy header exactly like `X-Forwarded-For`. With
            // no proxy, the only thing that writes it is the caller — so
            // believing it handed them the rate-limit key. One header per
            // request bought a fresh bucket every time, and the limiters on
            // login, registration and password reset counted to one.
            //
            // This test used to assert the opposite ("only X-Real-IP is
            // believed"), which is why the hole survived a careful reading of
            // the XFF logic sitting three lines above it.
            const app = appWith({ limit: 1, trustedProxyHops: 0 });

            const first = await app.request("/api/test", {
                headers: { "x-real-ip": "8.8.8.8" }
            });
            expect(first.status).toBe(200);

            const second = await app.request("/api/test", {
                headers: { "x-real-ip": "8.8.4.4" }
            });
            expect(second.status).toBe(429);

            // And a third spelling, to make the point that it is not about
            // these two values.
            const third = await app.request("/api/test", {
                headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9" }
            });
            expect(third.status).toBe(429);
        });

        it("still believes X-Real-IP when a proxy is declared to be in front", async () => {
            // The stock nginx recipe sets `X-Real-IP` and nothing else, so a
            // deployment that declares a hop must keep working.
            const app = appWith({ limit: 1, trustedProxyHops: 1 });

            const first = await app.request("/api/test", { headers: { "x-real-ip": "8.8.8.8" } });
            expect(first.status).toBe(200);

            // A different client, per the proxy: its own bucket.
            const other = await app.request("/api/test", { headers: { "x-real-ip": "8.8.4.4" } });
            expect(other.status).toBe(200);

            // The first client again: its bucket is spent.
            const again = await app.request("/api/test", { headers: { "x-real-ip": "8.8.8.8" } });
            expect(again.status).toBe(429);
        });
    });
});
