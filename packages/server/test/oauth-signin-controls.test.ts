/**
 * OAuth sign-in — the controls the shared route applies to all twelve providers.
 *
 * `POST /auth/<provider>` runs one find-or-create-or-link decision for every
 * provider, so every gap in it was a gap twelve times over: it created accounts
 * without consulting the registration policy (kill switch and
 * first-user-becomes-admin included), it auto-linked onto local accounts whose
 * address nobody had ever verified, and it accepted any `redirectUri` the
 * caller sent.
 */

import { describe, it, expect, beforeEach, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";

import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, type AuthModuleConfig } from "../src/auth/routes";
import type { AuthRepository, OAuthProviderProfile, UserData } from "../src/auth/interfaces";
import { configureJwt } from "../src/auth/jwt";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { decideOAuthAutoLink, isRedirectUriAllowed } from "../src/auth/oauth-signin-policy";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() }
}));

// Rate limiters share state across tests and would 429 the later cases.
jest.mock("../src/auth/rate-limiter", () => {
    const passthrough = async (_c: unknown, next: () => Promise<void>) => next();
    return { createRateLimiter: () => passthrough, defaultAuthLimiter: passthrough, strictAuthLimiter: passthrough };
});

const TEST_SECRET = "oauth-controls-test-secret-key-that-is-definitely-32-chars!!";
const REDIRECT = "https://admin.example.com/callback";

function mockUser(overrides: Partial<UserData> = {}): UserData {
    return {
        id: "user-1",
        email: "user@example.com",
        passwordHash: "salt:hash",
        displayName: "User",
        photoUrl: null,
        emailVerified: false,
        emailVerificationToken: null,
        emailVerificationSentAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides
    };
}

let repo: jest.Mocked<AuthRepository>;
let verifyImpl: () => Promise<OAuthProviderProfile | null>;

interface AppOptions {
    allowRegistration?: boolean;
    disableSelfRegistration?: boolean;
    allowedRedirectUris?: string[];
}

function createApp(opts: AppOptions = {}) {
    repo = {
        getUserByEmail: jest.fn<() => Promise<UserData | null>>().mockResolvedValue(null),
        getUserByIdentity: jest.fn<() => Promise<UserData | null>>().mockResolvedValue(null),
        linkUserIdentity: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        getUserIdentities: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
        getUserById: jest.fn<() => Promise<UserData | null>>().mockResolvedValue(null),
        createUser: jest.fn((data: { email: string; emailVerified?: boolean }) =>
            Promise.resolve(mockUser({ id: "new-user", email: data.email, passwordHash: null, emailVerified: data.emailVerified ?? false }))),
        listUsers: jest.fn<() => Promise<UserData[]>>().mockResolvedValue([]),
        listUsersPaginated: jest.fn<() => Promise<{ users: UserData[]; total: number; limit: number; offset: number }>>()
            .mockResolvedValue({ users: [], total: 0, limit: 1, offset: 0 }),
        getUserRoles: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
        getUserRoleIds: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
        assignDefaultRole: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        setUserRoles: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        updateUser: jest.fn((id: string) => Promise.resolve(mockUser({ id }))),
        deleteUser: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        getUserWithRoles: jest.fn((uid: string) => Promise.resolve({ user: mockUser({ id: uid }), roles: [] })),
        createRefreshToken: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        findRefreshTokenByHash: jest.fn<() => Promise<null>>().mockResolvedValue(null),
        deleteRefreshToken: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        deleteAllRefreshTokensForUser: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        listRefreshTokensForUser: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
        deleteRefreshTokenById: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        getTokensValidAfter: jest.fn<() => Promise<null>>().mockResolvedValue(null),
        setTokensValidAfter: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<AuthRepository>;

    const config: AuthModuleConfig = {
        authRepo: repo,
        allowRegistration: opts.allowRegistration ?? true,
        disableSelfRegistration: opts.disableSelfRegistration,
        allowedRedirectUris: opts.allowedRedirectUris,
        oauthProviders: [
            {
                id: "acme",
                schema: oauthCodeFlowSchema(),
                verify: async () => verifyImpl()
            }
        ]
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes(config));
    return app;
}

function signIn(app: Hono<HonoEnv>, redirectUri = REDIRECT) {
    return app.request("/auth/acme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "auth-code", redirectUri })
    });
}

function providerReturns(profile: Partial<OAuthProviderProfile> = {}) {
    verifyImpl = async () => ({
        providerId: "acme-1",
        email: "user@example.com",
        displayName: "User",
        photoUrl: null,
        emailVerified: true,
        ...profile
    });
}

beforeAll(() => {
    configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
});

beforeEach(() => {
    jest.clearAllMocks();
    providerReturns();
});

// ═══════════════════════════════════════════════════════════════════════════

describe("decideOAuthAutoLink", () => {
    const cases: Array<[string, Parameters<typeof decideOAuthAutoLink>[0], boolean, string | undefined]> = [
        ["provider verified + local verified", { providerEmailVerified: true, existingUser: { emailVerified: true, passwordHash: "h" } }, true, undefined],
        ["provider verified + local has no password", { providerEmailVerified: true, existingUser: { emailVerified: false, passwordHash: null } }, true, undefined],
        ["provider verified + local password never verified", { providerEmailVerified: true, existingUser: { emailVerified: false, passwordHash: "h" } }, false, "local-account-unverified"],
        ["provider unverified", { providerEmailVerified: false, existingUser: { emailVerified: true, passwordHash: "h" } }, false, "provider-email-unverified"],
        ["provider omitted the flag entirely", { providerEmailVerified: undefined, existingUser: { emailVerified: true, passwordHash: "h" } }, false, "provider-email-unverified"]
    ];

    it.each(cases)("%s", (_name, args, allowed, reason) => {
        const decision = decideOAuthAutoLink(args);
        expect(decision.allowed).toBe(allowed);
        if (!decision.allowed) expect(decision.reason).toBe(reason);
    });
});

describe("isRedirectUriAllowed", () => {
    it("allows anything when no allowlist is configured", () => {
        expect(isRedirectUriAllowed("https://anywhere.example/cb", undefined)).toBe(true);
        expect(isRedirectUriAllowed("https://anywhere.example/cb", [])).toBe(true);
    });

    it.each([
        ["exact match", "https://admin.example.com/cb", true],
        ["trailing slash", "https://admin.example.com/cb/", true],
        ["host case", "https://ADMIN.example.com/cb", true],
        ["query string ignored", "https://admin.example.com/cb?code=x", true],
        ["different host", "https://evil.example.com/cb", false],
        ["different path", "https://admin.example.com/other", false],
        ["different scheme", "http://admin.example.com/cb", false],
        ["not a URL", "not-a-url", false]
    ] as Array<[string, string, boolean]>)("%s", (_name, uri, expected) => {
        expect(isRedirectUriAllowed(uri, ["https://admin.example.com/cb"])).toBe(expected);
    });
});

describe("POST /auth/<provider> — registration policy", () => {
    it("refuses to create an account when self-registration is disabled", async () => {
        const app = createApp({ disableSelfRegistration: true });

        const res = await signIn(app);

        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("REGISTRATION_DISABLED");
        expect(repo.createUser).not.toHaveBeenCalled();
        expect(repo.setUserRoles).not.toHaveBeenCalled();
    });

    it("refuses when registration is closed and the system already has users", async () => {
        const app = createApp({ allowRegistration: false });
        repo.listUsersPaginated.mockResolvedValue({ users: [], total: 4, limit: 1, offset: 0 });

        const res = await signIn(app);

        expect(res.status).toBe(403);
        expect(repo.createUser).not.toHaveBeenCalled();
    });

    it("admits the very first user on an empty database and promotes them to admin", async () => {
        const app = createApp({ allowRegistration: false });
        repo.listUsersPaginated.mockResolvedValue({ users: [], total: 0, limit: 1, offset: 0 });
        repo.listUsers.mockResolvedValue([mockUser({ id: "new-user" })]);

        const res = await signIn(app);

        expect(res.status).toBe(200);
        expect(repo.setUserRoles).toHaveBeenCalledWith("new-user", ["admin"]);
    });

    it("undoes the account when two sign-ups race through the empty-table check", async () => {
        const app = createApp({ allowRegistration: false });
        repo.listUsersPaginated.mockResolvedValue({ users: [], total: 0, limit: 1, offset: 0 });
        // Somebody else won the race: the table is no longer a table of one.
        repo.listUsers.mockResolvedValue([mockUser({ id: "someone-else" }), mockUser({ id: "new-user" })]);

        const res = await signIn(app);

        expect(res.status).toBe(403);
        expect(repo.deleteUser).toHaveBeenCalledWith("new-user");
        expect(repo.setUserRoles).not.toHaveBeenCalled();
    });

    it("creates the account normally when registration is open", async () => {
        const app = createApp({ allowRegistration: true });

        const res = await signIn(app);

        expect(res.status).toBe(200);
        expect(repo.createUser).toHaveBeenCalled();
    });
});

describe("POST /auth/<provider> — auto-linking onto an existing account", () => {
    it("refuses when the local account holds a password nobody ever verified", async () => {
        const app = createApp();
        repo.getUserByEmail.mockResolvedValue(mockUser({ id: "pw-user", passwordHash: "salt:hash", emailVerified: false }));

        const res = await signIn(app);

        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("EMAIL_NOT_VERIFIED");
        expect(repo.linkUserIdentity).not.toHaveBeenCalled();
        expect(repo.createUser).not.toHaveBeenCalled();
    });

    it("links when the local account's own address was verified", async () => {
        const app = createApp();
        repo.getUserByEmail.mockResolvedValue(mockUser({ id: "pw-user", passwordHash: "salt:hash", emailVerified: true }));

        const res = await signIn(app);

        expect(res.status).toBe(200);
        expect(repo.linkUserIdentity).toHaveBeenCalledWith("pw-user", "acme", "acme-1", expect.any(Object));
    });

    it("links when the local account has no password at all", async () => {
        const app = createApp();
        repo.getUserByEmail.mockResolvedValue(mockUser({ id: "oauth-user", passwordHash: null, emailVerified: false }));

        const res = await signIn(app);

        expect(res.status).toBe(200);
        expect(repo.linkUserIdentity).toHaveBeenCalledWith("oauth-user", "acme", "acme-1", expect.any(Object));
    });

    it("refuses when the provider did not verify the address", async () => {
        const app = createApp();
        providerReturns({ emailVerified: false });
        repo.getUserByEmail.mockResolvedValue(mockUser({ id: "pw-user", emailVerified: true }));

        const res = await signIn(app);

        expect(res.status).toBe(403);
        expect(repo.linkUserIdentity).not.toHaveBeenCalled();
    });
});

describe("POST /auth/<provider> — the verification result reaches the new row", () => {
    it("marks the account verified when the provider verified the address", async () => {
        const app = createApp();

        await signIn(app);

        expect(repo.createUser).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: true }));
    });

    it("leaves it unverified when the provider did not", async () => {
        const app = createApp();
        providerReturns({ emailVerified: false });

        await signIn(app);

        expect(repo.createUser).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: false }));
    });
});

describe("POST /auth/<provider> — redirect URI allowlist", () => {
    it("rejects a redirectUri outside the allowlist before the code is spent", async () => {
        const app = createApp({ allowedRedirectUris: ["https://admin.example.com/callback"] });
        const verify = jest.fn(verifyImpl);
        verifyImpl = verify as typeof verifyImpl;

        const res = await signIn(app, "https://evil.example.com/callback");

        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("REDIRECT_URI_NOT_ALLOWED");
        expect(verify).not.toHaveBeenCalled();
    });

    it("accepts a redirectUri on the allowlist", async () => {
        const app = createApp({ allowedRedirectUris: ["https://admin.example.com/callback"] });

        const res = await signIn(app, "https://admin.example.com/callback?code=abc");

        expect(res.status).toBe(200);
    });
});

describe("POST /auth/<provider> — provider errors are not echoed", () => {
    it("returns a generic 401 rather than the provider's response body", async () => {
        const app = createApp();
        verifyImpl = async () => {
            throw new Error("Acme token exchange failed (400): {\"client_id\":\"secret-looking-id\",\"hint\":\"bad redirect\"}");
        };

        const res = await signIn(app);

        expect(res.status).toBe(401);
        const body = await res.text();
        expect(body).not.toContain("secret-looking-id");
        expect(body).not.toContain("token exchange failed");
    });
});
