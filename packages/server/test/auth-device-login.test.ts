/**
 * Device sign-in: a terminal signs in through a browser (RFC 8628).
 *
 * The protocol is driven against an in-memory store that keeps the store's
 * contract — one decision, one hand-out, the database's clock — so the tests
 * can move time. The store's SQL runs against a real Postgres in
 * `server-postgres/test/device-login-store.test.ts`.
 *
 * What matters most here is not that a happy path signs in. It is that:
 *
 *  - approval takes a live session, and the device gets that account;
 *  - the session is handed out once, and a pending sign-in expires;
 *  - an account with 2FA on can only approve from a session that used it, and
 *    the device's session carries that level;
 *  - a device polling faster than its interval is slowed down.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import { createHash } from "crypto";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt, generateAccessToken, verifyAccessToken } from "../src/auth/jwt";
import { createAuthLimiters } from "../src/auth/rate-limiter";
import { buildBuiltinAuthCapabilities } from "../src/auth/capabilities";
import type { DeviceLoginPoll, DeviceLoginRecord, DeviceLoginStatus, DeviceLoginStore, NewDeviceLogin } from "../src/auth/device-login-store";
import { cleanClientName, normalizeUserCode, DEVICE_LOGIN_TTL_SECONDS } from "../src/auth/device-login-routes";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SECRET = "auth-device-login-secret-at-least-32-characters";
const PASSWORD = "Str0ng-Passw0rd!";
const VERIFICATION_URL = "https://app.example.com/device";

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

interface Row extends NewDeviceLogin {
    status: DeviceLoginStatus;
    uid: string | null;
    aal: "aal1" | "aal2" | null;
    createdAt: Date;
    lastPolledAt: Date | null;
}

/** The store's contract in memory, on a clock the test moves. */
function memoryStore() {
    let now = Date.now();
    const rows = new Map<string, Row>();
    const hash = (code: string) => createHash("sha256").update(code).digest("hex");
    const byUserCode = (userCode: string) => [...rows.values()].find(row => row.userCode === userCode);
    const expired = (row: Row) => row.expiresAt.getTime() <= now;

    const store: DeviceLoginStore = {
        ensureTables: async () => undefined,
        async create(deviceCode, login) {
            if (byUserCode(login.userCode)) return false;
            rows.set(hash(deviceCode), { ...login, status: "pending", uid: null, aal: null, createdAt: new Date(now), lastPolledAt: null });
            return true;
        },
        async findByUserCode(userCode): Promise<DeviceLoginRecord | null> {
            const row = byUserCode(userCode);
            if (!row) return null;
            return {
                userCode: row.userCode,
                clientName: row.clientName,
                requestIp: row.requestIp,
                requestUserAgent: row.requestUserAgent,
                status: row.status,
                createdAt: row.createdAt,
                expiresAt: row.expiresAt,
                expired: expired(row)
            };
        },
        async decide(userCode, decision) {
            const row = byUserCode(userCode);
            if (!row || row.status !== "pending" || expired(row)) return false;
            row.status = decision.approve ? "approved" : "denied";
            row.uid = decision.uid;
            row.aal = decision.approve ? decision.aal : null;
            return true;
        },
        async poll(deviceCode): Promise<DeviceLoginPoll | null> {
            const row = rows.get(hash(deviceCode));
            if (!row) return null;
            const previous = row.lastPolledAt;
            row.lastPolledAt = new Date(now);
            return {
                status: row.status,
                expired: expired(row),
                intervalSeconds: row.intervalSeconds,
                secondsSincePreviousPoll: previous ? (now - previous.getTime()) / 1000 : null
            };
        },
        async slowDown(deviceCode, step) {
            const row = rows.get(hash(deviceCode));
            if (row) row.intervalSeconds += step;
        },
        async consume(deviceCode) {
            const row = rows.get(hash(deviceCode));
            if (!row || row.status !== "approved" || expired(row) || !row.uid) return null;
            row.status = "consumed";
            return { uid: row.uid, aal: row.aal ?? "aal1" };
        }
    };
    return { store, advance: (seconds: number) => { now += seconds * 1000; } };
}

async function setup(options: { cookieAuth?: boolean } = {}) {
    const auth = new MemoryAuthStore();
    const user = await auth.repo().createUser({ email: "dev@example.com", passwordHash: `hashed:${PASSWORD}`, emailVerified: true });
    const { store, advance } = memoryStore();
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: auth.repo(),
        authHooks: HOOKS,
        // Each test its own budget: the process default's would carry counts
        // from one test into the next.
        limiters: createAuthLimiters(),
        deviceLogin: { store, verificationUrl: VERIFICATION_URL },
        ...(options.cookieAuth ? { cookieAuth: {} } : {})
    }));

    const request = (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) =>
        Promise.resolve(app.request(`/auth${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...headers
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }));

    const signIn = async (): Promise<string> => {
        const res = await request("POST", "/login", { email: "dev@example.com", password: PASSWORD }, undefined, { "x-rebase-auth-flow": "json" });
        expect(res.status).toBe(200);
        return (await res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    };

    const start = async (clientName = "Rebase CLI on laptop") => {
        const res = await request("POST", "/device", { clientName }, undefined, { "user-agent": "rebase-cli/0.30.0" });
        expect(res.status).toBe(200);
        return await res.json() as {
            deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete: string; expiresIn: number; interval: number;
        };
    };

    const poll = async (deviceCode: string) => {
        const res = await request("POST", "/device/token", { deviceCode }, undefined, { "user-agent": "rebase-cli/0.30.0" });
        const body = await res.json() as {
            error?: { code: string; details?: { interval?: number } };
            user?: { uid: string; email: string; providerId: string };
            tokens?: { accessToken: string; refreshToken: string };
        };
        return { res, body };
    };

    return { auth, user, advance, request, signIn, start, poll };
}

describe("device sign-in", () => {
    it("starts with a short code and the approval page, with the code filled in", async () => {
        const { start } = await setup();
        const started = await start();

        expect(started.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
        expect(started.deviceCode.length).toBeGreaterThanOrEqual(40);
        expect(started.verificationUri).toBe(VERIFICATION_URL);
        expect(new URL(started.verificationUriComplete).searchParams.get("code")).toBe(started.userCode);
        expect(started.expiresIn).toBe(DEVICE_LOGIN_TTL_SECONDS);
        expect(started.interval).toBe(5);
    });

    it("hands the device a session for the account that approved it, once", async () => {
        const { start, poll, signIn, request, advance, user } = await setup();
        const { deviceCode, userCode } = await start();

        const pending = await poll(deviceCode);
        expect(pending.res.status).toBe(400);
        expect(pending.body.error?.code).toBe("authorization_pending");
        expect(pending.body.error?.details?.interval).toBe(5);

        const browser = await signIn();
        expect((await request("POST", "/device/approve", { userCode }, browser)).status).toBe(200);

        advance(5);
        const approved = await poll(deviceCode);
        expect(approved.res.status).toBe(200);
        expect(approved.body.user?.uid).toBe(user.id);
        expect(approved.body.user?.providerId).toBe("device");
        expect(approved.body.tokens?.refreshToken).toBeTruthy();
        expect((await verifyAccessToken(approved.body.tokens!.accessToken))?.uid).toBe(user.id);

        // The refresh token is a real session's.
        const refreshed = await request("POST", "/refresh", { refreshToken: approved.body.tokens!.refreshToken }, undefined, { "x-rebase-auth-flow": "json" });
        expect(refreshed.status).toBe(200);

        advance(5);
        const again = await poll(deviceCode);
        expect(again.res.status).toBe(400);
        expect(again.body.error?.code).toBe("invalid_grant");
    });

    it("tells the device it was denied, and gives it nothing", async () => {
        const { start, poll, signIn, request } = await setup();
        const { deviceCode, userCode } = await start();
        expect((await request("POST", "/device/deny", { userCode: userCode.toLowerCase().replace("-", " ") }, await signIn())).status).toBe(200);

        const denied = await poll(deviceCode);
        expect(denied.body.error?.code).toBe("access_denied");
    });

    it("decides a sign-in once", async () => {
        const { start, signIn, request } = await setup();
        const { userCode } = await start();
        const browser = await signIn();
        expect((await request("POST", "/device/approve", { userCode }, browser)).status).toBe(200);

        const second = await request("POST", "/device/deny", { userCode }, browser);
        expect(second.status).toBe(409);
        expect((await second.json() as { error: { code: string } }).error.code).toBe("DEVICE_LOGIN_DECIDED");
    });

    it("expires a sign-in nobody approved", async () => {
        const { start, poll, signIn, request, advance } = await setup();
        const { deviceCode, userCode } = await start();
        advance(DEVICE_LOGIN_TTL_SECONDS + 1);

        const approve = await request("POST", "/device/approve", { userCode }, await signIn());
        expect(approve.status).toBe(410);
        expect((await approve.json() as { error: { code: string } }).error.code).toBe("DEVICE_LOGIN_EXPIRED");

        expect((await poll(deviceCode)).body.error?.code).toBe("expired_token");
    });

    it("slows down a device that polls faster than its interval", async () => {
        const { start, poll, advance } = await setup();
        const { deviceCode } = await start();

        await poll(deviceCode);
        advance(1);
        const early = await poll(deviceCode);
        expect(early.body.error?.code).toBe("slow_down");
        expect(early.body.error?.details?.interval).toBe(10);

        // Five seconds is now too soon; ten is not.
        advance(5);
        expect((await poll(deviceCode)).body.error?.code).toBe("slow_down");
        advance(15);
        const paced = await poll(deviceCode);
        expect(paced.body.error?.code).toBe("authorization_pending");
        expect(paced.body.error?.details?.interval).toBe(15);
    });

    it("answers an unknown device code as an invalid grant", async () => {
        const { poll } = await setup();
        expect((await poll("not-a-device-code")).body.error?.code).toBe("invalid_grant");
    });

    it("takes a signed-in account to describe, approve or deny", async () => {
        const { start, request } = await setup();
        const { userCode } = await start();
        expect((await request("GET", `/device/${userCode}`)).status).toBe(401);
        expect((await request("POST", "/device/approve", { userCode })).status).toBe(401);
        expect((await request("POST", "/device/deny", { userCode })).status).toBe(401);
    });

    it("refuses a guest session", async () => {
        const { auth, start, request } = await setup();
        const guest = await auth.repo().createUser({ email: "guest@anonymous.local", isAnonymous: true });
        const token = await generateAccessToken(guest.id, [], "aal1", undefined, true);
        const { userCode } = await start();
        const res = await request("POST", "/device/approve", { userCode }, token);
        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("ANONYMOUS_NOT_ALLOWED");
    });

    it("describes the sign-in to the approval page: code, device and where it asked from", async () => {
        const { start, signIn, request } = await setup();
        const { userCode } = await start("Rebase CLI on laptop\n\u001b[2Kfake line");
        const browser = await signIn();

        const res = await request("GET", `/device/${userCode.replace("-", "").toLowerCase()}`, undefined, browser);
        expect(res.status).toBe(200);
        const body = await res.json() as { userCode: string; clientName: string; requestUserAgent: string; status: string };
        expect(body.userCode).toBe(userCode);
        expect(body.clientName).toBe("Rebase CLI on laptop [2Kfake line");
        expect(body.requestUserAgent).toBe("rebase-cli/0.30.0");
        expect(body.status).toBe("pending");

        expect((await request("GET", "/device/BBBB-BBBB", undefined, browser)).status).toBe(404);
        expect((await request("GET", "/device/AAAA-1111", undefined, browser)).status).toBe(400);
    });

    it("lets an account with 2FA approve only from a session that used it, and passes that level on", async () => {
        const { auth, user, start, poll, request, advance } = await setup();
        const factor = await auth.repo().createMfaFactor(user.id, "totp", "secret", "Phone");
        await auth.repo().verifyMfaFactor(factor.id);
        const { deviceCode, userCode } = await start();

        const aal1 = await generateAccessToken(user.id, [], "aal1");
        const refused = await request("POST", "/device/approve", { userCode }, aal1);
        expect(refused.status).toBe(403);
        expect((await refused.json() as { error: { code: string } }).error.code).toBe("AAL2_REQUIRED");

        const aal2 = await generateAccessToken(user.id, [], "aal2");
        expect((await request("POST", "/device/approve", { userCode }, aal2)).status).toBe(200);

        advance(5);
        const approved = await poll(deviceCode);
        expect(approved.res.status).toBe(200);
        expect((await verifyAccessToken(approved.body.tokens!.accessToken))?.aal).toBe("aal2");
    });

    it("answers the session in the body even where refresh tokens go in a cookie", async () => {
        const { start, poll, signIn, request, advance } = await setup({ cookieAuth: true });
        const { deviceCode, userCode } = await start();
        expect((await request("POST", "/device/approve", { userCode }, await signIn())).status).toBe(200);

        advance(5);
        const approved = await poll(deviceCode);
        expect(approved.res.status).toBe(200);
        expect(approved.body.tokens?.refreshToken).toBeTruthy();
        expect(approved.res.headers.get("set-cookie")).toBeNull();
    });

    it("is advertised in the capability document only when it is on", () => {
        const base = { needsSetup: false, emailConfigured: false, enabledProviders: [] };
        expect(buildBuiltinAuthCapabilities({ ...base, enableDeviceLogin: true }).deviceLogin).toBe(true);
        expect(buildBuiltinAuthCapabilities(base).deviceLogin).toBe(false);
    });
});

describe("user codes and device names", () => {
    it("reads a code however it is typed, and refuses what cannot be one", () => {
        expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDFGHJK");
        expect(normalizeUserCode(" BCDF GHJK ")).toBe("BCDFGHJK");
        expect(normalizeUserCode("BCDF-GHJ")).toBeNull();
        expect(normalizeUserCode("ABCD-EFGH")).toBeNull();
        expect(normalizeUserCode("BCDF-GHJ1")).toBeNull();
    });

    it("keeps a device name to one printable line of at most 100 characters", () => {
        expect(cleanClientName("a\r\nb\u0007c")).toBe("a b c");
        expect(cleanClientName("x".repeat(300))).toHaveLength(100);
        expect(cleanClientName("   ")).toBe("Unknown device");
        expect(cleanClientName(undefined)).toBe("Unknown device");
    });
});
