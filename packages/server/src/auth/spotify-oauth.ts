import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, type OAuthCodeFlowPayload } from "./oauth-code-flow";

/**
 * Creates a Spotify OAuth Provider integration.
 * Uses the authorization code flow with the "user-read-email" scope.
 */
export function createSpotifyProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<OAuthCodeFlowPayload> {
    return {
        id: "spotify",
        schema: oauthCodeFlowSchema(),
        verify: async (payload: OAuthCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
            try {
                const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

                const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": `Basic ${basicAuth}`
                    },
                    body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: payload.code,
                        redirect_uri: payload.redirectUri,
                        ...pkceTokenParams(payload.codeVerifier)
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Spotify access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };

                const profileResponse = await fetch("https://api.spotify.com/v1/me", {
                    headers: { "Authorization": `Bearer ${tokenData.access_token}` }
                });

                if (!profileResponse.ok) {
                    logger.error("Failed to get Spotify user info", { detail: await profileResponse.text() });
                    return null;
                }

                const p = await profileResponse.json() as {
                    id: string; display_name?: string | null;
                    email?: string; images?: Array<{ url: string }>;
                };

                if (!p.email) { logger.error("Spotify user has no email"); return null; }

                return {
                    providerId: p.id,
                    email: p.email,
                    displayName: p.display_name || null,
                    photoUrl: p.images?.[0]?.url || null,
                    // `/v1/me` carries no verification field, so there is
                    // nothing here to read — and `emailVerified` is the sole
                    // gate on attaching this identity to a pre-existing
                    // account. Reporting "not verified" is the honest answer;
                    // users with an existing account link through
                    // `POST /auth/link/spotify`, which proves ownership with a
                    // live session instead.
                    emailVerified: false
                };
            } catch (error) {
                logger.error("Spotify OAuth error", { error: error });
                return null;
            }
        }
    };
}
