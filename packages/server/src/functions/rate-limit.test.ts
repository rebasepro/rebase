import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../api/types";
import type { BackendServices } from "../backend/services";
import { MemoryRateLimitStore, type RateLimitStore } from "../auth/rate-limit-store";
import { defaultJwtService } from "../auth/jwt";
import { processAccessControl } from "../auth/access";
import { createAuthLimiters } from "../auth/rate-limiter";
import { checkRateLimit, clientAddress, rateLimit } from "./rate-limit";

/** A backend's services, as far as these helpers read them. */
function services(extra: Partial<BackendServices>): BackendServices {
    return {
        jwt: defaultJwtService(),
        access: processAccessControl,
        authLimiters: createAuthLimiters(),
        tables: () => [],
        ...extra
    };
}

/** One "process": its own Hono app, given the backend's services by middleware, as `provideServices` does. */
function app(svc: BackendServices | undefined, limitName = "invite") {
    const a = new Hono<HonoEnv>();
    if (svc) a.use("/*", async (c, next) => { c.set("services", svc); await next(); });
    a.post("/invite", rateLimit({ name: limitName, limit: 2, windowMs: 60_000 }), (c) => c.json({ ok: true }));
    a.get("/who", (c) => c.text(clientAddress(c)));
    a.get("/check", async (c) => c.json(await checkRateLimit(c, { name: "tts", limit: 1, windowMs: 60_000, key: c.req.query("u") })));
    return a;
}

describe("rateLimit in a function", () => {
    it("counts in the backend's shared store, so two processes share one allowance", async () => {
        // Counted: both "processes" here share one module, and with it the
        // memory fallback, so only the hits prove the shared store was used.
        const inner = new MemoryRateLimitStore(60_000);
        let hits = 0;
        const shared: RateLimitStore = { hit: (k, w, l) => { hits++; return inner.hit(k, w, l); } };
        const svc = services({ rateLimitStore: shared, clientAddress: () => "1.2.3.4" });
        const replicaA = app(svc), replicaB = app(svc);

        expect((await replicaA.request("/invite", { method: "POST" })).status).toBe(200);
        expect((await replicaB.request("/invite", { method: "POST" })).status).toBe(200);
        const third = await replicaA.request("/invite", { method: "POST" });
        expect(third.status).toBe(429);
        expect(third.headers.get("Retry-After")).toBeTruthy();
        expect(await third.json()).toEqual({ error: { message: "Too many requests, please try again later.", code: "RATE_LIMITED" } });
        expect(hits).toBe(3);
    });

    it("keys by the backend's client address, not a header the caller wrote", async () => {
        const svc = services({ clientAddress: () => "10.0.0.7" });
        const res = await app(svc).request("/who", { headers: { "x-forwarded-for": "6.6.6.6" } });
        expect(await res.text()).toBe("10.0.0.7");
        // Outside a backend there is no address to read: one shared bucket.
        expect(await (await app(undefined).request("/who")).text()).toBe("unknown");
    });

    it("keeps separate counts per limit name and per key", async () => {
        const shared = new MemoryRateLimitStore(60_000);
        const svc = services({ rateLimitStore: shared, clientAddress: () => "1.1.1.1" });
        const invites = app(svc, "invite"), others = app(svc, "report");
        await invites.request("/invite", { method: "POST" });
        await invites.request("/invite", { method: "POST" });
        expect((await invites.request("/invite", { method: "POST" })).status).toBe(429);
        expect((await others.request("/invite", { method: "POST" })).status).toBe(200);

        const first = await (await invites.request("/check?u=alice")).json() as { allowed: boolean };
        const again = await (await invites.request("/check?u=alice")).json() as { allowed: boolean };
        const bob = await (await invites.request("/check?u=bob")).json() as { allowed: boolean };
        expect([first.allowed, again.allowed, bob.allowed]).toEqual([true, false, true]);
    });

    it("counts in memory without a shared store", async () => {
        const svc = services({ clientAddress: () => "9.9.9.9" });
        const a = app(svc, "memory-only");
        await a.request("/invite", { method: "POST" });
        await a.request("/invite", { method: "POST" });
        expect((await a.request("/invite", { method: "POST" })).status).toBe(429);
    });

    it("refuses a limit with no name or a nonsense size", () => {
        expect(() => rateLimit({ name: "", limit: 1, windowMs: 1 })).toThrow(/name/);
        expect(() => rateLimit({ name: "x", limit: 0, windowMs: 1 })).toThrow(/limit/);
        expect(() => rateLimit({ name: "x", limit: 1, windowMs: 0 })).toThrow(/windowMs/);
    });
});
