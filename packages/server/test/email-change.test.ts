/**
 * A signed-in user changes their own address.
 *
 * There was no way to: `PATCH /auth/me` takes a name and a photo, so an X
 * (Twitter) account kept its `…@twitter.placeholder.rebase` address for good,
 * and anyone whose address changed needed an administrator. Now
 * `POST /auth/change-email` mails a link to the new address and a notice to the
 * old one, and following the link moves the account: the address becomes the
 * account's, verified, the identities that vouched for the old address are
 * detached, and the sessions stay.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, type AuthModuleConfig } from "../src/auth/routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { hashToken } from "../src/auth/admin-user-ops";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

beforeAll(() => configureJwt({ secret: "email-change-secret-at-least-32-chars!!", accessExpiresIn: "1h" }));

const PASSWORD = "Passw0rd-Member";

interface Mail { to: string; subject: string; text?: string }

function world(overrides: Partial<AuthModuleConfig> = {}) {
    const store = new MemoryAuthStore();
    const mails: Mail[] = [];
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        allowRegistration: true,
        authHooks: {
            hashPassword: async (password: string) => `hashed:${password}`,
            verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
        },
        emailService: { isConfigured: () => true, send: async (m: Mail) => { mails.push(m); return { messageId: "m" }; } } as unknown as AuthModuleConfig["emailService"],
        emailConfig: { from: "noreply@app.test", appName: "TestApp", resetPasswordUrl: "https://app.test/admin" },
        oauthProviders: [{
            id: "google",
            schema: oauthCodeFlowSchema(),
            verify: async (payload: { code: string }) => {
                const [providerId, email] = payload.code.split("|");
                return { providerId, email, emailVerified: true };
            }
        }],
        ...overrides
    }));
    const call = async (method: string, path: string, body?: unknown, token?: string) => {
        const res = await app.request(path, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : {} };
    };
    /** The token in the last link mailed to `to`. */
    const linkMailedTo = async (to: string) => {
        await new Promise(resolve => setImmediate(resolve));
        const mail = [...mails].reverse().find(m => m.to === to && /token=/.test(m.text ?? ""));
        return mail ? /confirm-email-change\?token=([A-Za-z0-9_-]+)/.exec(mail.text!)?.[1] : undefined;
    };
    const register = async (email: string) => {
        const res = await call("POST", "/auth/register", { email, password: PASSWORD });
        expect(res.status).toBe(201);
        return res.json as { user: { uid: string }; tokens: { accessToken: string; refreshToken: string } };
    };
    return { store, mails, call, linkMailedTo, register };
}

describe("POST /auth/change-email, then /auth/confirm-email-change", () => {
    it("mails the new address a link and the old one a notice, and the link moves the account, sessions kept", async () => {
        const w = world();
        const member = await w.register("old@corp.com");
        w.mails.length = 0;

        const asked = await w.call("POST", "/auth/change-email", { newEmail: "New@Corp.com" }, member.tokens.accessToken);
        expect(asked.status).toBe(200);
        expect(asked.json.pendingEmail).toBe("new@corp.com");

        await new Promise(resolve => setImmediate(resolve));
        expect(w.mails.map(m => m.to).sort()).toEqual(["new@corp.com", "old@corp.com"]);
        expect(w.mails.find(m => m.to === "old@corp.com")?.text).not.toMatch(/token=/);
        const token = await w.linkMailedTo("new@corp.com");
        expect(token).toBeDefined();
        // Mailed under the frontend's own path, so the app's screen opens it.
        expect(w.mails.find(m => m.to === "new@corp.com")?.text).toContain("https://app.test/admin/confirm-email-change?token=");

        // Nothing has moved yet.
        const before = await w.call("GET", "/auth/me", undefined, member.tokens.accessToken);
        expect(before.json.user).toMatchObject({ email: "old@corp.com", pendingEmail: "new@corp.com" });

        const confirmed = await w.call("POST", "/auth/confirm-email-change", { token });
        expect(confirmed.status).toBe(200);
        expect(confirmed.json.user).toMatchObject({ uid: member.user.uid, email: "new@corp.com", emailVerified: true });

        // The session that asked is still good, and so is its refresh token.
        const me = await w.call("GET", "/auth/me", undefined, member.tokens.accessToken);
        expect(me.json.user).toMatchObject({ email: "new@corp.com", emailVerified: true, pendingEmail: null });
        expect((await w.call("POST", "/auth/refresh", { refreshToken: member.tokens.refreshToken })).status).toBe(200);
        expect((await w.call("POST", "/auth/login", { email: "new@corp.com", password: PASSWORD })).status).toBe(200);
        expect((await w.call("POST", "/auth/login", { email: "old@corp.com", password: PASSWORD })).status).toBe(401);

        // Spent.
        expect((await w.call("POST", "/auth/confirm-email-change", { token })).json.error.code).toBe("INVALID_TOKEN");
    });

    it("refuses an address another account holds, one no mail reaches, and the account's own", async () => {
        const w = world();
        const member = await w.register("me@corp.com");
        await w.register("taken@corp.com");

        expect((await w.call("POST", "/auth/change-email", { newEmail: "TAKEN@corp.com" }, member.tokens.accessToken)).json.error.code).toBe("EMAIL_EXISTS");
        const synthetic = await w.call("POST", "/auth/change-email", { newEmail: "x@anonymous.local" }, member.tokens.accessToken);
        expect(synthetic.status).toBe(409);
        expect(synthetic.json.error.code).toBe("UNDELIVERABLE_ADDRESS");
        expect((await w.call("POST", "/auth/change-email", { newEmail: "me@corp.com" }, member.tokens.accessToken)).json.error.code).toBe("EMAIL_UNCHANGED");
        expect(w.store.pendingEmailChanges.size).toBe(0);
    });

    it("refuses when the address is taken by the time the link is followed, and moves nothing", async () => {
        const w = world();
        const member = await w.register("first@corp.com");
        await w.call("POST", "/auth/change-email", { newEmail: "contested@corp.com" }, member.tokens.accessToken);
        const token = await w.linkMailedTo("contested@corp.com");

        // A second account claims the address mid-flight: registering it is
        // not stopped by somebody else's unconfirmed change.
        await w.register("contested@corp.com");

        const confirmed = await w.call("POST", "/auth/confirm-email-change", { token });
        expect(confirmed.status).toBe(409);
        expect(confirmed.json.error.code).toBe("EMAIL_EXISTS");
        expect(w.store.users.get(member.user.uid)?.email).toBe("first@corp.com");
        expect([...w.store.users.values()].filter(u => u.email === "contested@corp.com")).toHaveLength(1);
    });

    it("lets only one of two accounts asking for the same address have it", async () => {
        const w = world();
        const a = await w.register("a@corp.com");
        const b = await w.register("b@corp.com");
        await w.call("POST", "/auth/change-email", { newEmail: "shared@corp.com" }, a.tokens.accessToken);
        const tokenA = await w.linkMailedTo("shared@corp.com");
        await w.call("POST", "/auth/change-email", { newEmail: "shared@corp.com" }, b.tokens.accessToken);
        const tokenB = await w.linkMailedTo("shared@corp.com");
        expect(tokenB).not.toBe(tokenA);

        expect((await w.call("POST", "/auth/confirm-email-change", { token: tokenB })).status).toBe(200);
        expect((await w.call("POST", "/auth/confirm-email-change", { token: tokenA })).json.error.code).toBe("EMAIL_EXISTS");
        expect(w.store.users.get(a.user.uid)?.email).toBe("a@corp.com");
        expect(w.store.users.get(b.user.uid)?.email).toBe("shared@corp.com");
    });

    it("detaches the identities that vouched for the old address, and keeps the others", async () => {
        const w = world();
        const signedIn = await w.call("POST", "/auth/google", { code: "g-old|old@corp.com", redirectUri: "https://app.test/cb" });
        const uid = signedIn.json.user.uid as string;
        // A second identity, linked with a different address.
        await w.store.repo().linkUserIdentity(uid, "github", "gh-1", { email: "someone@elsewhere.com", emailVerified: true });

        await w.call("POST", "/auth/change-email", { newEmail: "new@corp.com" }, signedIn.json.tokens.accessToken);
        const confirmed = await w.call("POST", "/auth/confirm-email-change", { token: await w.linkMailedTo("new@corp.com") });

        expect(confirmed.json.removedProviders).toEqual(["google"]);
        expect(w.store.providersOf(uid)).toEqual(["github"]);
    });

    it("keeps one pending change: a new request replaces the last, whose link stops working", async () => {
        const w = world();
        const member = await w.register("me@corp.com");
        await w.call("POST", "/auth/change-email", { newEmail: "first-try@corp.com" }, member.tokens.accessToken);
        const first = await w.linkMailedTo("first-try@corp.com");
        await w.call("POST", "/auth/change-email", { newEmail: "second-try@corp.com" }, member.tokens.accessToken);

        expect((await w.call("POST", "/auth/confirm-email-change", { token: first })).json.error.code).toBe("INVALID_TOKEN");
        expect((await w.call("POST", "/auth/confirm-email-change", { token: await w.linkMailedTo("second-try@corp.com") })).status).toBe(200);
    });

    it("refuses a link older than 24 hours", async () => {
        const w = world();
        const member = await w.register("me@corp.com");
        await w.call("POST", "/auth/change-email", { newEmail: "late@corp.com" }, member.tokens.accessToken);
        const token = await w.linkMailedTo("late@corp.com");
        w.store.pendingEmailChanges.get(member.user.uid)!.sentAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

        expect((await w.call("POST", "/auth/confirm-email-change", { token })).json.error.code).toBe("INVALID_TOKEN");
        expect(w.store.users.get(member.user.uid)?.email).toBe("me@corp.com");
    });

    it("needs the second factor on an account that has one", async () => {
        const w = world();
        const member = await w.register("mfa@corp.com");
        const factor = await w.store.repo().createMfaFactor(member.user.uid, "totp", "secret");
        await w.store.repo().verifyMfaFactor(factor.id);

        const aal1 = await generateAccessToken(member.user.uid, [], "aal1", undefined, false);
        expect((await w.call("POST", "/auth/change-email", { newEmail: "x@corp.com" }, aal1)).json.error.code).toBe("AAL2_REQUIRED");
        const aal2 = await generateAccessToken(member.user.uid, [], "aal2", undefined, false);
        expect((await w.call("POST", "/auth/change-email", { newEmail: "x@corp.com" }, aal2)).status).toBe(200);
    });

    it("is not for a guest, and needs a session", async () => {
        const w = world({ allowAnonymous: true });
        const guest = await w.call("POST", "/auth/anonymous");
        expect((await w.call("POST", "/auth/change-email", { newEmail: "g@corp.com" }, guest.json.tokens.accessToken)).json.error.code).toBe("ANONYMOUS_USER");
        expect((await w.call("POST", "/auth/change-email", { newEmail: "g@corp.com" })).status).toBe(401);
    });

    it("lets beforeEmailChange refuse the new address", async () => {
        const w = world({
            authHooks: {
                hashPassword: async (password: string) => `hashed:${password}`,
                verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`,
                beforeEmailChange: async (_user, newEmail) => {
                    if (!newEmail.endsWith("@corp.com")) throw new Error("Only corp.com addresses");
                }
            }
        });
        const member = await w.register("me@corp.com");
        const refused = await w.call("POST", "/auth/change-email", { newEmail: "me@gmail.com" }, member.tokens.accessToken);
        expect(refused.status).toBe(400);
        expect(refused.json.error.code).toBe("HOOK_REJECTED");
        expect(w.store.pendingEmailChanges.size).toBe(0);
    });

    it("needs email to be configured, since the link is mailed", async () => {
        const w = world({ emailService: undefined });
        const member = await w.register("me@corp.com");
        expect((await w.call("POST", "/auth/change-email", { newEmail: "x@corp.com" }, member.tokens.accessToken)).status).toBe(503);
    });

    it("stores only the hash of the token it mails", async () => {
        const w = world();
        const member = await w.register("me@corp.com");
        await w.call("POST", "/auth/change-email", { newEmail: "hashed@corp.com" }, member.tokens.accessToken);
        const token = await w.linkMailedTo("hashed@corp.com");
        expect(w.store.pendingEmailChanges.get(member.user.uid)?.tokenHash).toBe(hashToken(token!));
    });
});

describe("mail to an address no mail reaches", () => {
    it("sends an X account's placeholder address no welcome mail", async () => {
        const w = world();
        await w.call("POST", "/auth/google", { code: "x-1|123@twitter.placeholder.rebase", redirectUri: "https://app.test/cb" });
        await new Promise(resolve => setImmediate(resolve));
        expect(w.mails.filter(m => m.to.endsWith("twitter.placeholder.rebase"))).toEqual([]);
    });
});
