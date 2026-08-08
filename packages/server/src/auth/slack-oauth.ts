import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, providerVerifiedEmail, type OAuthCodeFlowPayload } from "./oauth-code-flow";

/**
 * Creates a Slack OAuth Provider integration (OAuth 2.0 / "Sign in with Slack").
 * Uses the OpenID Connect flow with the "openid,email,profile" scopes.
 */
export function createSlackProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<OAuthCodeFlowPayload> {
    return {
        id: "slack",
        schema: oauthCodeFlowSchema(),
        verify: async (payload: OAuthCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
            try {
                const tokenResponse = await fetch("https://slack.com/api/openid.connect.token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        code: payload.code,
                        redirect_uri: payload.redirectUri,
                        grant_type: "authorization_code",
                        ...pkceTokenParams(payload.codeVerifier)
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Slack access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { ok: boolean; access_token?: string; error?: string };
                if (!tokenData.ok || !tokenData.access_token) {
                    logger.error("Slack token exchange failed", { detail: tokenData.error });
                    return null;
                }

                const profileResponse = await fetch("https://slack.com/api/openid.connect.userInfo", {
                    headers: { "Authorization": `Bearer ${tokenData.access_token}` }
                });

                if (!profileResponse.ok) {
                    logger.error("Failed to get Slack user info", { detail: await profileResponse.text() });
                    return null;
                }

                const p = await profileResponse.json() as {
                    ok: boolean; sub: string; name?: string;
                    email?: string; picture?: string; email_verified?: boolean;
                };

                if (!p.ok || !p.email) {
                    logger.error("Slack user has no email");
                    return null;
                }

                return {
                    providerId: p.sub,
                    email: p.email,
                    displayName: p.name || null,
                    photoUrl: p.picture || null,
                    emailVerified: providerVerifiedEmail(p.email_verified)
                };
            } catch (error) {
                logger.error("Slack OAuth error", { error: error });
                return null;
            }
        }
    };
}
