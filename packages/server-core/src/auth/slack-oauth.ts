import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

/**
 * Creates a Slack OAuth Provider integration (OAuth 2.0 / "Sign in with Slack").
 * Uses the OpenID Connect flow with the "openid,email,profile" scopes.
 */
export function createSlackProvider(config: { clientId: string; clientSecret: string }): OAuthProvider {
    return {
        id: "slack",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
            try {
                const tokenResponse = await fetch("https://slack.com/api/openid.connect.token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        code: payload.code,
                        redirect_uri: payload.redirectUri,
                        grant_type: "authorization_code"
                    })
                });

                if (!tokenResponse.ok) {
                    console.error("Failed to get Slack access token:", await tokenResponse.text());
                    return null;
                }

                const tokenData = await tokenResponse.json() as { ok: boolean; access_token?: string; error?: string };
                if (!tokenData.ok || !tokenData.access_token) {
                    console.error("Slack token exchange failed:", tokenData.error);
                    return null;
                }

                const profileResponse = await fetch("https://slack.com/api/openid.connect.userInfo", {
                    headers: { "Authorization": `Bearer ${tokenData.access_token}` }
                });

                if (!profileResponse.ok) {
                    console.error("Failed to get Slack user info:", await profileResponse.text());
                    return null;
                }

                const p = await profileResponse.json() as {
                    ok: boolean; sub: string; name?: string;
                    email?: string; picture?: string; email_verified?: boolean;
                };

                if (!p.ok || !p.email) {
                    console.error("Slack user has no email");
                    return null;
                }

                return {
                    providerId: p.sub,
                    email: p.email,
                    displayName: p.name || null,
                    photoUrl: p.picture || null,
                };
            } catch (error) {
                console.error("Slack OAuth error:", error);
                return null;
            }
        }
    };
}
