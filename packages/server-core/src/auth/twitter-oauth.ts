import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";
import { logger } from "../utils/logger";

/**
 * Creates a Twitter/X OAuth 2.0 Provider integration.
 *
 * Uses OAuth 2.0 with PKCE (authorization code flow). The frontend must include
 * the PKCE `code_verifier` when sending the authorization code.
 *
 * Twitter API v2 requires the "tweet.read" and "users.read" scopes at minimum,
 * plus "offline.access" if refresh tokens are needed on Twitter's side.
 */
export function createTwitterProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<{
            code: string;
            redirectUri: string;
            codeVerifier: string;
        }> {
    return {
        id: "twitter",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required"),
            codeVerifier: z.string().min(1, "PKCE code verifier is required")
        }),
        verify: async (payload: {
            code: string;
            redirectUri: string;
            codeVerifier: string;
        }): Promise<OAuthProviderProfile | null> => {
            try {
                // Twitter OAuth 2.0 uses Basic auth for the token endpoint
                const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

                // Exchange code for access token
                const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": `Basic ${basicAuth}`
                    },
                    body: new URLSearchParams({
                        code: payload.code,
                        grant_type: "authorization_code",
                        redirect_uri: payload.redirectUri,
                        code_verifier: payload.codeVerifier
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Twitter access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                // Fetch user profile from Twitter API v2
                const profileResponse = await fetch(
                    "https://api.twitter.com/2/users/me?user.fields=id,name,username,profile_image_url",
                    {
                        headers: { "Authorization": `Bearer ${accessToken}` }
                    }
                );

                if (!profileResponse.ok) {
                    logger.error("Failed to get Twitter user info", { detail: await profileResponse.text() });
                    return null;
                }

                const profileResult = await profileResponse.json() as {
                    data: {
                        id: string;
                        name: string;
                        username: string;
                        profile_image_url?: string;
                    };
                };

                const profileData = profileResult.data;

                // Twitter does NOT expose email via API v2 by default.
                // It requires elevated access. If we can't get an email, we
                // generate a placeholder email — the user can update it later.
                // For apps with elevated access, fetch from v1.1 endpoint.
                let email: string | null = null;
                try {
                    const emailResponse = await fetch(
                        "https://api.twitter.com/1.1/account/verify_credentials.json?include_email=true",
                        {
                            headers: { "Authorization": `Bearer ${accessToken}` }
                        }
                    );
                    if (emailResponse.ok) {
                        const emailData = await emailResponse.json() as { email?: string };
                        email = emailData.email || null;
                    }
                } catch {
                    // Elevated access not available — fall through
                }

                if (!email) {
                    // Construct a deterministic placeholder email from the Twitter user ID.
                    // This allows the account to be created and linked; the user should
                    // update their email through the profile settings.
                    email = `${profileData.id}@twitter.placeholder.rebase`;
                }

                return {
                    providerId: profileData.id,
                    email,
                    displayName: profileData.name || profileData.username || null,
                    photoUrl: profileData.profile_image_url?.replace("_normal", "_400x400") || null
                };
            } catch (error) {
                logger.error("Twitter OAuth error", { error: error });
                return null;
            }
        }
    };
}
