import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";
import { logger } from "../utils/logger";

/**
 * Creates a Facebook / Meta OAuth Provider integration.
 *
 * Uses the authorization code flow to exchange a code for an access token,
 * then fetches user profile from the Facebook Graph API.
 */
export function createFacebookProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<{ code: string; redirectUri: string }> {
    return {
        id: "facebook",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
            try {
                // Exchange code for access token
                const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
                tokenUrl.searchParams.set("client_id", config.clientId);
                tokenUrl.searchParams.set("client_secret", config.clientSecret);
                tokenUrl.searchParams.set("redirect_uri", payload.redirectUri);
                tokenUrl.searchParams.set("code", payload.code);

                const tokenResponse = await fetch(tokenUrl.toString());

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Facebook access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                // Fetch user profile with email and profile picture
                const profileUrl = new URL("https://graph.facebook.com/v19.0/me");
                profileUrl.searchParams.set("fields", "id,name,email,picture.type(large)");
                profileUrl.searchParams.set("access_token", accessToken);

                const profileResponse = await fetch(profileUrl.toString());

                if (!profileResponse.ok) {
                    logger.error("Failed to get Facebook user info", { detail: await profileResponse.text() });
                    return null;
                }

                const profileData = await profileResponse.json() as {
                    id: string;
                    name?: string;
                    email?: string;
                    picture?: { data?: { url?: string } };
                };

                if (!profileData.email) {
                    logger.error("Facebook user has no email (email permission may not have been granted)");
                    return null;
                }

                return {
                    providerId: profileData.id,
                    email: profileData.email,
                    displayName: profileData.name || null,
                    photoUrl: profileData.picture?.data?.url || null,
                    emailVerified: true
                };
            } catch (error) {
                logger.error("Facebook OAuth error", { error: error });
                return null;
            }
        }
    };
}
