/**
 * `auth.magicLinkCreatesUsers`: a magic-link or email-code request for an
 * address with no account creates one, while registration is open — so a
 * passwordless-only app can sign people up at all. Off, nothing is created
 * and the answer is the same as for a known address.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, type AuthModuleConfig } from "../src/auth/routes";
import { configureJwt } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

beforeAll(() => configureJwt({ secret: "passwordless-signup-secret-at-least-32", accessExpiresIn: "1h" }));

function world(overrides: Partial<AuthModuleConfig>) {
    const store = new MemoryAuthStore();
    const mails: { to: string; text?: string }[] = [];
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        enableMagicLink: true,
        enableEmailOtp: true,
        defaultRole: "member",
        emailService: { isConfigured: () => true, send: async (m: { to: string; text?: string }) => { mails.push(m); return { messageId: "m" }; } } as unknown as AuthModuleConfig["emailService"],
        emailConfig: { from: "noreply@app.test", appName: "TestApp", resetPasswordUrl: "https://app.test" },
        ...overrides
    }));
    const post = async (path: string, body: unknown) => {
        const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { status: res.status, json: await res.json() as Record<string, any> };
    };
    const mailedLinkToken = async () => {
        await new Promise(resolve => setImmediate(resolve));
        const mail = mails.find(m => /token=/.test(m.text ?? ""));
        return mail ? /token=([A-Za-z0-9_-]+)/.exec(mail.text!)![1] : undefined;
    };
    return { store, mails, post, mailedLinkToken };
}

describe("magicLinkCreatesUsers", () => {
    it("creates the account for an unknown address, and the link signs it in, verified", async () => {
        const w = world({ magicLinkCreatesUsers: true, allowRegistration: true });

        expect((await w.post("/auth/magic-link", { email: "new@corp.com" })).status).toBe(200);

        const user = [...w.store.users.values()].find(u => u.email === "new@corp.com");
        expect(user).toMatchObject({ passwordHash: null, emailVerified: false });
        expect(w.store.roles.get(user!.id)).toEqual(["member"]);
        const signedIn = await w.post("/auth/magic-link/verify", { token: await w.mailedLinkToken() });
        expect(signedIn.status).toBe(200);
        expect(signedIn.json.user).toMatchObject({ email: "new@corp.com", emailVerified: true });
    });

    it("does the same for an email code", async () => {
        const w = world({ magicLinkCreatesUsers: true, allowRegistration: true });
        expect((await w.post("/auth/otp", { email: "coder@corp.com" })).status).toBe(200);
        expect([...w.store.users.values()].map(u => u.email)).toEqual(["coder@corp.com"]);
    });

    it.each([
        ["off", { allowRegistration: true }],
        ["on, but registration closed", { magicLinkCreatesUsers: true, allowRegistration: false }],
        ["on, but self-registration killed", { magicLinkCreatesUsers: true, allowRegistration: true, disableSelfRegistration: true }]
    ])("creates nothing when %s, and answers as for any address", async (_case, overrides) => {
        const w = world(overrides);
        const res = await w.post("/auth/magic-link", { email: "new@corp.com" });
        expect(res.status).toBe(200);
        expect(w.store.users.size).toBe(0);
        expect(w.mails).toEqual([]);
    });

    it("runs beforeUserCreate, which may refuse", async () => {
        const w = world({
            magicLinkCreatesUsers: true,
            allowRegistration: true,
            authHooks: { beforeUserCreate: async (data) => { if (!data.email.endsWith("@corp.com")) throw new Error("corp only"); return data; } }
        });
        expect((await w.post("/auth/magic-link", { email: "outsider@gmail.com" })).json.error.code).toBe("HOOK_REJECTED");
        expect(w.store.users.size).toBe(0);
    });
});
