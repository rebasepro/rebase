import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

/**
 * Creates a Discord OAuth2 Provider integration.
 *
 * Uses the authorization code flow. Requires the "identify" and "email"
 * scopes to retrieve the user's email and profile information.
 */
export function createDiscordProvider(config: { clientId: string; clientSecret: string }): OAuthProvider {
    return {
        id: "discord",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
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
                        redirect_uri: payload.redirectUri
                    })
                });

                if (!tokenResponse.ok) {
                    console.error("Failed to get Discord access token:", await tokenResponse.text());
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                // Fetch user profile
                const profileResponse = await fetch("https://discord.com/api/v10/users/@me", {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                if (!profileResponse.ok) {
                    console.error("Failed to get Discord user info:", await profileResponse.text());
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
                    console.error("Discord user has no email (email scope may not have been granted)");
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
                };
            } catch (error) {
                console.error("Discord OAuth error:", error);
                return null;
            }
        }
    };
}
