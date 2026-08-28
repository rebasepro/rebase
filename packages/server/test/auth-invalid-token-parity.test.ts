import { describe, expect, it, beforeAll } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, DataDriver } from "@rebasepro/types";

import { createAuthMiddleware } from "../src/auth/middleware";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { configureJwt, generateAccessToken, verifyAccessToken } from "../src/auth/jwt";
import type { HonoEnv } from "../src/api/types";

/**
 * One rule, two implementations: "a token was presented and did not verify" is
 * a 401, whatever `requireAuth` says.
 *
 * Only `createAuthMiddleware` said so. `createAdapterAuthMiddleware` treated a
 * `verifyRequest` returning `null` — what the built-in adapter does for an
 * expired or forged JWT — as "not authenticated", handed out an anon-scoped
 * driver and, with `requireAuth: false`, ran the handler.
 *
 * The divergence is observable on exactly one router: `/api/functions` is the
 * only one mounted with `requireAuth: false`. A function that degrades
 * gracefully for anonymous callers would answer 200 with public content to a
 * user whose access token had merely expired — and since the SDK's refresh flow
 * is driven by a 401, the refresh never fires and the user is silently signed
 * out of that one screen.
 *
 * The adapter path is the live one: an `authAdapter` exists whenever
 * `config.auth` is a config object.
 */

const SECRET = "test-secret-key-for-invalid-token-parity-1234567890";

const mockDriver: DataDriver = {
    fetchCollection: (() => {}) as never,
    fetchOne: (() => {}) as never,
    save: (() => {}) as never,
    delete: (() => {}) as never
};

/** Verifies exactly what the built-in adapter verifies: a bearer JWT, or nothing. */
const jwtAdapter: AuthAdapter = {
    id: "test-jwt",
    async verifyRequest(request: Request) {
        const header = request.headers.get("authorization");
        const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
        if (!token) return null;
        const payload = await verifyAccessToken(token);
        return payload ? { uid: payload.uid, email: "", roles: payload.roles ?? [], isAdmin: false } : null;
    }
} as unknown as AuthAdapter;

beforeAll(() => {
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

/** The functions mount: permissive, so the handler runs for anonymous callers. */
function app(which: "builtin" | "adapter"): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.use("/*", which === "builtin"
        ? createAuthMiddleware({ driver: mockDriver, requireAuth: false })
        : createAdapterAuthMiddleware({ adapter: jwtAdapter, driver: mockDriver, requireAuth: false }));
    router.get("/", (c) => c.json({ uid: (c.get("user") as { uid?: string } | undefined)?.uid ?? null }));
    return router;
}

describe.each(["builtin", "adapter"] as const)("%s auth middleware, requireAuth: false", (which) => {
    it("401s a token that does not verify, rather than downgrading it to anonymous", async () => {
        const res = await app(which).request("/", { headers: { Authorization: "Bearer not.a.token" } });

        expect(res.status).toBe(401);
        expect((await res.json() as { error: { message: string } }).error.message).toMatch(/token/i);
    });

    it("lets a request with no credential through as anonymous", async () => {
        // "No credential" is not "a bad credential" — a webhook receiver has
        // no token to send, which is the whole reason this router is
        // permissive. Adapters that authenticate by cookie rely on this too.
        const res = await app(which).request("/");

        expect(res.status).toBe(200);
        expect((await res.json() as { uid: string | null }).uid).toBeNull();
    });

    it("lets a valid token through", async () => {
        const token = await generateAccessToken("user-1", []);
        const res = await app(which).request("/", { headers: { Authorization: `Bearer ${token}` } });

        expect(res.status).toBe(200);
        expect((await res.json() as { uid: string | null }).uid).toBe("user-1");
    });
});
