import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

/**
 * Creates a Spotify OAuth Provider integration.
 * Uses the authorization code flow with the "user-read-email" scope.
 */
export function createSpotifyProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<{ code: string; redirectUri: string }> {
    return {
        id: "spotify",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
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
                        redirect_uri: payload.redirectUri
                    })
                });

                if (!tokenResponse.ok) {
                    console.error("Failed to get Spotify access token:", await tokenResponse.text());
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };

                const profileResponse = await fetch("https://api.spotify.com/v1/me", {
                    headers: { "Authorization": `Bearer ${tokenData.access_token}` }
                });

                if (!profileResponse.ok) {
                    console.error("Failed to get Spotify user info:", await profileResponse.text());
                    return null;
                }

                const p = await profileResponse.json() as {
                    id: string; display_name?: string | null;
                    email?: string; images?: Array<{ url: string }>;
                };

                if (!p.email) { console.error("Spotify user has no email"); return null; }

                return {
                    providerId: p.id,
                    email: p.email,
                    displayName: p.display_name || null,
                    photoUrl: p.images?.[0]?.url || null,
                    emailVerified: true
                };
            } catch (error) {
                console.error("Spotify OAuth error:", error);
                return null;
            }
        }
    };
}
