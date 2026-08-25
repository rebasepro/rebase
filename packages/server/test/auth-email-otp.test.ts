import { describe, it, expect, beforeEach, jest } from "@jest/globals";
/**
 * Email one-time codes.
 *
 * Six digits is a million possibilities, which is nothing to a machine. So the
 * tests that matter are not "does it log me in" — they are the four things that
 * keep a million from being enough:
 *
 *  - the code is bound to the address it was mailed to, so a guess is a guess
 *    against one account rather than against the whole table;
 *  - a code is single-use;
 *  - it expires;
 *  - attempts are limited per address, not only per IP — an IP is the
 *    attacker's to rotate and the account under attack is not.
 *
 * Plus the one that is not about brute force at all: the request endpoint must
 * answer the same thing whether or not the address has an account, or it is an
 * oracle for "is this person a customer?".
 */
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, type AuthModuleConfig } from "../src/auth/routes";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt } from "../src/auth/jwt";
import { hashToken } from "../src/auth/admin-user-ops";
import { generateOtpCode, otpTokenMaterial, OTP_TTL_MS } from "../src/auth/otp-routes";

const TEST_SECRET = "email-otp-test-secret-key-that-is-definitely-32-chars-long!!";
/**
 * A fresh address per test.
 *
 * The verification limiter keys on the address and its counts live for the
 * process, so two tests sharing one address share one budget — and the second
 * one fails with a 429 that has nothing to do with what it was checking.
 */
let addressCounter = 0;
const nextEmail = () => `someone-${++addressCounter}@example.com`;

interface StoredToken {
    uid: string;
    tokenHash: string;
    expiresAt: Date;
    used: boolean;
}

/** The magic-link token store, in memory, with the semantics the routes rely on. */
function tokenStore() {
    const tokens: StoredToken[] = [];
    return {
        tokens,
        createMagicLinkToken: async (uid: string, tokenHash: string, expiresAt: Date) => {
            tokens.push({ uid, tokenHash, expiresAt, used: false });
        },
        findValidMagicLinkToken: async (tokenHash: string) => {
            const found = tokens.find(t =>
                t.tokenHash === tokenHash && !t.used && t.expiresAt.getTime() > Date.now());
            return found ? { uid: found.uid, expiresAt: found.expiresAt } : null;
        },
        markMagicLinkTokenUsed: async (tokenHash: string) => {
            const found = tokens.find(t => t.tokenHash === tokenHash);
            if (found) found.used = true;
        }
    };
}

function createApp(opts: { withEmail?: boolean; knownEmail?: string } = {}) {
    configureJwt({ secret: TEST_SECRET });

    const email = opts.knownEmail ?? nextEmail();
    const store = tokenStore();
    const sent: Array<{ to: string; subject: string; html?: string; text?: string }> = [];

    const user = {
        id: "user-1",
        email,
        displayName: "Someone",
        photoUrl: null,
        emailVerified: false,
        passwordHash: "salt:hash",
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const authRepo = {
        ...store,
        getUserByEmail: jest.fn(async (email: string) =>
            email.toLowerCase() === user.email.toLowerCase() ? user : null),
        getUserById: jest.fn(async (uid: string) => (uid === user.id ? user : null)),
        getUserRoles: jest.fn(async () => [
            { id: "editor", name: "Editor", isAdmin: false, defaultPermissions: null, collectionPermissions: null }
        ]),
        getUserRoleIds: jest.fn(async () => ["editor"]),
        getUserWithRoles: jest.fn(async () => ({ user, roles: [] })),
        setEmailVerified: jest.fn(async () => { user.emailVerified = true; }),
        createRefreshToken: jest.fn(async () => undefined),
        getTokensValidAfter: jest.fn(async () => null),
        getUserIdentities: jest.fn(async () => [])
    } as unknown as AuthRepository;

    const config: AuthModuleConfig = {
        authRepo,
        enableEmailOtp: true,
        emailService: {
            isConfigured: () => opts.withEmail !== false,
            send: async (message: { to: string; subject: string; html?: string; text?: string }) => {
                sent.push(message);
                return { messageId: "test" };
            }
        } as never,
        emailConfig: opts.withEmail === false
            ? undefined
            : { from: "no-reply@test", appName: "TestApp", resetPasswordUrl: "https://app.test" }
    } as unknown as AuthModuleConfig;

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes(config));

    return { app, store, sent, user, email };
}

const post = (app: Hono<HonoEnv>, path: string, body: unknown) =>
    app.fetch(new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));

/** The code that was mailed, read out of the message the way a person would. */
const codeFrom = (message: { subject: string; text?: string }): string =>
    message.subject.match(/\b(\d{6})\b/)![1];

describe("generateOtpCode", () => {
    it("is always six digits, including when the number is small", () => {
        for (let i = 0; i < 500; i++) {
            expect(generateOtpCode()).toMatch(/^\d{6}$/);
        }
    });

    it("does not produce the same code twice in a row, in practice", () => {
        const codes = new Set(Array.from({ length: 200 }, generateOtpCode));
        // A generator stuck on one value — a `randomInt(0, 0)`, a cached
        // constant — is the failure that a six-digit check alone would pass.
        expect(codes.size).toBeGreaterThan(150);
    });
});

describe("otpTokenMaterial", () => {
    it("binds the code to the address", () => {
        expect(otpTokenMaterial("a@b.c", "123456")).not.toBe(otpTokenMaterial("d@e.f", "123456"));
    });

    it("treats the address case-insensitively, as mail does", () => {
        expect(otpTokenMaterial("A@B.C", "123456")).toBe(otpTokenMaterial(" a@b.c ", "123456"));
    });

    it("cannot be presented as a magic-link token", () => {
        // The magic-link route hashes the bare token. A code that hashed to the
        // same thing would be a second, weaker way into `/magic-link/verify`.
        expect(hashToken(otpTokenMaterial("a@b.c", "123456"))).not.toBe(hashToken("123456"));
    });
});

describe("POST /auth/otp", () => {
    it("mails a code and stores its hash", async () => {
        const { app, store, sent, email: EMAIL } = createApp();

        const response = await post(app, "/auth/otp", { email: EMAIL });

        expect(response.status).toBe(200);
        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe(EMAIL);

        const code = codeFrom(sent[0]);
        expect(store.tokens).toHaveLength(1);
        expect(store.tokens[0].tokenHash).toBe(hashToken(otpTokenMaterial(EMAIL, code)));
    });

    it("stores a hash, never the code itself", async () => {
        const { app, store, sent, email: EMAIL } = createApp();
        await post(app, "/auth/otp", { email: EMAIL });

        expect(store.tokens[0].tokenHash).not.toContain(codeFrom(sent[0]));
    });

    it("expires the code in ten minutes", async () => {
        const { app, store, email: EMAIL } = createApp();
        const before = Date.now();
        await post(app, "/auth/otp", { email: EMAIL });

        const ttl = store.tokens[0].expiresAt.getTime() - before;
        expect(ttl).toBeGreaterThan(OTP_TTL_MS - 5_000);
        expect(ttl).toBeLessThanOrEqual(OTP_TTL_MS + 1_000);
    });

    it("answers the same for an address with no account, and sends nothing", async () => {
        const { app, sent, store, email: EMAIL } = createApp();

        const known = await post(app, "/auth/otp", { email: EMAIL });
        const unknown = await post(app, "/auth/otp", { email: "nobody@example.com" });

        expect(unknown.status).toBe(known.status);
        expect(await unknown.json()).toEqual(await known.json());
        expect(sent).toHaveLength(1);
        expect(store.tokens).toHaveLength(1);
    });

    it("refuses a malformed address rather than mailing it", async () => {
        const { app, sent, email: EMAIL } = createApp();

        expect((await post(app, "/auth/otp", { email: "not-an-address" })).status).toBe(400);
        expect(sent).toHaveLength(0);
    });

    it("says so when no email service is configured", async () => {
        const { app, email: EMAIL } = createApp({ withEmail: false });

        const response = await post(app, "/auth/otp", { email: EMAIL });

        expect(response.status).toBe(503);
        expect((await response.json() as { error: { code: string } }).error.code)
            .toBe("EMAIL_NOT_CONFIGURED");
    });
});

describe("POST /auth/otp/verify", () => {
    let app: Hono<HonoEnv>;
    let store: ReturnType<typeof tokenStore>;
    let sent: Array<{ to: string; subject: string }>;
    let code: string;
    let EMAIL: string;

    beforeEach(async () => {
        ({ app, store, sent, email: EMAIL } = createApp());
        await post(app, "/auth/otp", { email: EMAIL });
        code = codeFrom(sent[0]);
    });

    it("trades a valid code for a session", async () => {
        const response = await post(app, "/auth/otp/verify", { email: EMAIL, code });

        expect(response.status).toBe(200);
        const body = await response.json() as { tokens?: { accessToken?: string }; user?: { email: string } };
        expect(body.tokens?.accessToken).toBeTruthy();
        expect(body.user?.email).toBe(EMAIL);
    });

    it("refuses the same code twice", async () => {
        expect((await post(app, "/auth/otp/verify", { email: EMAIL, code })).status).toBe(200);

        const second = await post(app, "/auth/otp/verify", { email: EMAIL, code });
        expect(second.status).toBe(400);
        expect((await second.json() as { error: { code: string } }).error.code).toBe("INVALID_CODE");
    });

    it("refuses a code presented with a different address", async () => {
        // The binding, from the attacker's side: a code harvested from one
        // inbox is worth nothing against another account, and a code guessed
        // at random is a guess against one named account rather than against
        // every account at once.
        const response = await post(app, "/auth/otp/verify", { email: "other@example.com", code });

        expect(response.status).toBe(400);
    });

    it("refuses a wrong code", async () => {
        const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");

        expect((await post(app, "/auth/otp/verify", { email: EMAIL, code: wrong })).status).toBe(400);
    });

    it("refuses an expired code", async () => {
        store.tokens[0].expiresAt = new Date(Date.now() - 1000);

        expect((await post(app, "/auth/otp/verify", { email: EMAIL, code })).status).toBe(400);
    });

    it("refuses something that is not six digits without looking it up", async () => {
        const lookup = jest.spyOn(store, "findValidMagicLinkToken");

        expect((await post(app, "/auth/otp/verify", { email: EMAIL, code: "12345" })).status).toBe(400);
        expect((await post(app, "/auth/otp/verify", { email: EMAIL, code: "abcdef" })).status).toBe(400);
        expect(lookup).not.toHaveBeenCalled();
    });

    it("marks the address verified — reading the code proves the inbox", async () => {
        const { app: fresh, sent: freshSent, email: freshEmail } = createApp();
        await post(fresh, "/auth/otp", { email: freshEmail });

        const response = await post(fresh, "/auth/otp/verify", {
            email: freshEmail,
            code: codeFrom(freshSent[0])
        });

        expect(response.status).toBe(200);
        expect((await response.json() as { user: { emailVerified: boolean } }).user.emailVerified).toBe(true);
    });
});

describe("verification attempts are limited per address", () => {
    it("stops guessing at one account without stopping another", async () => {
        // Five attempts per address per window, keyed on the address rather
        // than the IP: this whole test runs from one "IP", so an IP-keyed
        // limiter would either lock both addresses out or neither.
        const { app, email: victim } = createApp();

        const guess = (email: string) =>
            post(app, "/auth/otp/verify", { email, code: "000000" });

        const statuses: number[] = [];
        for (let i = 0; i < 7; i++) {
            statuses.push((await guess(victim)).status);
        }

        expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
        expect(statuses.slice(5)).toEqual([429, 429]);

        // A second address is untouched by the first one's exhausted budget.
        expect((await guess(nextEmail())).status).toBe(400);
    });
});
