/**
 * Following an email-verification link is a first proof of address, and holds
 * to what the other three are held to (`unproven-credentials.test.ts`).
 *
 * `GET /auth/verify-email` used to mark the account verified and nothing else.
 * So the pre-hijack the other proofs close was open through this one: an
 * attacker registers `victim@corp.com` with a password, asks for the
 * verification mail to be sent, the owner follows it — and the attacker's
 * password is now on a verified account, which the owner's "Sign in with
 * Google" auto-links into.
 *
 * A link proves the inbox and nothing about who registered. So it keeps only
 * what the person following it also proves — a live session of the account,
 * or its password — and takes the rest off. And because registration now
 * mails the link itself, the owner proves the address on their own terms and
 * keeps the password they chose.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, type AuthModuleConfig } from "../src/auth/routes";
import type { OAuthProviderProfile } from "../src/auth/interfaces";
import { configureJwt } from "../src/auth/jwt";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const VICTIM = "victim@corp.com";
const ATTACKER_PASSWORD = "Att4cker-Passw0rd";
const OWNER_PASSWORD = "Own3r-Chosen-Passw0rd";

const PROFILES: Record<string, OAuthProviderProfile> = {
    spotify: { providerId: "attacker-spotify", email: VICTIM, emailVerified: false },
    google: { providerId: "victim-google", email: VICTIM, emailVerified: true }
};

beforeAll(() => configureJwt({ secret: "email-verification-proof-secret-at-least-32", accessExpiresIn: "1h" }));

interface Mail { to: string; subject: string; text?: string }

function world(overrides: Partial<AuthModuleConfig> = {}) {
    const store = new MemoryAuthStore();
    const mails: Mail[] = [];
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: {
            hashPassword: async (password: string) => `hashed:${password}`,
            verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
        },
        allowRegistration: true,
        emailService: {
            isConfigured: () => true,
            send: async (mail: Mail) => {
                mails.push(mail);
                return { messageId: "m" };
            }
        } as unknown as AuthModuleConfig["emailService"],
        emailConfig: { from: "noreply@app.test", appName: "TestApp", resetPasswordUrl: "https://app.test" },
        oauthProviders: Object.keys(PROFILES).map(id => ({
            id,
            schema: oauthCodeFlowSchema(),
            verify: async () => PROFILES[id]
        })),
        ...overrides
    }));

    async function call(method: string, path: string, body?: unknown, token?: string) {
        const res = await app.request(path, {
            method,
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        return { status: res.status, json: text ? JSON.parse(text) : {} };
    }

    /** The token in the latest verification mail to `to`, once the background send has run. */
    async function mailedVerificationToken(to = VICTIM): Promise<string> {
        await new Promise(resolve => setImmediate(resolve));
        const mail = [...mails].reverse().find(m => m.to === to && /verify-email\?token=/.test(m.text ?? ""));
        if (!mail) throw new Error(`no verification mail to ${to}; got ${mails.map(m => m.subject).join(", ")}`);
        return /verify-email\?token=([A-Za-z0-9_-]+)/.exec(mail.text!)![1];
    }

    return {
        store,
        mails,
        call,
        mailedVerificationToken,
        register: (password: string) => call("POST", "/auth/register", { email: VICTIM, password }),
        login: (password: string) => call("POST", "/auth/login", { email: VICTIM, password }),
        google: () => call("POST", "/auth/google", { code: "c", redirectUri: "https://app.test/cb" }),
        spotify: () => call("POST", "/auth/spotify", { code: "c", redirectUri: "https://app.test/cb" })
    };
}

describe("the pre-hijack through the verification link (IDENTITY-1)", () => {
    it("is closed: the owner follows the link the attacker asked for, and the attacker's password is gone", async () => {
        const w = world();
        const attacker = await w.register(ATTACKER_PASSWORD);
        expect(attacker.status).toBe(201);
        await w.mailedVerificationToken();
        // The attacker asks for the genuine mail to be sent to the owner.
        expect((await w.call("POST", "/auth/send-verification", undefined, attacker.json.tokens.accessToken)).status).toBe(200);
        const link = await w.mailedVerificationToken();

        // The owner follows it, in their own browser: no session of this account.
        const followed = await w.call("GET", `/auth/verify-email?token=${link}`);
        expect(followed.status).toBe(200);
        expect(followed.json.passwordRemoved).toBe(true);

        // The owner later signs in with Google, which auto-links now that the
        // address is verified, into an account the attacker cannot enter.
        const owner = await w.google();
        expect(owner.status).toBe(200);
        expect(owner.json.user.uid).toBe(attacker.json.user.uid);
        expect((await w.login(ATTACKER_PASSWORD)).json.error?.code).toBe("INVALID_CREDENTIALS");
        expect((await w.call("POST", "/auth/refresh", { refreshToken: attacker.json.tokens.refreshToken })).status).toBe(401);
    });

    it("removes an identity whose provider did not vouch for the address", async () => {
        const w = world();
        const attacker = await w.spotify();
        expect(attacker.status).toBe(200);
        expect((await w.call("POST", "/auth/send-verification", undefined, attacker.json.tokens.accessToken)).status).toBe(200);

        const followed = await w.call("GET", `/auth/verify-email?token=${await w.mailedVerificationToken()}`);

        expect(followed.json.removedProviders).toEqual(["spotify"]);
        expect(w.store.providersOf(attacker.json.user.uid)).toEqual([]);
    });
});

describe("the owner's own verification (IDENTITY-6)", () => {
    it("is mailed at registration, and followed while signed in keeps the password they chose", async () => {
        const w = world();
        const owner = await w.register(OWNER_PASSWORD);
        const link = await w.mailedVerificationToken();

        const followed = await w.call("GET", `/auth/verify-email?token=${link}`, undefined, owner.json.tokens.accessToken);

        expect(followed.json).toMatchObject({ success: true, passwordRemoved: false });
        expect((await w.login(OWNER_PASSWORD)).status).toBe(200);
        // And a later magic link or code has nothing left to remove.
        expect([...w.store.users.values()][0].emailVerified).toBe(true);
    });

    it("asks for the password instead of removing it when followed signed out", async () => {
        const w = world();
        await w.register(OWNER_PASSWORD);
        const link = await w.mailedVerificationToken();

        const asked = await w.call("POST", "/auth/verify-email", { token: link });
        expect(asked.status).toBe(409);
        expect(asked.json.error).toMatchObject({ code: "PROOF_REQUIRED", details: { password: true, providers: [] } });

        expect((await w.call("POST", "/auth/verify-email", { token: link, password: "not-it" })).status).toBe(401);

        const proven = await w.call("POST", "/auth/verify-email", { token: link, password: OWNER_PASSWORD });
        expect(proven.status).toBe(200);
        expect(proven.json.tokens.accessToken).toBeDefined();
        expect(proven.json.user.emailVerified).toBe(true);
        expect((await w.login(OWNER_PASSWORD)).status).toBe(200);
    });

    it("verifies without the password when asked to, and says it removed it", async () => {
        const w = world();
        await w.register(ATTACKER_PASSWORD);
        const link = await w.mailedVerificationToken();

        const followed = await w.call("POST", "/auth/verify-email", { token: link, removeUnproven: true });

        expect(followed.json).toMatchObject({ success: true, passwordRemoved: true });
        expect((await w.login(ATTACKER_PASSWORD)).status).toBe(401);
    });

    it("refuses a link older than a day", async () => {
        const w = world();
        const owner = await w.register(OWNER_PASSWORD);
        const link = await w.mailedVerificationToken();
        [...w.store.users.values()][0].emailVerificationSentAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

        const followed = await w.call("GET", `/auth/verify-email?token=${link}`, undefined, owner.json.tokens.accessToken);

        expect(followed.status).toBe(400);
        expect(followed.json.error.code).toBe("INVALID_TOKEN");
    });
});

describe("requireEmailVerification (confirm-first)", () => {
    it("signs nobody in at registration, and answers an existing address the same way", async () => {
        const w = world({ requireEmailVerification: true });

        const first = await w.register(OWNER_PASSWORD);
        expect(first.status).toBe(200);
        expect(first.json).toMatchObject({ success: true, confirmationRequired: true });
        expect(first.json.tokens).toBeUndefined();

        const again = await w.register(ATTACKER_PASSWORD);
        expect(again).toEqual(first);
        // The existing, unconfirmed account is mailed its link again; the
        // password the first registrant chose is untouched.
        expect(w.mails.filter(m => m.to === VICTIM)).toHaveLength(2);
        expect([...w.store.users.values()][0].passwordHash).toBe(`hashed:${OWNER_PASSWORD}`);
    });

    it("refuses password sign-in until the address is verified — and only says so to the password's holder", async () => {
        const w = world({ requireEmailVerification: true });
        await w.register(OWNER_PASSWORD);

        expect((await w.login("wrong-password")).json.error.code).toBe("INVALID_CREDENTIALS");
        const refused = await w.login(OWNER_PASSWORD);
        expect(refused.status).toBe(403);
        expect(refused.json.error.code).toBe("EMAIL_NOT_CONFIRMED");

        const link = await w.mailedVerificationToken();
        const completed = await w.call("POST", "/auth/verify-email", { token: link, password: OWNER_PASSWORD });
        expect(completed.status).toBe(200);
        expect((await w.login(OWNER_PASSWORD)).status).toBe(200);
    });

    it("keeps 409 EMAIL_EXISTS when it is off", async () => {
        const w = world();
        await w.register(OWNER_PASSWORD);
        expect((await w.register(OWNER_PASSWORD)).json.error.code).toBe("EMAIL_EXISTS");
    });
});

/**
 * The guard for the class (42, a second door into the same operation): an
 * account is marked verified by the one function that also settles what
 * nobody proved. The verification link was the fourth proof of address, added
 * without it.
 */
describe("who marks an address verified", () => {
    it("is confirmAddressOwnership alone", async () => {
        const { readdirSync, readFileSync, statSync } = await import("node:fs");
        const { join, relative } = await import("node:path");
        const root = join(__dirname, "../src");
        const callers: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name);
                if (statSync(path).isDirectory()) walk(path);
                else if (path.endsWith(".ts") && !path.endsWith(".test.ts") && /\.setEmailVerified\(/.test(readFileSync(path, "utf8"))) {
                    callers.push(relative(root, path));
                }
            }
        };
        walk(root);
        expect(callers).toEqual(["auth/address-ownership.ts"]);
    });
});

describe("the welcome mail", () => {
    it("points at the app's own address, not a /app route nothing serves", async () => {
        const w = world();
        await w.register(OWNER_PASSWORD);
        await new Promise(resolve => setImmediate(resolve));
        const welcome = w.mails.find(m => !/verify-email/.test(m.text ?? ""));
        expect(welcome?.text).toContain("https://app.test");
        expect(welcome?.text).not.toContain("https://app.test/app");
    });
});
