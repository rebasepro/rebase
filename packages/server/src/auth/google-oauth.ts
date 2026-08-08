import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";
import { logger } from "../utils/logger";
import { pkceTokenParams, providerVerifiedEmail } from "./oauth-code-flow";

let _googleAuth: typeof import("google-auth-library/build/src/index.js") | undefined;

async function loadGoogleAuth() {
    if (!_googleAuth) {
        try {
            _googleAuth = await import("google-auth-library/build/src/index.js");
        } catch {
            throw new Error(
                "google-auth-library is required for Google OAuth. " +
                "Install it: pnpm add google-auth-library"
            );
        }
    }
    return _googleAuth;
}

/**
 * Verify a Google **access token** and resolve it to a profile.
 *
 * SECURITY: an access token must be checked against Google's `tokeninfo`
 * endpoint so we can confirm its `aud` (the OAuth client the token was issued
 * to) matches *our* `clientId`. The `userinfo` endpoint does **not** verify
 * audience — it returns a profile for any valid Google access token — so
 * trusting it alone lets an attacker present a token they obtained for a
 * *different* client (e.g. their own app, via a phished consent) and log in as
 * whatever account that token belongs to. The `aud` check is what binds the
 * token to this application.
 *
 * Identity (`sub` / `email` / `email_verified`) is taken from the
 * audience-checked `tokeninfo` response. `userinfo` is used only, best-effort,
 * to enrich display fields (name, picture).
 */
async function verifyGoogleAccessToken(
    accessToken: string,
    expectedClientId: string
): Promise<OAuthProviderProfile> {
    const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!tokenInfoRes.ok) {
        throw new Error(`Google tokeninfo request failed with status ${tokenInfoRes.status}`);
    }
    const tokenInfo = await tokenInfoRes.json() as {
        aud?: string;
        sub?: string;
        email?: string;
        // The legacy tokeninfo endpoint returns this as the string "true"/"false".
        email_verified?: string | boolean;
    };

    if (tokenInfo.aud !== expectedClientId) {
        throw new Error(
            "Google access token audience mismatch: the token was not issued for this application"
        );
    }
    if (!tokenInfo.sub || !tokenInfo.email) {
        throw new Error("Google access token missing sub or email (the email scope is required)");
    }

    const emailVerified = providerVerifiedEmail(tokenInfo.email_verified);

    let displayName: string | null = null;
    let photoUrl: string | null = null;
    try {
        const res = await fetch(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (res.ok) {
            const info = await res.json() as { name?: string; picture?: string };
            displayName = info.name || null;
            photoUrl = info.picture || null;
        }
    } catch {
        // Non-fatal: identity is already established from tokeninfo.
    }

    return {
        providerId: tokenInfo.sub,
        email: tokenInfo.email,
        displayName,
        photoUrl,
        emailVerified
    };
}

export interface GoogleUserInfo {
    googleId: string;
    email: string;
    displayName: string | null;
    photoUrl: string | null;
    emailVerified: boolean;
}

export interface GoogleProviderConfig {
    clientId: string;
    /**
     * The OAuth 2.0 client secret from Google Cloud Console.
     *
     * Required for the **authorization code flow** (Path 3), where the
     * frontend sends an authorization `code` and the backend exchanges it
     * server-side for tokens. This is the most secure flow because tokens
     * never touch the browser.
     *
     * When omitted, only ID-token and access-token verification are available
     * (Paths 1 & 2), which rely on the frontend obtaining tokens directly.
     */
    clientSecret?: string;
}

/**
 * Creates a Google OAuth Provider integration.
 *
 * Supports three verification paths:
 *
 * **Path 1 – ID Token** (One Tap / Sign In With Google button):
 *   Frontend sends `idToken`. Backend verifies cryptographically using
 *   Google's public keys. No secret required.
 *
 * **Path 2 – Access Token** (popup via `initTokenClient`):
 *   Frontend sends `accessToken`. Backend validates by calling Google's
 *   userinfo endpoint. No secret required.
 *
 * **Path 3 – Authorization Code** (most secure, requires `clientSecret`):
 *   Frontend sends `code` + `redirectUri`. Backend exchanges the code
 *   server-side for an ID token using `clientId` + `clientSecret`, then
 *   verifies the ID token. Tokens never touch the browser.
 */
export function createGoogleProvider(config: GoogleProviderConfig | string): OAuthProvider<{
    idToken?: string;
    accessToken?: string;
    code?: string;
    redirectUri?: string;
    codeVerifier?: string;
}> {
    const clientId = typeof config === "string" ? config : config.clientId;
    const clientSecret = typeof config === "string" ? undefined : config.clientSecret;

    // The admin panel's login button uses the authorization-code flow, which
    // needs the secret. Without it the provider still advertises itself, the
    // button still renders, and the failure only surfaces when someone clicks
    // it — so say it at boot instead.
    if (!clientSecret) {
        console.warn(
            "[Rebase] Google provider configured without a client secret. ID-token and access-token "
            + "sign-in still work, but the authorization-code flow used by the admin login button will "
            + "fail. Set GOOGLE_CLIENT_SECRET to enable it."
        );
    }
    let googleClient: InstanceType<typeof import("google-auth-library/build/src/index.js").OAuth2Client> | undefined;

    async function getClient() {
        if (!googleClient) {
            const { OAuth2Client } = await loadGoogleAuth();
            googleClient = new OAuth2Client(clientId, clientSecret);
        }
        return googleClient;
    }

    return {
        id: "google",
        schema: z.object({
            idToken: z.string().min(1).optional(),
            accessToken: z.string().min(1).optional(),
            code: z.string().min(1).optional(),
            redirectUri: z.string().min(1).optional(),
            codeVerifier: z.string().min(1).optional()
        }).refine(
            (data) => data.idToken || data.accessToken || (data.code && data.redirectUri),
            { message: "One of idToken, accessToken, or code+redirectUri is required" }
        ),
        verify: async (payload: {
            idToken?: string;
            accessToken?: string;
            code?: string;
            redirectUri?: string;
            codeVerifier?: string;
        }): Promise<OAuthProviderProfile | null> => {
            try {
                // Path 1: verify an ID token (One Tap / renderButton)
                if (payload.idToken) {
                    const client = await getClient();
                    const ticket = await client.verifyIdToken({
                        idToken: payload.idToken,
                        audience: clientId
                    });

                    const content = ticket.getPayload();
                    if (!content) {
                        throw new Error("Google ID token payload was empty");
                    }

                    return {
                        providerId: content.sub,
                        email: content.email || "",
                        displayName: content.name || null,
                        photoUrl: content.picture || null,
                        emailVerified: providerVerifiedEmail(content.email_verified)
                    };
                }

                // Path 2: verify a client-supplied access token. This validates
                // the token's audience against our clientId — see
                // verifyGoogleAccessToken — before trusting the identity.
                if (payload.accessToken) {
                    return await verifyGoogleAccessToken(payload.accessToken, clientId);
                }

                // Path 3: authorization code exchange (most secure)
                // The frontend obtained a one-time authorization code via the
                // Google OAuth consent screen. We exchange it server-side for
                // tokens, so the access/id tokens never touch the browser.
                if (payload.code && payload.redirectUri) {
                    if (!clientSecret) {
                        throw new Error(
                            "Google authorization code flow requires clientSecret. " +
                            "Configure GOOGLE_CLIENT_SECRET in your environment."
                        );
                    }

                    // Exchange the authorization code for tokens
                    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: new URLSearchParams({
                            code: payload.code,
                            client_id: clientId,
                            client_secret: clientSecret,
                            redirect_uri: payload.redirectUri,
                            grant_type: "authorization_code",
                            ...pkceTokenParams(payload.codeVerifier)
                        })
                    });

                    if (!tokenResponse.ok) {
                        const errorBody = await tokenResponse.text();
                        throw new Error(`Google token exchange failed (${tokenResponse.status}): ${errorBody}`);
                    }

                    const tokenData = await tokenResponse.json() as {
                        id_token?: string;
                        access_token?: string;
                        error?: string;
                        error_description?: string;
                    };

                    if (tokenData.error) {
                        throw new Error(`Google token exchange error: ${tokenData.error} – ${tokenData.error_description || "no details"}`);
                    }

                    // Prefer verifying the ID token (cryptographic verification)
                    if (tokenData.id_token) {
                        const client = await getClient();
                        const ticket = await client.verifyIdToken({
                            idToken: tokenData.id_token,
                            audience: clientId
                        });

                        const content = ticket.getPayload();
                        if (!content) {
                            throw new Error("Google ID token payload was empty after code exchange");
                        }

                        return {
                            providerId: content.sub,
                            email: content.email || "",
                            displayName: content.name || null,
                            photoUrl: content.picture || null,
                            emailVerified: providerVerifiedEmail(content.email_verified)
                        };
                    }

                    // Fallback: use the access token from our own confidential
                    // exchange. Its audience is necessarily our clientId, so the
                    // check in verifyGoogleAccessToken passes — we route through
                    // it anyway for a single trusted identity path.
                    if (tokenData.access_token) {
                        return await verifyGoogleAccessToken(tokenData.access_token, clientId);
                    }

                    throw new Error("Google token exchange returned neither id_token nor access_token");
                }

                throw new Error("No valid Google credential provided (expected idToken, accessToken, or code+redirectUri)");
            } catch (error) {
                logger.error("Google OAuth verification failed", { error: error });
                throw error;
            }
        }
    };
}
