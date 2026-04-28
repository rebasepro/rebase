import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

/**
 * Creates a Bitbucket OAuth Provider integration (OAuth 2.0 consumer).
 */
export function createBitbucketProvider(config: { clientId: string; clientSecret: string }): OAuthProvider {
    return {
        id: "bitbucket",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
            try {
                const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

                const tokenResponse = await fetch("https://bitbucket.org/site/oauth2/access_token", {
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
                    console.error("Failed to get Bitbucket access token:", await tokenResponse.text());
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                const profileResponse = await fetch("https://api.bitbucket.org/2.0/user", {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                if (!profileResponse.ok) {
                    console.error("Failed to get Bitbucket user info:", await profileResponse.text());
                    return null;
                }

                const p = await profileResponse.json() as {
                    uuid: string; display_name?: string; username?: string;
                    links?: { avatar?: { href?: string } };
                };

                // Bitbucket doesn't return email in user profile — fetch from /emails endpoint
                const emailsResponse = await fetch("https://api.bitbucket.org/2.0/user/emails", {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                let email: string | null = null;
                if (emailsResponse.ok) {
                    const emailData = await emailsResponse.json() as {
                        values: Array<{ email: string; is_primary: boolean; is_confirmed: boolean }>;
                    };
                    const primary = emailData.values.find(e => e.is_primary && e.is_confirmed)
                        || emailData.values.find(e => e.is_confirmed);
                    email = primary?.email || null;
                }

                if (!email) { console.error("Bitbucket user has no verified email"); return null; }

                return {
                    providerId: p.uuid,
                    email,
                    displayName: p.display_name || p.username || null,
                    photoUrl: p.links?.avatar?.href || null,
                };
            } catch (error) {
                console.error("Bitbucket OAuth error:", error);
                return null;
            }
        }
    };
}
