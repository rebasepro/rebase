import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, providerVerifiedEmail, type OAuthCodeFlowPayload } from "./oauth-code-flow";

/**
 * Creates a Bitbucket OAuth Provider integration (OAuth 2.0 consumer).
 */
export function createBitbucketProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<OAuthCodeFlowPayload> {
    return {
        id: "bitbucket",
        schema: oauthCodeFlowSchema(),
        verify: async (payload: OAuthCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
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
                        redirect_uri: payload.redirectUri,
                        ...pkceTokenParams(payload.codeVerifier)
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Bitbucket access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                const profileResponse = await fetch("https://api.bitbucket.org/2.0/user", {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                if (!profileResponse.ok) {
                    logger.error("Failed to get Bitbucket user info", { detail: await profileResponse.text() });
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

                let selected: { email: string; is_confirmed: boolean } | undefined;
                if (emailsResponse.ok) {
                    const emailData = await emailsResponse.json() as {
                        values: Array<{ email: string; is_primary: boolean; is_confirmed: boolean }>;
                    };
                    selected = emailData.values.find(e => e.is_primary && e.is_confirmed)
                        || emailData.values.find(e => e.is_confirmed);
                }

                if (!selected?.email) { logger.error("Bitbucket user has no verified email"); return null; }

                return {
                    providerId: p.uuid,
                    email: selected.email,
                    displayName: p.display_name || p.username || null,
                    photoUrl: p.links?.avatar?.href || null,
                    // Read off the address we actually chose rather than
                    // restating the filter above as a literal `true` — the two
                    // cannot drift apart this way.
                    emailVerified: providerVerifiedEmail(selected.is_confirmed)
                };
            } catch (error) {
                logger.error("Bitbucket OAuth error", { error: error });
                return null;
            }
        }
    };
}
