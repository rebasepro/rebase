import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

/**
 * Creates a Microsoft / Entra ID (Azure AD) OAuth Provider integration.
 *
 * Supports both personal Microsoft accounts and work/school (Azure AD) accounts
 * via the "common" tenant endpoint. Uses the authorization code flow.
 */
export function createMicrosoftProvider(config: {
    clientId: string;
    clientSecret: string;
    /** Tenant ID. Defaults to "common" which allows both personal and organizational accounts. */
    tenantId?: string;
}): OAuthProvider<{ code: string; redirectUri: string }> {
    const tenantId = config.tenantId || "common";

    return {
        id: "microsoft",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
            try {
                // Exchange code for access token
                const tokenResponse = await fetch(
                    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: new URLSearchParams({
                            client_id: config.clientId,
                            client_secret: config.clientSecret,
                            code: payload.code,
                            redirect_uri: payload.redirectUri,
                            grant_type: "authorization_code",
                            scope: "openid profile email User.Read"
                        })
                    }
                );

                if (!tokenResponse.ok) {
                    console.error("Failed to get Microsoft access token:", await tokenResponse.text());
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                // Fetch user profile from Microsoft Graph
                const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                if (!profileResponse.ok) {
                    console.error("Failed to get Microsoft user info:", await profileResponse.text());
                    return null;
                }

                const profileData = await profileResponse.json() as {
                    id: string;
                    displayName?: string | null;
                    mail?: string | null;
                    userPrincipalName?: string | null;
                };

                const email = profileData.mail || profileData.userPrincipalName;
                if (!email) {
                    console.error("Microsoft user has no email");
                    return null;
                }

                // Attempt to fetch profile photo URL (Graph returns binary, not a URL).
                // We skip this and let the frontend use the Microsoft Graph photo endpoint.
                return {
                    providerId: profileData.id,
                    email,
                    displayName: profileData.displayName || null,
                    photoUrl: null
                };
            } catch (error) {
                console.error("Microsoft OAuth error:", error);
                return null;
            }
        }
    };
}
