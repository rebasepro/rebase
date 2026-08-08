/**
 * OAuth providers — the controls every provider must implement.
 *
 * Written table-driven rather than one file per provider on purpose. The
 * defect this replaces was one predicate with twelve implementations: five
 * providers asserted `emailVerified: true` off a response that contained no
 * verification field at all, and the eleven providers with no test were
 * exactly the eleven that got it wrong. A per-provider suite would have grown
 * the same way. Here a thirteenth provider is a compile-time hole in
 * `PROVIDER_CASES`, and the last test in this file fails until it is filled.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { generateKeyPairSync, type KeyObject } from "crypto";
import jwt from "jsonwebtoken";

import * as authIndex from "../src/auth";
import { createAppleProvider } from "../src/auth/apple-oauth";
import { createBitbucketProvider } from "../src/auth/bitbucket-oauth";
import { createDiscordProvider } from "../src/auth/discord-oauth";
import { createFacebookProvider } from "../src/auth/facebook-oauth";
import { createGitHubProvider } from "../src/auth/github-oauth";
import { createGitLabProvider } from "../src/auth/gitlab-oauth";
import { createGoogleProvider } from "../src/auth/google-oauth";
import { createLinkedinProvider } from "../src/auth/linkedin-oauth";
import { createMicrosoftProvider } from "../src/auth/microsoft-oauth";
import { createSlackProvider } from "../src/auth/slack-oauth";
import { createSpotifyProvider } from "../src/auth/spotify-oauth";
import { createTwitterProvider } from "../src/auth/twitter-oauth";
import { resetJwksCache } from "../src/auth/oidc-id-token";
import type { OAuthProvider } from "../src/auth/interfaces";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() }
}));

// Google is the one provider whose verification runs through a third-party
// library rather than `fetch`; stand in for it so the table can cover Google
// with the same cases as everyone else.
const mockGoogle = { payload: {} as Record<string, unknown> };
jest.mock("google-auth-library/build/src/index.js", () => ({
    OAuth2Client: class {
        async verifyIdToken() {
            return { getPayload: () => mockGoogle.payload };
        }
    }
}));

// ── Signing material ────────────────────────────────────────────────────────

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const RSA_PRIVATE_PEM = rsa.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const SIGNING_KID = "test-signing-key";

const wrongRsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const WRONG_RSA_PRIVATE_PEM = wrongRsa.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const APPLE_CLIENT_SECRET_KEY = ec.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

function jwks(publicKey: KeyObject = rsa.publicKey) {
    return { keys: [{ ...publicKey.export({ format: "jwk" }), kid: SIGNING_KID, alg: "RS256", use: "sig" }] };
}

function signIdToken(claims: Record<string, unknown>, pem = RSA_PRIVATE_PEM) {
    return jwt.sign({ exp: Math.floor(Date.now() / 1000) + 600, ...claims }, pem, {
        algorithm: "RS256",
        keyid: SIGNING_KID
    });
}

// ── fetch harness ───────────────────────────────────────────────────────────

interface Route {
    /** Substring of the request URL. First match wins, so order the specific ones first. */
    match: string;
    body: unknown;
    ok?: boolean;
}

interface FetchCall {
    url: string;
    body: string;
}

let fetchCalls: FetchCall[] = [];

function installFetch(routes: Route[]) {
    fetchCalls = [];
    const impl = (async (input: unknown, init?: { body?: unknown }) => {
        const url = String(input);
        const rawBody = init?.body;
        fetchCalls.push({ url, body: rawBody === undefined ? "" : String(rawBody) });
        const route = routes.find((r) => url.includes(r.match));
        if (!route) throw new Error(`Unexpected fetch to ${url}`);
        const payload = JSON.stringify(route.body);
        return {
            ok: route.ok ?? true,
            status: route.ok === false ? 400 : 200,
            json: async () => JSON.parse(payload),
            text: async () => payload
        };
    }) as unknown as typeof fetch;
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

function tokenRequestBody(match: string): string {
    const call = fetchCalls.find((c) => c.url.includes(match));
    if (!call) throw new Error(`No request was made to ${match}`);
    return call.body;
}

// ── The table ───────────────────────────────────────────────────────────────

const EMAIL = "user@example.com";
const ATTACKER_EMAIL = "cfo@victim-corp.example";
const REDIRECT = "https://app.example.com/callback";
const MS_TENANT = "11111111-2222-3333-4444-555555555555";

interface ProviderCase {
    id: string;
    /** Name of the exported factory, so the coverage gate can compare against `../src/auth`. */
    factory: string;
    create: () => OAuthProvider<never>;
    /** Substring identifying the token endpoint, for the PKCE assertion. */
    tokenEndpoint: string;
    /** Request body accepted by this provider, minus PKCE. */
    payload: Record<string, unknown>;
    /** Responses where the provider reports NO email-verification signal. */
    unverified: Route[];
    /**
     * Responses where the provider *does* report the address as verified.
     * `null` means the provider has no verification signal to report at all
     * (Spotify and Facebook expose none), so `emailVerified` can only ever
     * be false for it.
     */
    verified: Route[] | null;
    expectedProviderId: string;
}

const PROVIDER_CASES: ProviderCase[] = [
    {
        id: "apple",
        factory: "createAppleProvider",
        create: () => createAppleProvider({
            clientId: "com.example.service",
            teamId: "TEAM123",
            keyId: "KEY123",
            privateKey: APPLE_CLIENT_SECRET_KEY
        }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "appleid.apple.com/auth/token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "auth/keys", body: jwks() },
            {
                match: "auth/token",
                body: {
                    id_token: signIdToken({
                        sub: "apple-sub-1", iss: "https://appleid.apple.com",
                        aud: "com.example.service", email: EMAIL
                    })
                }
            }
        ],
        verified: [
            { match: "auth/keys", body: jwks() },
            {
                match: "auth/token",
                body: {
                    id_token: signIdToken({
                        sub: "apple-sub-1", iss: "https://appleid.apple.com",
                        aud: "com.example.service", email: EMAIL, email_verified: "true"
                    })
                }
            }
        ],
        expectedProviderId: "apple-sub-1"
    },
    {
        id: "bitbucket",
        factory: "createBitbucketProvider",
        create: () => createBitbucketProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "bitbucket.org/site/oauth2/access_token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "site/oauth2/access_token", body: { access_token: "at" } },
            { match: "2.0/user/emails", body: { values: [{ email: EMAIL, is_primary: true, is_confirmed: false }] } },
            { match: "2.0/user", body: { uuid: "{bb-1}", display_name: "User" } }
        ],
        verified: [
            { match: "site/oauth2/access_token", body: { access_token: "at" } },
            { match: "2.0/user/emails", body: { values: [{ email: EMAIL, is_primary: true, is_confirmed: true }] } },
            { match: "2.0/user", body: { uuid: "{bb-1}", display_name: "User" } }
        ],
        expectedProviderId: "{bb-1}"
    },
    {
        id: "discord",
        factory: "createDiscordProvider",
        create: () => createDiscordProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "discord.com/api/v10/oauth2/token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "oauth2/token", body: { access_token: "at" } },
            { match: "users/@me", body: { id: "dc-1", username: "user", email: EMAIL } }
        ],
        verified: [
            { match: "oauth2/token", body: { access_token: "at" } },
            { match: "users/@me", body: { id: "dc-1", username: "user", email: EMAIL, verified: true } }
        ],
        expectedProviderId: "dc-1"
    },
    {
        id: "facebook",
        factory: "createFacebookProvider",
        create: () => createFacebookProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "graph.facebook.com/v19.0/oauth/access_token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "oauth/access_token", body: { access_token: "at" } },
            { match: "v19.0/me", body: { id: "fb-1", name: "User", email: EMAIL } }
        ],
        // Graph exposes no verification field, so there is no fixture that
        // could legitimately produce `true`.
        verified: null,
        expectedProviderId: "fb-1"
    },
    {
        id: "github",
        factory: "createGitHubProvider",
        create: () => createGitHubProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "github.com/login/oauth/access_token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "login/oauth/access_token", body: { access_token: "at" } },
            { match: "api.github.com/user/emails", body: [{ email: EMAIL, primary: true, verified: false }] },
            { match: "api.github.com/user", body: { id: 42, login: "user", email: EMAIL } }
        ],
        verified: [
            { match: "login/oauth/access_token", body: { access_token: "at" } },
            { match: "api.github.com/user/emails", body: [{ email: EMAIL, primary: true, verified: true }] },
            { match: "api.github.com/user", body: { id: 42, login: "user", email: EMAIL } }
        ],
        expectedProviderId: "42"
    },
    {
        id: "gitlab",
        factory: "createGitLabProvider",
        create: () => createGitLabProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "gitlab.com/oauth/token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "oauth/token", body: { access_token: "at" } },
            { match: "api/v4/user", body: { id: 7, username: "user", email: EMAIL } }
        ],
        verified: [
            { match: "oauth/token", body: { access_token: "at" } },
            { match: "api/v4/user", body: { id: 7, username: "user", email: EMAIL, confirmed_at: "2020-01-01T00:00:00Z" } }
        ],
        expectedProviderId: "7"
    },
    {
        id: "google",
        factory: "createGoogleProvider",
        create: () => createGoogleProvider({ clientId: "gid", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "oauth2.googleapis.com/token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "oauth2.googleapis.com/token", body: { id_token: "google-id-token" } }
        ],
        verified: [
            { match: "oauth2.googleapis.com/token", body: { id_token: "google-id-token" } }
        ],
        expectedProviderId: "goog-1"
    },
    {
        id: "linkedin",
        factory: "createLinkedinProvider",
        create: () => createLinkedinProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "linkedin.com/oauth/v2/accessToken",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "oauth/v2/accessToken", body: { access_token: "at" } },
            { match: "v2/userinfo", body: { sub: "li-1", email: EMAIL, name: "User" } }
        ],
        verified: [
            { match: "oauth/v2/accessToken", body: { access_token: "at" } },
            { match: "v2/userinfo", body: { sub: "li-1", email: EMAIL, name: "User", email_verified: true } }
        ],
        expectedProviderId: "li-1"
    },
    {
        id: "microsoft",
        factory: "createMicrosoftProvider",
        create: () => createMicrosoftProvider({ clientId: "ms-client", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "oauth2/v2.0/token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "discovery/v2.0/keys", body: jwks() },
            {
                match: "oauth2/v2.0/token",
                body: {
                    access_token: "at",
                    id_token: signIdToken({
                        sub: "ms-sub", aud: "ms-client",
                        iss: `https://login.microsoftonline.com/${MS_TENANT}/v2.0`,
                        email: EMAIL
                    })
                }
            },
            { match: "graph.microsoft.com/v1.0/me", body: { id: "ms-object-1", displayName: "User", mail: EMAIL } }
        ],
        verified: [
            { match: "discovery/v2.0/keys", body: jwks() },
            {
                match: "oauth2/v2.0/token",
                body: {
                    access_token: "at",
                    id_token: signIdToken({
                        sub: "ms-sub", aud: "ms-client",
                        iss: `https://login.microsoftonline.com/${MS_TENANT}/v2.0`,
                        email: EMAIL, xms_edov: true
                    })
                }
            },
            { match: "graph.microsoft.com/v1.0/me", body: { id: "ms-object-1", displayName: "User", mail: EMAIL } }
        ],
        expectedProviderId: "ms-object-1"
    },
    {
        id: "slack",
        factory: "createSlackProvider",
        create: () => createSlackProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "slack.com/api/openid.connect.token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "openid.connect.token", body: { ok: true, access_token: "at" } },
            { match: "openid.connect.userInfo", body: { ok: true, sub: "sl-1", email: EMAIL, name: "User" } }
        ],
        verified: [
            { match: "openid.connect.token", body: { ok: true, access_token: "at" } },
            { match: "openid.connect.userInfo", body: { ok: true, sub: "sl-1", email: EMAIL, name: "User", email_verified: true } }
        ],
        expectedProviderId: "sl-1"
    },
    {
        id: "spotify",
        factory: "createSpotifyProvider",
        create: () => createSpotifyProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "accounts.spotify.com/api/token",
        payload: { code: "c", redirectUri: REDIRECT },
        unverified: [
            { match: "accounts.spotify.com/api/token", body: { access_token: "at" } },
            { match: "api.spotify.com/v1/me", body: { id: "sp-1", display_name: "User", email: EMAIL } }
        ],
        // `/v1/me` has no verification field of any kind.
        verified: null,
        expectedProviderId: "sp-1"
    },
    {
        id: "twitter",
        factory: "createTwitterProvider",
        create: () => createTwitterProvider({ clientId: "id", clientSecret: "secret" }) as unknown as OAuthProvider<never>,
        tokenEndpoint: "api.twitter.com/2/oauth2/token",
        payload: { code: "c", redirectUri: REDIRECT, codeVerifier: "pkce-verifier" },
        unverified: [
            { match: "2/oauth2/token", body: { access_token: "at" } },
            { match: "2/users/me", body: { data: { id: "tw-1", name: "User", username: "user" } } },
            { match: "1.1/account/verify_credentials", body: {}, ok: false }
        ],
        verified: [
            { match: "2/oauth2/token", body: { access_token: "at" } },
            { match: "2/users/me", body: { data: { id: "tw-1", name: "User", username: "user" } } },
            { match: "1.1/account/verify_credentials", body: { email: EMAIL } }
        ],
        expectedProviderId: "tw-1"
    }
];

/** Google's identity comes from the mocked library, not from `fetch`. */
function primeGoogle(emailVerified: boolean) {
    mockGoogle.payload = { sub: "goog-1", email: EMAIL, name: "User", email_verified: emailVerified };
}

async function runVerify(providerCase: ProviderCase, routes: Route[], payload = providerCase.payload) {
    installFetch(routes);
    const provider = providerCase.create();
    const parsed = provider.schema.parse(payload) as never;
    return provider.verify(parsed);
}

beforeEach(() => {
    resetJwksCache();
    primeGoogle(false);
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════

describe("OAuth providers — emailVerified is a report, never an assertion", () => {
    it.each(PROVIDER_CASES.map((c) => [c.id, c] as const))(
        "%s never reports emailVerified: true when the provider response carries no verification signal",
        async (_id, providerCase) => {
            if (providerCase.id === "google") primeGoogle(false);
            const profile = await runVerify(providerCase, providerCase.unverified);
            // Refusing the sign-in outright is also acceptable — Bitbucket
            // does, because it has no address to fall back to once the
            // confirmed ones are filtered out. What is never acceptable is a
            // `true`. The companion test below stops a provider passing this
            // one by hardcoding `false`.
            expect(profile?.emailVerified ?? false).toBe(false);
        }
    );

    it.each(PROVIDER_CASES.filter((c) => c.verified).map((c) => [c.id, c] as const))(
        "%s reports emailVerified: true when — and only when — the response says so",
        async (_id, providerCase) => {
            if (providerCase.id === "google") primeGoogle(true);
            const profile = await runVerify(providerCase, providerCase.verified!);
            expect(profile).not.toBeNull();
            expect(profile!.emailVerified).toBe(true);
        }
    );

    it.each(PROVIDER_CASES.map((c) => [c.id, c] as const))(
        "%s keys the identity on the provider's own stable id",
        async (_id, providerCase) => {
            if (providerCase.id === "google") primeGoogle(true);
            const profile = await runVerify(providerCase, providerCase.verified ?? providerCase.unverified);
            expect(profile!.providerId).toBe(providerCase.expectedProviderId);
        }
    );
});

describe("OAuth providers — the identity email never comes from the request body", () => {
    it.each(PROVIDER_CASES.map((c) => [c.id, c] as const))(
        "%s ignores an email planted in the payload",
        async (_id, providerCase) => {
            if (providerCase.id === "google") primeGoogle(true);
            // Every field an attacker could try. Apple was the one provider
            // that read `user.email`, and only when the id_token's `email`
            // claim was absent — which the attacker controls by omitting the
            // `email` scope from their own authorization request.
            const routes = providerCase.id === "apple"
                ? [
                    { match: "auth/keys", body: jwks() },
                    {
                        match: "auth/token",
                        body: {
                            id_token: signIdToken({
                                sub: "apple-sub-1", iss: "https://appleid.apple.com",
                                aud: "com.example.service"
                                // no `email` claim — the scope was omitted
                            })
                        }
                    }
                ]
                : providerCase.unverified;

            const profile = await runVerify(providerCase, routes, {
                ...providerCase.payload,
                email: ATTACKER_EMAIL,
                user: { email: ATTACKER_EMAIL, name: { firstName: "Mal" } }
            });

            if (profile) {
                expect(profile.email).not.toBe(ATTACKER_EMAIL);
            }
        }
    );
});

describe("OAuth providers — shared request schema", () => {
    it.each(PROVIDER_CASES.map((c) => [c.id, c] as const))(
        "%s rejects a request with neither code nor redirectUri",
        (_id, providerCase) => {
            expect(providerCase.create().schema.safeParse({}).success).toBe(false);
        }
    );

    it.each(PROVIDER_CASES.map((c) => [c.id, c] as const))(
        "%s forwards the PKCE code_verifier to the token endpoint",
        async (_id, providerCase) => {
            if (providerCase.id === "google") primeGoogle(true);
            await runVerify(providerCase, providerCase.verified ?? providerCase.unverified, {
                ...providerCase.payload,
                codeVerifier: "pkce-verifier"
            });
            expect(tokenRequestBody(providerCase.tokenEndpoint)).toContain("pkce-verifier");
        }
    );

    it("requires PKCE on Twitter, which mandates it", () => {
        const twitter = PROVIDER_CASES.find((c) => c.id === "twitter")!.create();
        expect(twitter.schema.safeParse({ code: "c", redirectUri: REDIRECT }).success).toBe(false);
        expect(twitter.schema.safeParse({ code: "c", redirectUri: REDIRECT, codeVerifier: "v" }).success).toBe(true);
    });
});

describe("OIDC providers — the id_token is verified, not decoded", () => {
    it("Apple rejects an id_token signed by a key that is not Apple's", async () => {
        const providerCase = PROVIDER_CASES.find((c) => c.id === "apple")!;
        const profile = await runVerify(providerCase, [
            { match: "auth/keys", body: jwks() },
            {
                match: "auth/token",
                body: {
                    id_token: signIdToken({
                        sub: "apple-sub-1", iss: "https://appleid.apple.com",
                        aud: "com.example.service", email: EMAIL, email_verified: true
                    }, WRONG_RSA_PRIVATE_PEM)
                }
            }
        ]);
        expect(profile).toBeNull();
    });

    it("Apple rejects an id_token minted for a different Services ID (aud mismatch)", async () => {
        const providerCase = PROVIDER_CASES.find((c) => c.id === "apple")!;
        const profile = await runVerify(providerCase, [
            { match: "auth/keys", body: jwks() },
            {
                match: "auth/token",
                body: {
                    id_token: signIdToken({
                        sub: "apple-sub-1", iss: "https://appleid.apple.com",
                        aud: "com.other.service", email: EMAIL, email_verified: true
                    })
                }
            }
        ]);
        expect(profile).toBeNull();
    });

    it("Apple rejects an expired id_token", async () => {
        const providerCase = PROVIDER_CASES.find((c) => c.id === "apple")!;
        const profile = await runVerify(providerCase, [
            { match: "auth/keys", body: jwks() },
            {
                match: "auth/token",
                body: {
                    id_token: signIdToken({
                        sub: "apple-sub-1", iss: "https://appleid.apple.com",
                        aud: "com.example.service", email: EMAIL, email_verified: true,
                        exp: Math.floor(Date.now() / 1000) - 3600
                    })
                }
            }
        ]);
        expect(profile).toBeNull();
    });

    it("Microsoft rejects an id_token from an issuer that is not an Entra tenant", async () => {
        const providerCase = PROVIDER_CASES.find((c) => c.id === "microsoft")!;
        const profile = await runVerify(providerCase, [
            { match: "discovery/v2.0/keys", body: jwks() },
            {
                match: "oauth2/v2.0/token",
                body: {
                    access_token: "at",
                    id_token: signIdToken({
                        sub: "ms-sub", aud: "ms-client",
                        iss: "https://login.evil.example/v2.0", email: EMAIL, xms_edov: true
                    })
                }
            },
            { match: "graph.microsoft.com/v1.0/me", body: { id: "ms-object-1", mail: EMAIL } }
        ]);
        expect(profile).toBeNull();
    });

    it("Microsoft does not carry xms_edov over to a Graph address the id_token never claimed", async () => {
        // The attack the old `Boolean(profile.mail)` allowed: a free tenant
        // whose administrator sets `mail` to a victim's address.
        const providerCase = PROVIDER_CASES.find((c) => c.id === "microsoft")!;
        const profile = await runVerify(providerCase, [
            { match: "discovery/v2.0/keys", body: jwks() },
            {
                match: "oauth2/v2.0/token",
                body: {
                    access_token: "at",
                    id_token: signIdToken({
                        sub: "ms-sub", aud: "ms-client",
                        iss: `https://login.microsoftonline.com/${MS_TENANT}/v2.0`,
                        email: "attacker@own-tenant.example", xms_edov: true
                    })
                }
            },
            { match: "graph.microsoft.com/v1.0/me", body: { id: "ms-object-1", mail: ATTACKER_EMAIL } }
        ]);
        expect(profile).not.toBeNull();
        expect(profile!.email).toBe(ATTACKER_EMAIL);
        expect(profile!.emailVerified).toBe(false);
    });
});

describe("OAuth provider coverage gate", () => {
    it("every create*Provider exported from src/auth is in the table above", () => {
        const exported = Object.keys(authIndex)
            .filter((name) => /^create.*Provider$/.test(name))
            .sort();
        const covered = PROVIDER_CASES.map((c) => c.factory).sort();
        expect(covered).toEqual(exported);
    });
});
