import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";
import { logger } from "../utils/logger";

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
                    logger.error("Failed to get Microsoft access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                // Fetch user profile from Microsoft Graph
                const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                if (!profileResponse.ok) {
                    logger.error("Failed to get Microsoft user info", { detail: await profileResponse.text() });
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
                    logger.error("Microsoft user has no email");
                    return null;
                }

                // Microsoft Graph exposes no per-request email-verification flag.
                // `mail` is a provisioned, provider-verified mailbox address; a
                // bare `userPrincipalName` (which is what some guest / MSA cases
                // fall back to) is a sign-in identifier, not a guaranteed
                // verified email. `emailVerified` gates auto-linking an OAuth
                // login onto a pre-existing password account (see auth routes),
                // so only treat a real `mail` address as verified rather than
                // asserting it unconditionally.
                const emailVerified = Boolean(profileData.mail);

                // Attempt to fetch profile photo URL (Graph returns binary, not a URL).
                // We skip this and let the frontend use the Microsoft Graph photo endpoint.
                return {
                    providerId: profileData.id,
                    email,
                    displayName: profileData.displayName || null,
                    photoUrl: null,
                    emailVerified
                };
            } catch (error) {
                logger.error("Microsoft OAuth error", { error: error });
                return null;
            }
        }
    };
}
