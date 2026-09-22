import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { DataDriver } from "@rebasepro/types";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import type { HonoEnv } from "../src/api/types";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

/**
 * The per-request role lookup fails closed on the data plane, as it does at
 * the admin gate.
 *
 * Roles are re-read from the database on every request precisely because the
 * token's own `roles` claim can be up to an access-token lifetime stale: an
 * administrator demoted a minute ago still holds a token that says `admin`.
 * When that read threw, the built-in adapter logged a warning and used the
 * token's roles anyway — so during a database blip a demoted admin's token was
 * scoped with admin RLS on REST and on the socket. `createRequireAuth`, which
 * guards the admin routes, already refused (503 `ROLE_LOOKUP_FAILED`); this is
 * the same answer on the other door.
 */

const failingRepo = {
    getUserRoleIds: async () => {
        throw new Error("connection terminated unexpectedly");
    }
} as unknown as AuthRepository;

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

describe("a role lookup that fails", () => {
    beforeAll(() => {
        configureJwt({ secret: "builtin-adapter-role-lookup-secret-0123456789", accessExpiresIn: "1h" });
    });

    it("refuses the request with 503 instead of trusting the token's roles", async () => {
        const token = await generateAccessToken("demoted-1", ["admin"]);
        const { driver, scopedAs } = recordingDriver();
        const app = new Hono<HonoEnv>();
        app.use("/*", createAdapterAuthMiddleware({ adapter: createBuiltinAuthAdapter({ authRepository: failingRepo }), driver }));
        app.get("/data", (c) => c.json({ ok: true }));

        const res = await app.request("/data", { headers: { Authorization: `Bearer ${token}` } });

        expect(res.status).toBe(503);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("ROLE_LOOKUP_FAILED");
        expect(scopedAs).toEqual([]);
    });

    it("gives the socket no identity either", async () => {
        const token = await generateAccessToken("demoted-1", ["admin"]);
        const adapter = createBuiltinAuthAdapter({ authRepository: failingRepo });

        // The socket treats a throwing adapter as an invalid token.
        await expect(adapter.verifyToken!(token)).rejects.toMatchObject({ statusCode: 503, code: "ROLE_LOOKUP_FAILED" });
    });
});
