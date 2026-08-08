import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, type OAuthCodeFlowPayload } from "./oauth-code-flow";

/**
 * Creates a GitLab OAuth Provider integration.
 * Works with both GitLab.com and self-hosted instances.
 *
 * `baseUrl` is configuration only and must stay that way: a caller-supplied
 * instance URL would make this provider an SSRF primitive and an
 * arbitrary-identity oracle in one step.
 */
export function createGitLabProvider(config: {
    clientId: string;
    clientSecret: string;
    baseUrl?: string;
}): OAuthProvider<OAuthCodeFlowPayload> {
    const gitlabUrl = (config.baseUrl || "https://gitlab.com").replace(/\/$/, "");

    return {
        id: "gitlab",
        schema: oauthCodeFlowSchema(),
        verify: async (payload: OAuthCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
            try {
                const tokenResponse = await fetch(`${gitlabUrl}/oauth/token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        code: payload.code,
                        grant_type: "authorization_code",
                        redirect_uri: payload.redirectUri,
                        ...pkceTokenParams(payload.codeVerifier)
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
                    email?: string; avatar_url?: string | null;
                    confirmed_at?: string | null;
                };

                if (!p.email) { logger.error("GitLab user has no email"); return null; }

                return {
                    providerId: String(p.id),
                    email: p.email,
                    displayName: p.name || p.username || null,
                    photoUrl: p.avatar_url || null,
                    // `/api/v4/user` timestamps the address confirmation for
                    // the authenticated user. That timestamp is the only
                    // verification signal GitLab gives us, so it is the only
                    // thing allowed to produce a `true` — a self-hosted
                    // instance with confirmation disabled reports nothing here
                    // and correctly comes back unverified.
                    emailVerified: Boolean(p.confirmed_at)
                };
            } catch (error) {
                logger.error("GitLab OAuth error", { error: error });
                return null;
            }
        }
    };
}
