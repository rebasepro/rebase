import { describe, it, expect, beforeAll } from "@jest/globals";
import { Hono } from "hono";
import type { AuthRepository } from "../src/auth/interfaces";
import type { DataDriver } from "@rebasepro/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAuthMiddleware } from "../src/auth/middleware";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import type { HonoEnv } from "../src/api/types";

/**
 * A token's custom claims reach the data plane on the built-in adapter path.
 *
 * `customizeAccessToken` puts a claim on the token, and a collection declares
 * `tenant: { from: { claim: "org_id" } }` — which compiles to
 * `rebase.jwt() ->> 'org_id'` and is what the write path stamps from. The
 * JWT-only middleware forwarded `payload.claims` to `withAuth`. But that
 * middleware only runs on a backend with no auth at all: every backend with a
 * `config.auth` object goes through the built-in adapter, whose
 * `verifyRequest` and `verifyToken` rebuilt the user without `claims`, and
 * through the adapter middleware, which scoped the driver as
 * `{ uid, roles, isAnonymous }`. Creates failed with `TENANT_REQUIRED` and every
 * read came back empty, over HTTP and over the socket alike.
 */

function recordingDriver() {
    const scopedAs: Record<string, unknown>[] = [];
    const driver = {
        key: "recording",
        initialised: true,
        withAuth: async (user: Record<string, unknown>) => {
            scopedAs.push(user);
            return driver;
        }
    } as unknown as DataDriver;
    return { driver, scopedAs };
}

const repo = {
    getUserRoleIds: async () => ["editor"]
} as unknown as AuthRepository;

function appWith(middleware: ReturnType<typeof createAuthMiddleware>) {
    const app = new Hono<HonoEnv>();
    app.use("/*", middleware);
    app.get("/data", (c) => c.json({ ok: true }));
    return app;
}

describe("custom claims on the built-in adapter path", () => {
    beforeAll(() => {
        configureJwt({ secret: "builtin-adapter-claims-secret-0123456789abcdef", accessExpiresIn: "1h" });
    });

    it("scopes the driver with the token's custom claims, as the JWT-only middleware does", async () => {
        const token = await generateAccessToken("member-1", ["editor"], "aal1", { org_id: "acme" });
        const adapter = createBuiltinAuthAdapter({ authRepository: repo });

        const viaAdapter = recordingDriver();
        const res = await appWith(createAdapterAuthMiddleware({ adapter, driver: viaAdapter.driver }))
            .request("/data", { headers: { Authorization: `Bearer ${token}` } });
        expect(res.status).toBe(200);

        const viaJwt = recordingDriver();
        await appWith(createAuthMiddleware({ driver: viaJwt.driver }))
            .request("/data", { headers: { Authorization: `Bearer ${token}` } });

        expect(viaAdapter.scopedAs).toEqual([expect.objectContaining({ uid: "member-1", claims: { org_id: "acme" } })]);
        expect(viaJwt.scopedAs).toEqual([expect.objectContaining({ claims: { org_id: "acme" } })]);
    });

    it("returns them from verifyToken, which is what the socket authenticates with", async () => {
        const token = await generateAccessToken("member-1", ["editor"], "aal1", { org_id: "acme" });
        const adapter = createBuiltinAuthAdapter({ authRepository: repo });

        expect(await adapter.verifyToken!(token)).toEqual(expect.objectContaining({ claims: { org_id: "acme" } }));
        expect(await adapter.verifyRequest(new Request("https://example.test/api/data/x", {
            headers: { Authorization: `Bearer ${token}` }
        }))).toEqual(expect.objectContaining({ claims: { org_id: "acme" } }));
    });

    it("adds no claims key for a token that carries none", async () => {
        const token = await generateAccessToken("member-1", ["editor"]);
        const adapter = createBuiltinAuthAdapter({ authRepository: repo });

        const user = await adapter.verifyToken!(token);
        expect(user).not.toBeNull();
        expect(user).not.toHaveProperty("claims");
    });
});
