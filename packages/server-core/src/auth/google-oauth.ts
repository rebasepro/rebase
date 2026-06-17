import { OAuth2Client } from "google-auth-library/build/src/index.js";
import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

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
}> {
    const clientId = typeof config === "string" ? config : config.clientId;
    const clientSecret = typeof config === "string" ? undefined : config.clientSecret;
    const googleClient = new OAuth2Client(clientId, clientSecret);

    return {
        id: "google",
        schema: z.object({
            idToken: z.string().min(1).optional(),
            accessToken: z.string().min(1).optional(),
            code: z.string().min(1).optional(),
            redirectUri: z.string().min(1).optional()
        }).refine(
            (data) => data.idToken || data.accessToken || (data.code && data.redirectUri),
            { message: "One of idToken, accessToken, or code+redirectUri is required" }
        ),
        verify: async (payload: {
            idToken?: string;
            accessToken?: string;
            code?: string;
            redirectUri?: string;
        }): Promise<OAuthProviderProfile | null> => {
            try {
                // Path 1: verify an ID token (One Tap / renderButton)
                if (payload.idToken) {
                    const ticket = await googleClient.verifyIdToken({
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
                        emailVerified: true
                    };
                }

                // Path 2: verify an access token via Google's userinfo endpoint
                if (payload.accessToken) {
                    const res = await fetch(
                        "https://www.googleapis.com/oauth2/v3/userinfo",
                        { headers: { Authorization: `Bearer ${payload.accessToken}` } }
                    );
                    if (!res.ok) {
                        throw new Error(`Google userinfo request failed with status ${res.status}`);
                    }
                    const info = await res.json() as {
                        sub: string;
                        email?: string;
                        name?: string;
                        picture?: string;
                    };
                    if (!info.sub || !info.email) {
                        throw new Error("Google userinfo response missing sub or email");
                    }
                    return {
                        providerId: info.sub,
                        email: info.email,
                        displayName: info.name || null,
                        photoUrl: info.picture || null,
                        emailVerified: true
                    };
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
                            grant_type: "authorization_code"
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
                        const ticket = await googleClient.verifyIdToken({
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
                            emailVerified: true
                        };
                    }

                    // Fallback: use the access token to fetch userinfo
                    if (tokenData.access_token) {
                        const userInfoRes = await fetch(
                            "https://www.googleapis.com/oauth2/v3/userinfo",
                            { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
                        );
                        if (!userInfoRes.ok) {
                            throw new Error(`Google userinfo request failed after code exchange (${userInfoRes.status})`);
                        }
                        const info = await userInfoRes.json() as {
                            sub: string;
                            email?: string;
                            name?: string;
                            picture?: string;
                        };
                        if (!info.sub || !info.email) {
                            return null;
                        }
                        return {
                            providerId: info.sub,
                            email: info.email,
                            displayName: info.name || null,
                            photoUrl: info.picture || null,
                            emailVerified: true
                        };
                    }

                    throw new Error("Google token exchange returned neither id_token nor access_token");
                }

                throw new Error("No valid Google credential provided (expected idToken, accessToken, or code+redirectUri)");
            } catch (error) {
                console.error("Google OAuth verification failed:", error);
                throw error;
            }
        }
    };
}
