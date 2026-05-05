import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

/**
 * Creates a GitHub OAuth Provider integration.
 *
 * Flow: Frontend receives an authorization `code` via the GitHub OAuth redirect.
 * This provider exchanges the code for an access token, then fetches the user's
 * profile and primary email from the GitHub API.
 */
export function createGitHubProvider(config: { clientId: string; clientSecret: string }): OAuthProvider {
    return {
        id: "github",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
            try {
                // Exchange code for access token
                const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        code: payload.code,
                        redirect_uri: payload.redirectUri
                    })
                });

                if (!tokenResponse.ok) {
                    console.error("Failed to get GitHub access token:", await tokenResponse.text());
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
                if (tokenData.error || !tokenData.access_token) {
                    console.error("GitHub token exchange error:", tokenData.error);
                    return null;
                }

                const accessToken = tokenData.access_token;

                // Fetch user profile
                const profileResponse = await fetch("https://api.github.com/user", {
                    headers: {
                        "Authorization": `Bearer ${accessToken}`,
                        "Accept": "application/vnd.github+json",
                        "User-Agent": "Rebase-Auth"
                    }
                });

                if (!profileResponse.ok) {
                    console.error("Failed to get GitHub user info:", await profileResponse.text());
                    return null;
                }

                const profileData = await profileResponse.json() as {
                    id: number;
                    login: string;
                    name?: string | null;
                    avatar_url?: string | null;
                    email?: string | null;
                };

                // GitHub may not return email in profile if it's private.
                // Fetch from /user/emails endpoint instead.
                let email = profileData.email;
                if (!email) {
                    const emailsResponse = await fetch("https://api.github.com/user/emails", {
                        headers: {
                            "Authorization": `Bearer ${accessToken}`,
                            "Accept": "application/vnd.github+json",
                            "User-Agent": "Rebase-Auth"
                        }
                    });

                    if (emailsResponse.ok) {
                        const emails = await emailsResponse.json() as Array<{
                            email: string;
                            primary: boolean;
                            verified: boolean;
                        }>;
                        const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified);
                        email = primary?.email || null;
                    }
                }

                if (!email) {
                    console.error("GitHub user has no verified email");
                    return null;
                }

                return {
                    providerId: String(profileData.id),
                    email,
                    displayName: profileData.name || profileData.login || null,
                    photoUrl: profileData.avatar_url || null
                };
            } catch (error) {
                console.error("GitHub OAuth error:", error);
                return null;
            }
        }
    };
}
