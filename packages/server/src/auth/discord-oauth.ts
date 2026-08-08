import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, providerVerifiedEmail, type OAuthCodeFlowPayload } from "./oauth-code-flow";

/**
 * Creates a Discord OAuth2 Provider integration.
 *
 * Uses the authorization code flow (with PKCE when the client supplies a
 * verifier). Requires the "identify" and "email" scopes to retrieve the
 * user's email and profile information.
 */
export function createDiscordProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<OAuthCodeFlowPayload> {
    return {
        id: "discord",
        schema: oauthCodeFlowSchema(),
        verify: async (payload: OAuthCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
            try {
                // Exchange code for access token
                const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        grant_type: "authorization_code",
                        code: payload.code,
                        redirect_uri: payload.redirectUri,
                        ...pkceTokenParams(payload.codeVerifier)
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Discord access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                // Fetch user profile
                const profileResponse = await fetch("https://discord.com/api/v10/users/@me", {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                if (!profileResponse.ok) {
                    logger.error("Failed to get Discord user info", { detail: await profileResponse.text() });
                    return null;
                }

                const profileData = await profileResponse.json() as {
                    id: string;
                    username: string;
                    global_name?: string | null;
                    avatar?: string | null;
                    email?: string | null;
                    verified?: boolean;
                };

                if (!profileData.email) {
                    logger.error("Discord user has no email (email scope may not have been granted)");
                    return null;
                }

                // Build avatar URL
                let photoUrl: string | null = null;
                if (profileData.avatar) {
                    const ext = profileData.avatar.startsWith("a_") ? "gif" : "png";
                    photoUrl = `https://cdn.discordapp.com/avatars/${profileData.id}/${profileData.avatar}.${ext}?size=256`;
                }

                return {
                    providerId: profileData.id,
                    email: profileData.email,
                    displayName: profileData.global_name || profileData.username || null,
                    photoUrl,
                    emailVerified: providerVerifiedEmail(profileData.verified)
                };
            } catch (error) {
                logger.error("Discord OAuth error", { error: error });
                return null;
            }
        }
    };
}
