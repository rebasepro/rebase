/**
 * The access token names its sign-in (`sid`).
 *
 * Without it nothing could tell one device's access token from another's:
 * signing one device out (`POST /auth/logout`, `DELETE /auth/sessions/:id`)
 * ended its refresh token and left the access token it held working for the
 * rest of its hour, and `GET /auth/sessions` could only find the caller's own
 * row through an `x-refresh-token` header no first-party client sent — so every
 * row read "not this device", and revoking your own signed nobody out.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { configureJwt, generateAccessToken, verifyAccessToken } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const PASSWORD = "Passw0rd-Device";
const HOOKS = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`,
    // A hook that echoes its input and adds a claim of its own — and tries to
    // name the session itself.
    customizeAccessToken: async (claims: Record<string, unknown>) => ({ ...claims, sid: "00000000-0000-4000-8000-000000000000", plan: "pro" })
};

beforeAll(() => configureJwt({ secret: "session-id-in-access-token-secret-0123456789", accessExpiresIn: "1h" }));

function world() {
    const store = new MemoryAuthStore();
    const adapter = createBuiltinAuthAdapter({ authRepository: store.repo(), allowRegistration: true, authHooks: HOOKS });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", adapter.createAuthRoutes() as Hono<HonoEnv>);
    app.get("/data", async (c) => {
        const user = await adapter.verifyRequest(c.req.raw);
        return user ? c.json({ uid: user.uid }) : c.json({ error: "unauthenticated" }, 401);
    });
    const call = async (method: string, path: string, body?: unknown, token?: string) => {
        const res = await app.request(path, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : undefined };
    };
    const signIn = async () => {
        const res = await call("POST", "/auth/login", { email: "owner@corp.com", password: PASSWORD });
        expect(res.status).toBe(200);
        return { accessToken: res.json.tokens.accessToken as string, refreshToken: res.json.tokens.refreshToken as string };
    };
    return { store, call, signIn };
}

async function registered() {
    const w = world();
    const res = await w.call("POST", "/auth/register", { email: "owner@corp.com", password: PASSWORD });
    expect(res.status).toBe(201);
    return w;
}

describe("the access token's session id", () => {
    it("names the sign-in its refresh tokens share, across a rotation, whatever a hook says", async () => {
        const { store, signIn, call } = await registered();
        const laptop = await signIn();

        const payload = await verifyAccessToken(laptop.accessToken);
        const row = store.refreshTokens.find(r => r.uid === payload!.uid && r.sessionId === payload!.sid);
        expect(payload!.sid).toBeDefined();
        expect(row).toBeDefined();
        expect(payload!.claims).toEqual({ plan: "pro" });

        const refreshed = await call("POST", "/auth/refresh", { refreshToken: laptop.refreshToken });
        expect(refreshed.status).toBe(200);
        expect((await verifyAccessToken(refreshed.json.tokens.accessToken))!.sid).toBe(payload!.sid);
    });

    it("marks exactly the caller's own session in the sessions list", async () => {
        const { signIn, call } = await registered();
        const laptop = await signIn();
        const phone = await signIn();

        const fromLaptop = await call("GET", "/auth/sessions", undefined, laptop.accessToken);
        const fromPhone = await call("GET", "/auth/sessions", undefined, phone.accessToken);
        const current = (list: { sessions: { id: string; isCurrentSession: boolean }[] }) =>
            list.sessions.filter(s => s.isCurrentSession).map(s => s.id);

        expect(current(fromLaptop.json)).toHaveLength(1);
        expect(current(fromPhone.json)).toHaveLength(1);
        expect(current(fromLaptop.json)).not.toEqual(current(fromPhone.json));
    });

    it("signs one device out, access token included, and leaves the other signed in", async () => {
        const { signIn, call } = await registered();
        const laptop = await signIn();
        const phone = await signIn();

        expect((await call("POST", "/auth/logout", { refreshToken: phone.refreshToken })).status).toBe(200);

        expect((await call("GET", "/data", undefined, phone.accessToken)).status).toBe(401);
        expect((await call("GET", "/auth/me", undefined, phone.accessToken)).status).toBe(401);
        expect((await call("GET", "/data", undefined, laptop.accessToken)).status).toBe(200);
    });

    it("revokes another device from the sessions list, access token included", async () => {
        const { signIn, call } = await registered();
        const laptop = await signIn();
        const phone = await signIn();

        // The row the phone itself calls current, revoked from the laptop.
        const list = await call("GET", "/auth/sessions", undefined, phone.accessToken);
        const phoneRow = (list.json.sessions as { id: string; isCurrentSession: boolean }[]).find(s => s.isCurrentSession)!;
        expect((await call("DELETE", `/auth/sessions/${phoneRow.id}`, undefined, laptop.accessToken)).status).toBe(200);

        expect((await call("GET", "/data", undefined, phone.accessToken)).status).toBe(401);
        expect((await call("GET", "/data", undefined, laptop.accessToken)).status).toBe(200);
    });

    it("keeps a token minted before `sid` existed working until it expires", async () => {
        const { store, call } = await registered();
        const uid = [...store.users.values()][0].id;
        const legacy = await generateAccessToken(uid, []);

        expect((await verifyAccessToken(legacy))!.sid).toBeUndefined();
        expect((await call("GET", "/data", undefined, legacy)).status).toBe(200);
    });
});
