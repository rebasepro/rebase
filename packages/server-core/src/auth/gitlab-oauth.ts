import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";
import { logger } from "../utils/logger";

/**
 * Creates a GitLab OAuth Provider integration.
 * Works with both GitLab.com and self-hosted instances.
 */
export function createGitLabProvider(config: {
    clientId: string;
    clientSecret: string;
    baseUrl?: string;
}): OAuthProvider<{ code: string; redirectUri: string }> {
    const gitlabUrl = (config.baseUrl || "https://gitlab.com").replace(/\/$/, "");

    return {
        id: "gitlab",
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required")
        }),
        verify: async (payload: { code: string; redirectUri: string }): Promise<OAuthProviderProfile | null> => {
            try {
                const tokenResponse = await fetch(`${gitlabUrl}/oauth/token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        code: payload.code,
                        grant_type: "authorization_code",
                        redirect_uri: payload.redirectUri
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get GitLab access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };

                const profileResponse = await fetch(`${gitlabUrl}/api/v4/user`, {
                    headers: { "Authorization": `Bearer ${tokenData.access_token}` }
                });

                if (!profileResponse.ok) {
                    logger.error("Failed to get GitLab user info", { detail: await profileResponse.text() });
                    return null;
                }

                const p = await profileResponse.json() as {
                    id: number; username: string; name?: string;
                    email: string; avatar_url?: string | null;
                };

                if (!p.email) { logger.error("GitLab user has no email"); return null; }

                return {
                    providerId: String(p.id),
                    email: p.email,
                    displayName: p.name || p.username || null,
                    photoUrl: p.avatar_url || null,
                    emailVerified: true
                };
            } catch (error) {
                logger.error("GitLab OAuth error", { error: error });
                return null;
            }
        }
    };
}
