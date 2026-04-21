import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

export interface LinkedinUserInfo {
    linkedinId: string;
    email: string;
    displayName: string | null;
    photoUrl: string | null;
    emailVerified: boolean;
}

/**
 * Creates a LinkedIn OAuth Provider integration
 */
export function createLinkedinProvider(config: { clientId: string, clientSecret: string }): OAuthProvider {
    return {
        id: "linkedin",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
            try {
                // Exchange code for access token
                const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: payload.code,
                        redirect_uri: payload.redirectUri,
                        client_id: config.clientId,
                        client_secret: config.clientSecret
                    })
                });

                if (!tokenResponse.ok) {
                    const errBody = await tokenResponse.text();
                    console.error("Failed to get LinkedIn access token:", errBody);
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string; id_token?: string };
                const accessToken = tokenData.access_token;

                // Fetch User Info using OIDC userinfo endpoint
                const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
                    headers: {
                        "Authorization": `Bearer ${accessToken}`
                    }
                });

                if (!profileResponse.ok) {
                    const errBody = await profileResponse.text();
                    console.error("Failed to get LinkedIn user info:", errBody);
                    return null;
                }

                const profileData = await profileResponse.json() as {
                    sub: string;
                    email: string;
                    name?: string;
                    picture?: string;
                    email_verified?: boolean;
                };

                return {
                    providerId: profileData.sub,
                    email: profileData.email,
                    displayName: profileData.name || null,
                    photoUrl: profileData.picture || null,
                };
            } catch (error) {
                console.error("LinkedIn OAuth error:", error);
                return null;
            }
        }
    };
}
