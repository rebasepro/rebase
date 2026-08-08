import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, type OAuthCodeFlowPayload } from "./oauth-code-flow";

/**
 * Creates a Facebook / Meta OAuth Provider integration.
 *
 * Uses the authorization code flow to exchange a code for an access token,
 * then fetches user profile from the Facebook Graph API.
 */
export function createFacebookProvider(config: { clientId: string; clientSecret: string }): OAuthProvider<OAuthCodeFlowPayload> {
    return {
        id: "facebook",
        schema: oauthCodeFlowSchema(),
        verify: async (payload: OAuthCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
            try {
                // Exchange code for access token.
                //
                // POSTed as a form body, not a query string: the URL is the
                // part of a request that outbound proxies, APM spans and
                // `fetch` error objects log by default, and a long-lived app
                // secret sitting in a log aggregator is a compromise nobody
                // notices. Graph accepts both.
                const tokenResponse = await fetch("https://graph.facebook.com/v19.0/oauth/access_token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: config.clientId,
                        client_secret: config.clientSecret,
                        redirect_uri: payload.redirectUri,
                        code: payload.code,
                        ...pkceTokenParams(payload.codeVerifier)
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Facebook access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string };
                const accessToken = tokenData.access_token;

                // Fetch user profile with email and profile picture
                const profileUrl = new URL("https://graph.facebook.com/v19.0/me");
                profileUrl.searchParams.set("fields", "id,name,email,picture.type(large)");

                const profileResponse = await fetch(profileUrl.toString(), {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                if (!profileResponse.ok) {
                    logger.error("Failed to get Facebook user info", { detail: await profileResponse.text() });
                    return null;
                }

                const profileData = await profileResponse.json() as {
                    id: string;
                    name?: string;
                    email?: string;
                    picture?: { data?: { url?: string } };
                };

                if (!profileData.email) {
                    logger.error("Facebook user has no email (email permission may not have been granted)");
                    return null;
                }

                return {
                    providerId: profileData.id,
                    email: profileData.email,
                    displayName: profileData.name || null,
                    photoUrl: profileData.picture?.data?.url || null,
                    // Graph exposes no email-verification field on `/me`, so
                    // nothing in the response supports a `true` here.
                    // `emailVerified` is the sole gate on attaching this
                    // identity to a pre-existing account; users who already
                    // have one link through `POST /auth/link/facebook`.
                    emailVerified: false
                };
            } catch (error) {
                logger.error("Facebook OAuth error", { error: error });
                return null;
            }
        }
    };
}
