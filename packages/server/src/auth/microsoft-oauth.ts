import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, providerVerifiedEmail, type OAuthCodeFlowPayload } from "./oauth-code-flow";
import { tryVerifyOidcIdToken } from "./oidc-id-token";

/** Endpoints that federate to more than one directory. */
const MULTI_TENANT_ENDPOINTS = new Set(["common", "organizations", "consumers"]);

/**
 * Creates a Microsoft / Entra ID (Azure AD) OAuth Provider integration.
 *
 * Supports both personal Microsoft accounts and work/school (Azure AD) accounts
 * via the "common" tenant endpoint. Uses the authorization code flow.
 *
 * ## On `emailVerified`
 *
 * Microsoft Graph exposes no email-verification field, and `mail` is *not* a
 * substitute: it is a directory attribute a tenant administrator sets to any
 * string they like, through Graph or AAD Connect sync. With the default
 * `tenantId: "common"` every Entra tenant in the world is an accepted issuer,
 * so "there is a `mail` value" would mean "anybody who can create a free
 * tenant can nominate any address" — including one that already has an account
 * here.
 *
 * The only signal Microsoft offers is the `xms_edov` ("email domain owner
 * verified") optional claim on the id_token, so that is what this provider
 * reads, off a signature-verified token. If the app registration does not emit
 * `xms_edov`, sign-in still works and the address comes back unverified —
 * which routes the user to `POST /auth/link/microsoft` rather than silently
 * handing them somebody else's account.
 */
export function createMicrosoftProvider(config: {
    clientId: string;
    clientSecret: string;
    /** Tenant ID. Defaults to "common" which allows both personal and organizational accounts. */
    tenantId?: string;
}): OAuthProvider<OAuthCodeFlowPayload> {
    const tenantId = config.tenantId || "common";
    const multiTenant = MULTI_TENANT_ENDPOINTS.has(tenantId.toLowerCase());

    const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
    // Single-tenant apps pin the issuer exactly. Multi-tenant ones cannot —
    // the tenant id is part of the issuer URL — so accept any well-formed
    // tenant GUID and lean on `xms_edov` for the verification decision.
    const issuer: string | RegExp = multiTenant
        ? /^https:\/\/login\.microsoftonline\.com\/[0-9a-fA-F-]{36}\/v2\.0$/
        : `https://login.microsoftonline.com/${tenantId}/v2.0`;

    if (multiTenant) {
        logger.warn(
            `[Rebase] Microsoft provider configured with tenantId "${tenantId}", which accepts sign-ins from `
            + "every Entra tenant. Email addresses are reported as unverified unless the app registration emits "
            + "the xms_edov optional claim. Set an explicit tenantId, or enable xms_edov, to allow automatic "
            + "linking onto existing accounts."
        );
    }

    return {
        id: "microsoft",
        schema: oauthCodeFlowSchema(),
        verify: async (payload: OAuthCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
            try {
                // Exchange code for access token
                const tokenResponse = await fetch(
                    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: new URLSearchParams({
                            client_id: config.clientId,
                            client_secret: config.clientSecret,
                            code: payload.code,
                            redirect_uri: payload.redirectUri,
                            grant_type: "authorization_code",
                            scope: "openid profile email User.Read",
                            ...pkceTokenParams(payload.codeVerifier)
                        })
                    }
                );

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Microsoft access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { access_token: string; id_token?: string };
                const accessToken = tokenData.access_token;

                // The `openid` scope above means Entra returns an id_token. If
                // one is present it must verify — a token that fails signature,
                // audience or issuer checks is not something to shrug off and
                // continue past.
                let idTokenClaims: Record<string, unknown> | null = null;
                if (tokenData.id_token) {
                    idTokenClaims = await tryVerifyOidcIdToken("microsoft", {
                        idToken: tokenData.id_token,
                        jwksUri,
                        issuer,
                        audience: config.clientId
                    });
                    if (!idTokenClaims) return null;
                }

                // Fetch user profile from Microsoft Graph
                const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
                    headers: { "Authorization": `Bearer ${accessToken}` }
                });

                if (!profileResponse.ok) {
                    logger.error("Failed to get Microsoft user info", { detail: await profileResponse.text() });
                    return null;
                }

                const profileData = await profileResponse.json() as {
                    id: string;
                    displayName?: string | null;
                    mail?: string | null;
                    userPrincipalName?: string | null;
                };

                const email = profileData.mail || profileData.userPrincipalName;
                if (!email) {
                    logger.error("Microsoft user has no email");
                    return null;
                }

                // `xms_edov` is asserted about the id_token's own email claim,
                // so it only carries over to the Graph address when the two
                // agree.
                const claimedEmail = (idTokenClaims?.email ?? idTokenClaims?.preferred_username) as string | undefined;
                const emailVerified = providerVerifiedEmail(idTokenClaims?.xms_edov)
                    && typeof claimedEmail === "string"
                    && claimedEmail.toLowerCase() === email.toLowerCase();

                // Attempt to fetch profile photo URL (Graph returns binary, not a URL).
                // We skip this and let the frontend use the Microsoft Graph photo endpoint.
                return {
                    // Keyed on the Graph object id, unchanged: it is what every
                    // already-linked identity row holds.
                    providerId: profileData.id,
                    email,
                    displayName: profileData.displayName || null,
                    photoUrl: null,
                    emailVerified
                };
            } catch (error) {
                logger.error("Microsoft OAuth error", { error: error });
                return null;
            }
        }
    };
}
