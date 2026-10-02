/**
 * The recovery codes a user printed are the way back in when the phone is
 * lost, and nothing but the user replaces them.
 *
 * `/mfa/enroll` generated codes on every call, before the new factor was
 * verified, and the repository's `createRecoveryCodes` starts with a DELETE.
 * So opening "add a backup authenticator" and closing the dialog destroyed the
 * printed codes; their replacements had been shown only in the abandoned
 * response. With no admin MFA reset either, the account was unrecoverable
 * without SQL.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { base32Decode, generateTotp } from "../src/auth/mfa";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const EMAIL = "owner@corp.com";
const PASSWORD = "Passw0rd-Owner";

beforeAll(() => {
    process.env.MFA_ENCRYPTION_KEY = "mfa-recovery-codes-test-key-0123456789abcdef";
    configureJwt({ secret: "mfa-recovery-codes-secret-at-least-32-chars", accessExpiresIn: "1h" });
});

function world() {
    const store = new MemoryAuthStore();
    const adapter = createBuiltinAuthAdapter({
        authRepository: store.repo(),
        allowRegistration: true,
        authHooks: {
            hashPassword: async (password: string) => `hashed:${password}`,
            verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
        }
    });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", adapter.createAuthRoutes() as Hono<HonoEnv>);
    app.route("/admin", adapter.createAdminRoutes!() as Hono<HonoEnv>);

    const call = async (method: string, path: string, body?: unknown, token?: string) => {
        const res = await app.request(path, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : {} };
    };

    /** Password sign-in, then the second factor: a recovery code or the current TOTP. */
    async function signInWith(code: string) {
        const first = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
        if (first.status === 200) return first;
        expect(first.json.error.code).toBe("MFA_REQUIRED");
        const { mfaToken, factors } = first.json.error.details as { mfaToken: string; factors: { id: string }[] };
        const challenge = await call("POST", "/auth/mfa/challenge", { factorId: factors[0].id }, mfaToken);
        return call("POST", "/auth/mfa/challenge/verify", { challengeId: challenge.json.challengeId, code }, mfaToken);
    }

    return { store, call, signInWith };
}

/**
 * The phone's code for the next time step: the current one was spent by
 * `/mfa/verify`, and a spent step is refused (RFC 6238 §5.2). The verifier
 * accepts one step of drift either way.
 */
function nextCode(secret: string): string {
    const realNow = Date.now;
    const now = realNow();
    Date.now = () => now + 30_000;
    try {
        return generateTotp(base32Decode(secret));
    } finally {
        Date.now = realNow;
    }
}

/** Enrol and verify a phone; returns the codes printed and the TOTP secret. */
async function enrolPhone(w: ReturnType<typeof world>) {
    const registered = await w.call("POST", "/auth/register", { email: EMAIL, password: PASSWORD });
    const token = registered.json.tokens.accessToken as string;
    const enrol = await w.call("POST", "/auth/mfa/enroll", { friendlyName: "Phone" }, token);
    expect(enrol.status).toBe(201);
    const secret = enrol.json.totp.secret as string;
    const verify = await w.call("POST", "/auth/mfa/verify", { factorId: enrol.json.factor.id, code: generateTotp(base32Decode(secret)) }, token);
    expect(verify.status).toBe(200);
    return { printed: enrol.json.recoveryCodes as string[], secret, uid: registered.json.user.uid as string };
}

describe("printed recovery codes", () => {
    it("survive starting — and abandoning — a second enrolment", async () => {
        const w = world();
        const { printed, secret } = await enrolPhone(w);
        expect(printed).toHaveLength(10);

        // Step up with the phone, open "add a backup authenticator", close it.
        const stepped = await w.signInWith(nextCode(secret));
        expect(stepped.status).toBe(200);
        const second = await w.call("POST", "/auth/mfa/enroll", { friendlyName: "Tablet" }, stepped.json.tokens.accessToken);
        expect(second.status).toBe(201);
        expect(second.json.recoveryCodes).toBeNull();

        // The phone is lost. The first printed code still gets in.
        const recovered = await w.signInWith(printed[0]);
        expect(recovered.status).toBe(200);
    });

    it("are replaced only on request, at aal2", async () => {
        const w = world();
        const { printed, secret } = await enrolPhone(w);

        const passwordOnly = await generateAccessToken([...w.store.users.values()][0].id, [], "aal1");
        expect((await w.call("POST", "/auth/mfa/recovery-codes", undefined, passwordOnly)).json.error.code).toBe("AAL2_REQUIRED");

        const stepped = await w.signInWith(nextCode(secret));
        const replaced = await w.call("POST", "/auth/mfa/recovery-codes", undefined, stepped.json.tokens.accessToken);
        expect(replaced.status).toBe(200);
        expect(replaced.json.recoveryCodes).toHaveLength(10);

        expect((await w.signInWith(printed[1])).status).toBe(401);
        expect((await w.signInWith(replaced.json.recoveryCodes[0])).status).toBe(200);
    });
});

describe("DELETE /admin/users/:uid/mfa", () => {
    it("removes the factors and codes, ends the sessions, and lets the password sign in again", async () => {
        const w = world();
        const { uid } = await enrolPhone(w);
        const admin = await w.store.repo().createUser({ email: "admin@corp.com", emailVerified: true });
        await w.store.repo().setUserRoles(admin.id, ["admin"]);
        const adminToken = await generateAccessToken(admin.id, ["admin"]);
        const before = w.store.refreshTokens.filter(r => r.uid === uid).length;
        expect(before).toBeGreaterThan(0);

        const reset = await w.call("DELETE", `/admin/users/${uid}/mfa`, undefined, adminToken);

        expect(reset.status).toBe(200);
        expect(reset.json.removedFactors).toBe(1);
        expect(w.store.factors.filter(f => f.uid === uid)).toEqual([]);
        expect(w.store.recoveryCodes.filter(c => c.uid === uid)).toEqual([]);
        expect(w.store.refreshTokens.filter(r => r.uid === uid)).toEqual([]);
        expect((await w.call("POST", "/auth/login", { email: EMAIL, password: PASSWORD })).status).toBe(200);
    });

    it("needs users:write", async () => {
        const w = world();
        const { uid } = await enrolPhone(w);
        const editor = await w.store.repo().createUser({ email: "editor@corp.com", emailVerified: true });
        await w.store.repo().setUserRoles(editor.id, ["editor"]);

        const refused = await w.call("DELETE", `/admin/users/${uid}/mfa`, undefined, await generateAccessToken(editor.id, ["editor"]));

        expect(refused.status).toBe(403);
        expect(w.store.factors.filter(f => f.uid === uid)).toHaveLength(1);
    });
});

/**
 * MFA's key falls back to the JWT secret the server was given, not only to the
 * one in `JWT_SECRET`: an app passing `auth.jwtSecret` in code had no key, and
 * every `/mfa/enroll` answered 500.
 */
describe("the TOTP encryption key", () => {
    it("is the configured auth.jwtSecret when no MFA key or JWT_SECRET is in the environment", async () => {
        const saved = { mfa: process.env.MFA_ENCRYPTION_KEY, jwt: process.env.JWT_SECRET };
        delete process.env.MFA_ENCRYPTION_KEY;
        delete process.env.JWT_SECRET;
        try {
            const { encryptTotpSecret, decryptTotpSecret } = await import("../src/auth/mfa-crypto");
            const sealed = encryptTotpSecret("JBSWY3DPEHPK3PXP");
            expect(decryptTotpSecret(sealed)).toBe("JBSWY3DPEHPK3PXP");
        } finally {
            if (saved.mfa !== undefined) process.env.MFA_ENCRYPTION_KEY = saved.mfa;
            if (saved.jwt !== undefined) process.env.JWT_SECRET = saved.jwt;
        }
    });
});
