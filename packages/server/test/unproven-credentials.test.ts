/**
 * A credential nobody proved does not survive the owner proving the address.
 *
 * Registration does not verify the address it is given, and neither does a
 * sign-in through a provider that does not vouch for it (Spotify and Facebook
 * never do; Discord and multi-tenant Microsoft sometimes do not). So anyone
 * can make an account for someone else's address, and then wait:
 *
 *  - **OAuth.** The attacker signs in with Spotify as `victim@corp.com`, which
 *    makes a password-less, unverified account. When the victim later signs in
 *    with Google, which does vouch for the address, the account was
 *    auto-linked because it had no password — and the attacker's Spotify
 *    identity went on signing in to the same account.
 *  - **Magic link and email code.** The attacker registers the victim's address
 *    with a password. When the victim signs in by a link or a code from their
 *    inbox, the account was marked verified and the attacker's password went on
 *    working.
 *
 * Both halves are held here, against a store that keeps state, so each case is
 * the attacker's sign-in after the victim's rather than a flag on a row.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { OAuthProviderProfile } from "../src/auth/interfaces";
import { hashToken } from "../src/auth/admin-user-ops";
import { otpTokenMaterial } from "../src/auth/otp-routes";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { MemoryAuthStore, type MemoryAuthStoreOptions } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const VICTIM = "victim@corp.com";
const ATTACKER_PASSWORD = "Att4cker-Passw0rd";
const OWNER_PASSWORD = "Own3r-Chosen-Passw0rd";
const CALLBACK = "https://app.example.com/callback";

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

/**
 * Spotify never vouches for an address; Google vouches for the victim's;
 * GitHub vouches for the attacker's own, which is a different address.
 */
const PROFILES: Record<string, OAuthProviderProfile> = {
    spotify: { providerId: "attacker-spotify", email: VICTIM, emailVerified: false },
    google: { providerId: "victim-google", email: VICTIM, emailVerified: true },
    github: { providerId: "attacker-github", email: "attacker@evil.example", emailVerified: true }
};

beforeAll(() => configureJwt({ secret: "unproven-credentials-secret-at-least-32-chars", accessExpiresIn: "1h" }));

interface Session {
    status: number;
    uid?: string;
    accessToken?: string;
    refreshToken?: string;
    code?: string;
    reason?: string;
}

function world(options: MemoryAuthStoreOptions = {}) {
    const store = new MemoryAuthStore(options);
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: HOOKS,
        allowRegistration: true,
        enableMagicLink: true,
        enableEmailOtp: true,
        oauthProviders: Object.keys(PROFILES).map(id => ({
            id,
            schema: oauthCodeFlowSchema(),
            verify: async () => PROFILES[id]
        }))
    }));
    app.route("/admin", createAdminUsersRoute({ authRepo: store.repo(), authHooks: HOOKS }));

    async function call(path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Session> {
        const res = await app.request(path, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const json = await res.json() as {
            user?: { uid: string };
            tokens?: { accessToken: string; refreshToken: string };
            error?: { code: string; details?: { reason?: string } };
        };
        return {
            status: res.status,
            uid: json.user?.uid,
            accessToken: json.tokens?.accessToken,
            refreshToken: json.tokens?.refreshToken,
            code: json.error?.code,
            reason: json.error?.details?.reason
        };
    }

    return {
        store,
        oauth: (provider: string) => call(`/auth/${provider}`, { code: "c", redirectUri: CALLBACK }),
        register: (password: string) => call("/auth/register", { email: VICTIM, password }),
        login: (password: string) => call("/auth/login", { email: VICTIM, password }),
        refresh: (refreshToken: string) => call("/auth/refresh", { refreshToken }),
        linkProvider: (provider: string, accessToken: string) =>
            call(`/auth/link/${provider}`, { code: "c", redirectUri: CALLBACK }, { Authorization: `Bearer ${accessToken}` }),
        /** The owner follows a link that was mailed to the address. */
        magicLink: async (uid: string) => {
            await store.repo().createMagicLinkToken(uid, hashToken("mailed-link"), new Date(Date.now() + 60_000));
            return call("/auth/magic-link/verify", { token: "mailed-link" });
        },
        /** The owner types a code that was mailed to the address. */
        emailCode: async (uid: string) => {
            await store.repo().createMagicLinkToken(uid, hashToken(otpTokenMaterial(VICTIM, "424242")), new Date(Date.now() + 60_000));
            return call("/auth/otp/verify", { email: VICTIM, code: "424242" });
        },
        /** The owner follows a reset link that was mailed to the address. */
        resetPassword: async (uid: string, password: string) => {
            await store.repo().createPasswordResetToken(uid, hashToken("mailed-reset"), new Date(Date.now() + 60_000));
            return call("/auth/reset-password", { token: "mailed-reset", password });
        },
        me: async (accessToken: string) => (await app.request("/auth/me", { headers: { Authorization: `Bearer ${accessToken}` } })).status,
        asAdmin: async (path: string, body: Record<string, unknown>) => {
            const admin = await store.repo().createUser({ email: "admin@corp.com", emailVerified: true });
            await store.repo().setUserRoles(admin.id, ["admin"]);
            return call(path, body, { Authorization: `Bearer ${await generateAccessToken(admin.id, ["admin"])}` });
        }
    };
}

/**
 * Mint the attacker's tokens with the clock a minute back, so they predate the
 * revocation mark the owner's proof sets by more than `iat`'s one-second grain.
 */
async function aMinuteAgo<T>(act: () => Promise<T>): Promise<T> {
    const clock = jest.spyOn(Date, "now").mockReturnValue(Date.now() - 60_000);
    try {
        return await act();
    } finally {
        clock.mockRestore();
    }
}

describe("OAuth sign-in does not auto-link onto an account whose address nobody proved", () => {
    it("refuses Google onto the account the attacker made through Spotify", async () => {
        const w = world();
        const attacker = await w.oauth("spotify");
        expect(attacker.status).toBe(200);

        const victim = await w.oauth("google");

        expect(victim.status).toBe(403);
        expect(victim.code).toBe("EMAIL_NOT_VERIFIED");
        // Not "sign in with your password": this account has none.
        expect(victim.reason).toBe("local-account-unverified-passwordless");
        expect(w.store.providersOf(attacker.uid!)).toEqual(["spotify"]);
    });

    it("still links Google onto an account whose address was proven", async () => {
        const w = world();
        const owner = await w.register(OWNER_PASSWORD);
        await w.magicLink(owner.uid!);

        const google = await w.oauth("google");

        expect(google.status).toBe(200);
        expect(google.uid).toBe(owner.uid);
    });
});

describe.each([
    ["a magic link", "magicLink"],
    ["an email code", "emailCode"]
] as const)("signing in by %s proves the address", (_how, door) => {
    it("and the password the attacker registered with stops working", async () => {
        const w = world();
        const attacker = await aMinuteAgo(() => w.register(ATTACKER_PASSWORD));

        const owner = await w[door](attacker.uid!);

        expect(owner.status).toBe(200);
        expect(owner.uid).toBe(attacker.uid);
        expect(w.store.users.get(owner.uid!)?.emailVerified).toBe(true);
        expect((await w.login(ATTACKER_PASSWORD)).status).toBe(401);
        // And the session the attacker registered into is over.
        expect((await w.refresh(attacker.refreshToken!)).status).toBe(401);
        expect(await w.me(attacker.accessToken!)).toBe(401);
        // The owner's own session is the one that works.
        expect(await w.me(owner.accessToken!)).toBe(200);
    });

    it("and the identity the attacker signed up with is detached", async () => {
        const w = world();
        const attacker = await aMinuteAgo(() => w.oauth("spotify"));

        const owner = await w[door](attacker.uid!);

        expect(owner.status).toBe(200);
        expect(w.store.providersOf(owner.uid!)).toEqual([]);
        expect((await w.refresh(attacker.refreshToken!)).status).toBe(401);
        // Spotify again: no longer the owner's account. Spotify does not vouch
        // for the address, so it is not linked back either.
        const again = await w.oauth("spotify");
        expect(again.status).toBe(403);
        expect(again.uid).toBeUndefined();
        // Google, which does vouch for it, now links.
        const google = await w.oauth("google");
        expect(google.status).toBe(200);
        expect(google.uid).toBe(owner.uid);
    });
});

describe("a password reset proves the address too", () => {
    it("detaches the attacker's identity and verifies the account", async () => {
        const w = world();
        const attacker = await aMinuteAgo(() => w.oauth("spotify"));

        const reset = await w.resetPassword(attacker.uid!, OWNER_PASSWORD);

        expect(reset.status).toBe(200);
        expect(w.store.providersOf(attacker.uid!)).toEqual([]);
        expect(w.store.users.get(attacker.uid!)?.emailVerified).toBe(true);
        expect((await w.refresh(attacker.refreshToken!)).status).toBe(401);
        expect((await w.login(OWNER_PASSWORD)).status).toBe(200);
        expect((await w.oauth("spotify")).status).toBe(403);
    });
});

describe("what the proof keeps", () => {
    it("keeps an identity whose provider vouched for this same address", async () => {
        // Only someone who controls the inbox can hold a Google account that
        // vouches for it, so that identity was never the attacker's.
        const w = world();
        const owner = await w.register(OWNER_PASSWORD);
        expect((await w.linkProvider("google", owner.accessToken!)).status).toBe(200);

        expect((await w.magicLink(owner.uid!)).status).toBe(200);

        expect(w.store.providersOf(owner.uid!)).toEqual(["google"]);
    });

    it("detaches an identity that vouched for a different address", async () => {
        // The attacker registered the victim's address, then linked their own
        // GitHub account from the session registration gave them. GitHub did
        // vouch — for the attacker's address, which proves nothing here.
        const w = world();
        const attacker = await w.register(ATTACKER_PASSWORD);
        expect((await w.linkProvider("github", attacker.accessToken!)).status).toBe(200);

        expect((await w.magicLink(attacker.uid!)).status).toBe(200);

        expect(w.store.providersOf(attacker.uid!)).toEqual([]);
        expect((await w.oauth("github")).uid).not.toBe(attacker.uid);
    });

    it("changes nothing on an account whose address was already proven", async () => {
        const w = world();
        const owner = await w.register(OWNER_PASSWORD);
        await w.store.repo().setEmailVerified(owner.uid!, true);

        expect((await w.magicLink(owner.uid!)).status).toBe(200);

        expect((await w.login(OWNER_PASSWORD)).status).toBe(200);
        expect((await w.refresh(owner.refreshToken!)).status).toBe(200);
    });
});

describe("a store that cannot detach an identity", () => {
    it("refuses the proof rather than leave the attacker's identity on the account", async () => {
        const w = world({ unlinkIdentities: false });
        const attacker = await w.oauth("spotify");

        const owner = await w.magicLink(attacker.uid!);

        expect(owner.status).toBe(409);
        expect(owner.code).toBe("UNVERIFIED_IDENTITIES");
        expect(owner.accessToken).toBeUndefined();
        expect(w.store.users.get(attacker.uid!)?.emailVerified).toBe(false);
        expect(w.store.providersOf(attacker.uid!)).toEqual(["spotify"]);
    });

    it("still takes the proof when there is no identity to detach", async () => {
        const w = world({ unlinkIdentities: false });
        await w.register(ATTACKER_PASSWORD);
        const account = await w.store.repo().getUserByEmail(VICTIM);

        const owner = await w.magicLink(account!.id);

        expect(owner.status).toBe(200);
        expect((await w.login(ATTACKER_PASSWORD)).status).toBe(401);
    });
});

describe("an account an administrator created", () => {
    it("is verified, so its invitee can sign in with a provider that vouches for the address", async () => {
        const w = world();
        const created = await w.asAdmin("/admin/users", { email: VICTIM });
        expect(created.status).toBe(201);
        const invited = await w.store.repo().getUserByEmail(VICTIM);
        expect(invited?.emailVerified).toBe(true);

        const google = await w.oauth("google");

        expect(google.status).toBe(200);
        expect(google.uid).toBe(invited!.id);
    });
});
