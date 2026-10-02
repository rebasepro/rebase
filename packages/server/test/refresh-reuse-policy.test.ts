/**
 * A refresh token replayed after its reuse window: what happens to the session
 * is the deployment's call, `auth.refreshTokenReuse`.
 *
 * The default declines the request and leaves the session standing — not
 * reuse *detection*: a thief who refreshed first keeps the session, and the
 * owner is the one refused. `"revoke-session"` ends the sign-in for both, as
 * GoTrue does.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, type AuthModuleConfig } from "../src/auth/routes";
import { configureJwt } from "../src/auth/jwt";
import { resolveAuthOptions } from "../src/boot/options";
import type { RebaseBootEnv } from "../src/boot/env";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

beforeAll(() => configureJwt({ secret: "refresh-reuse-policy-secret-at-least-32", accessExpiresIn: "1h" }));

async function replayAfterWindow(policy: AuthModuleConfig["refreshTokenReuse"]) {
    const store = new MemoryAuthStore();
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        allowRegistration: true,
        authHooks: { hashPassword: async (p: string) => `hashed:${p}`, verifyPassword: async (p: string, s: string) => s === `hashed:${p}` },
        // No window: any replay of a rotated token is "after" it.
        refreshTokenReuseIntervalSeconds: 0,
        refreshTokenReuse: policy
    }));
    const post = async (path: string, body: unknown) => {
        const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { status: res.status, json: await res.json() as { tokens?: { refreshToken: string }; error?: { code: string } } };
    };
    const signedIn = await post("/auth/register", { email: "owner@corp.com", password: "Passw0rd-Owner" });
    const stolen = signedIn.json.tokens!.refreshToken;
    // The thief refreshes first; the owner's copy is now superseded.
    const thief = await post("/auth/refresh", { refreshToken: stolen });
    await new Promise(resolve => setTimeout(resolve, 5));
    const owner = await post("/auth/refresh", { refreshToken: stolen });
    const thiefNext = await post("/auth/refresh", { refreshToken: thief.json.tokens!.refreshToken });
    return { owner, thiefNext };
}

describe("auth.refreshTokenReuse", () => {
    it("rejects the replay and leaves the session standing by default", async () => {
        const { owner, thiefNext } = await replayAfterWindow(undefined);
        expect(owner.json.error?.code).toBe("TOKEN_ALREADY_USED");
        expect(thiefNext.status).toBe(200);
    });

    it("ends the whole sign-in with \"revoke-session\"", async () => {
        const { owner, thiefNext } = await replayAfterWindow("revoke-session");
        expect(owner.json.error?.code).toBe("SESSION_REVOKED");
        expect(thiefNext.status).toBe(401);
    });

    it("refuses an unknown policy at boot, by name", () => {
        expect(() => createAuthRoutes({ authRepo: new MemoryAuthStore().repo(), refreshTokenReuse: "revoke" as never }))
            .toThrow(/refreshTokenReuse is "revoke"/);
    });

    it("is read from AUTH_REFRESH_TOKEN_REUSE", () => {
        const auth = resolveAuthOptions({ NODE_ENV: "development", APP_NAME: "Rebase", AUTH_REFRESH_TOKEN_REUSE: "revoke-session" } as RebaseBootEnv, undefined);
        expect(auth.refreshTokenReuse).toBe("revoke-session");
    });
});
