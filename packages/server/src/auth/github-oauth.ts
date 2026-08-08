import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, providerVerifiedEmail, type OAuthCodeFlowPayload } from "./oauth-code-flow";

/**
 * Creates a GitHub OAuth Provider integration.
 *
 * Flow: Frontend receives an authorization `code` via the GitHub OAuth redirect.
 * This provider exchanges the code for an access token, then fetches the user's
 * profile and primary email from the GitHub API.
 */
export function createGitHubProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<OAuthCodeFlowPayload> {
    return {
        id: "github",
        schema: oauthCodeFlowSchema(),
        verify: async (payload: OAuthCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
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
                        redirect_uri: payload.redirectUri,
                        ...pkceTokenParams(payload.codeVerifier)
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get GitHub access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
                if (tokenData.error || !tokenData.access_token) {
                    logger.error("GitHub token exchange error", { detail: tokenData.error });
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
                    logger.error("Failed to get GitHub user info", { detail: await profileResponse.text() });
                    return null;
                }

                const profileData = await profileResponse.json() as {
                    id: number;
                    login: string;
                    name?: string | null;
                    avatar_url?: string | null;
                    email?: string | null;
                };

                // `/user`'s `email` is the *public profile* address — GitHub
                // applies no verification to it, and it is often absent
                // anyway. `/user/emails` is the only endpoint that reports a
                // `verified` flag, so ask it unconditionally rather than
                // treating the profile field as a fast path that skips the
                // check: that fast path is precisely what used to reach the
                // hardcoded `emailVerified: true` below.
                let email = profileData.email;
                let emailVerified = false;

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
                    const chosen = emails.find(e => e.primary && e.verified)
                        || emails.find(e => e.verified)
                        || (email ? emails.find(e => e.email.toLowerCase() === email!.toLowerCase()) : undefined);
                    if (chosen) {
                        email = chosen.email;
                        emailVerified = providerVerifiedEmail(chosen.verified);
                    }
                }

                if (!email) {
                    logger.error("GitHub user has no email");
                    return null;
                }

                return {
                    providerId: String(profileData.id),
                    email,
                    displayName: profileData.name || profileData.login || null,
                    photoUrl: profileData.avatar_url || null,
                    emailVerified
                };
            } catch (error) {
                logger.error("GitHub OAuth error", { error: error });
                return null;
            }
        }
    };
}
