import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { createGoogleProvider } from "../src/auth/google-oauth";

const CLIENT_ID = "my-app.apps.googleusercontent.com";
const ATTACKER_CLIENT_ID = "attacker-app.apps.googleusercontent.com";

/**
 * Mocks `fetch` so the tokeninfo/userinfo calls made by the access-token path
 * return controlled bodies. Keyed by a substring of the request URL.
 */
function mockFetch(handlers: { tokeninfo?: unknown; userinfo?: unknown; tokeninfoOk?: boolean }) {
    const impl = (async (input: unknown) => {
        const url = String(input);
        if (url.includes("tokeninfo")) {
            return {
                ok: handlers.tokeninfoOk ?? true,
                status: handlers.tokeninfoOk === false ? 400 : 200,
                json: async () => handlers.tokeninfo ?? {}
            };
        }
        if (url.includes("userinfo")) {
            return { ok: true, status: 200, json: async () => handlers.userinfo ?? {} };
        }
        throw new Error(`Unexpected fetch to ${url}`);
    }) as unknown as typeof fetch;
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

describe("Google OAuth — access token audience verification", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an access token issued for a different OAuth client (aud mismatch)", async () => {
        const provider = createGoogleProvider({ clientId: CLIENT_ID });
        // A token an attacker obtained for THEIR client, resolving to a victim.
        mockFetch({
            tokeninfo: {
                aud: ATTACKER_CLIENT_ID,
                sub: "victim-google-id",
                email: "victim@example.com",
                email_verified: "true"
            },
            userinfo: { name: "Victim", picture: "https://x/y.png" }
        });

        await expect(provider.verify({ accessToken: "attacker-token" }))
            .rejects.toThrow(/audience mismatch/i);
    });

    it("accepts an access token whose aud matches our clientId", async () => {
        const provider = createGoogleProvider({ clientId: CLIENT_ID });
        mockFetch({
            tokeninfo: {
                aud: CLIENT_ID,
                sub: "google-123",
                email: "user@example.com",
                email_verified: "true"
            },
            userinfo: { name: "Real User", picture: "https://x/y.png" }
        });

        const profile = await provider.verify({ accessToken: "valid-token" });
        expect(profile).toMatchObject({
            providerId: "google-123",
            email: "user@example.com",
            displayName: "Real User",
            emailVerified: true
        });
    });

    it("reports emailVerified: false when the token's email is unverified", async () => {
        const provider = createGoogleProvider({ clientId: CLIENT_ID });
        mockFetch({
            tokeninfo: {
                aud: CLIENT_ID,
                sub: "google-123",
                email: "user@example.com",
                email_verified: "false"
            },
            userinfo: {}
        });

        const profile = await provider.verify({ accessToken: "valid-token" });
        expect(profile?.emailVerified).toBe(false);
    });

    it("rejects when tokeninfo omits sub or email (missing scopes)", async () => {
        const provider = createGoogleProvider({ clientId: CLIENT_ID });
        mockFetch({ tokeninfo: { aud: CLIENT_ID } });

        await expect(provider.verify({ accessToken: "scopeless-token" }))
            .rejects.toThrow(/sub or email/i);
    });

    it("rejects when the tokeninfo endpoint returns an error", async () => {
        const provider = createGoogleProvider({ clientId: CLIENT_ID });
        mockFetch({ tokeninfoOk: false });

        await expect(provider.verify({ accessToken: "bad-token" }))
            .rejects.toThrow(/tokeninfo request failed/i);
    });
});
