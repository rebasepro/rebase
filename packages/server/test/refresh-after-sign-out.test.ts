/**
 * A refresh that was in flight when the user signed out does not bring the
 * session back.
 *
 * `POST /auth/refresh` reads the presented token, checks it, and then does
 * several round trips of work before it writes the rotated token into the same
 * session. A sign-out landing in that window revoked every row of the session,
 * and the refresh then wrote a new, unrevoked row into it and answered 200 —
 * in cookie mode re-setting the cookie, so the sign-out silently did not
 * happen. Password reset closes the same window with the revocation mark;
 * logout and device revoke had nothing.
 *
 * The route now hands the repository the presented token as
 * `session.rotatedFrom`, and a repository that honours it writes only while
 * that token is live (Postgres: `refresh-rotation-after-revoke.test.ts` in
 * server-postgres). This holds the route to its half: it asks, and when the
 * answer is `false` it mints nothing and says the session was revoked.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { AuthRepository, RefreshTokenSession } from "../src/auth/interfaces";
import { configureJwt } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    configureJwt({ secret: "refresh-after-sign-out-secret-at-least-32-chars", accessExpiresIn: "1h" });
});

/**
 * The memory store, writing a rotation only while its parent is live — what a
 * repository that honours `rotatedFrom` does — and recording what it was asked.
 */
function honouringStore() {
    const store = new MemoryAuthStore();
    const repo = store.repo();
    const asked: Array<RefreshTokenSession | undefined> = [];
    const write = repo.createRefreshToken.bind(repo);
    const honouring: AuthRepository = {
        ...repo,
        createRefreshToken: async (uid, tokenHash, expiresAt, userAgent, ipAddress, session) => {
            asked.push(session);
            if (session?.rotatedFrom) {
                const parent = store.refreshTokens.find(r => r.tokenHash === session.rotatedFrom);
                if (!parent || parent.revoked) return false;
            }
            await write(uid, tokenHash, expiresAt, userAgent, ipAddress, session);
            return true;
        }
    };
    return { store, repo: honouring, asked };
}

function appFor(repo: AuthRepository) {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({ authRepo: repo, authHooks: HOOKS, allowRegistration: true }));
    const post = (path: string, body: unknown) => Promise.resolve(app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));
    return post;
}

describe("POST /auth/refresh racing a sign-out", () => {
    it("mints nothing into a session signed out while it was in flight, and says so", async () => {
        const { store, repo } = honouringStore();
        const post = appFor(repo);
        const reg = await (await post("/auth/register", { email: "racer@example.test", password: "Str0ng-Passw0rd!" })).json();

        // Hold the refresh after its checks, where the real one spends its
        // round trips, and sign out meanwhile.
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const roles = repo.getUserRoles;
        repo.getUserRoles = async (uid) => {
            await gate;
            return roles(uid);
        };
        const inFlight = post("/auth/refresh", { refreshToken: reg.tokens.refreshToken });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect((await post("/auth/logout", { refreshToken: reg.tokens.refreshToken })).status).toBe(200);
        release();

        const refreshed = await inFlight;
        expect(refreshed.status).toBe(401);
        expect((await refreshed.json()).error.code).toBe("SESSION_REVOKED");
        expect(store.refreshTokens.filter(row => !row.revoked)).toEqual([]);
    });

    it("rotates as before when nothing intervened, naming the token it replaces", async () => {
        const { repo, asked } = honouringStore();
        const post = appFor(repo);
        const reg = await (await post("/auth/register", { email: "calm@example.test", password: "Str0ng-Passw0rd!" })).json();
        asked.length = 0;

        const refreshed = await post("/auth/refresh", { refreshToken: reg.tokens.refreshToken });

        expect(refreshed.status).toBe(200);
        expect(asked).toHaveLength(1);
        expect(asked[0]?.rotatedFrom).toEqual(expect.any(String));
        // And the token it minted is the one that works next.
        const next = await post("/auth/refresh", { refreshToken: (await refreshed.json()).tokens.refreshToken });
        expect(next.status).toBe(200);
    });

    it("still rotates on a repository that ignores rotatedFrom", async () => {
        const store = new MemoryAuthStore();
        const post = appFor(store.repo());
        const reg = await (await post("/auth/register", { email: "older@example.test", password: "Str0ng-Passw0rd!" })).json();

        expect((await post("/auth/refresh", { refreshToken: reg.tokens.refreshToken })).status).toBe(200);
    });
});
