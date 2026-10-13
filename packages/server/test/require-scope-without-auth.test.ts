import { beforeAll, describe, expect, it } from "@jest/globals";
import { Hono } from "hono";

import type { HonoEnv } from "../src/api/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { requireAuth } from "../src/auth/middleware";
import { requireScope } from "../src/auth/access";

/**
 * `requireScope` on a route of your own.
 *
 * It is a guard: it judges the caller an auth middleware already identified,
 * and verifies no token itself — as `requireAdmin` and the function guards
 * do. Mounted alone it refused every request with 401 "Authentication
 * required", the valid session included, and the one thing the caller can do
 * about a 401 is check a token that was fine. The refusal now says the route
 * never looked at the credential, and what to mount in front.
 */
describe("requireScope with nothing in front of it", () => {
    let token: string;

    beforeAll(async () => {
        configureJwt({ secret: "require-scope-without-auth-secret-0123456789" });
        token = await generateAccessToken("7f27459f-2b8c-4c4e-9a51-0d8f3b1e6a10", ["admin"]);
    });

    const app = (guards: "scope-only" | "auth-then-scope"): Hono<HonoEnv> => {
        const hono = new Hono<HonoEnv>();
        if (guards === "scope-only") {
            hono.post("/deploy", requireScope("data:read"), (c) => c.json({ ok: true }));
        } else {
            hono.post("/deploy", requireAuth, requireScope("data:read"), (c) => c.json({ ok: true }));
        }
        return hono;
    };

    it("says a credential was sent and nothing verified it, naming requireAuth", async () => {
        const res = await app("scope-only").request("/deploy", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(401);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toContain("requireAuth");
    });

    it("still answers a plain 401 to a request that sent no credential", async () => {
        const res = await app("scope-only").request("/deploy", { method: "POST" });

        expect(res.status).toBe(401);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toBe("Authentication required");
    });

    it("passes the same session once requireAuth identifies it", async () => {
        const res = await app("auth-then-scope").request("/deploy", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` }
        });

        expect(res.status).toBe(200);
    });
});
