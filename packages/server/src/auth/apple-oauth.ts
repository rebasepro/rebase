import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, providerVerifiedEmail, type OAuthCodeFlowPayload } from "./oauth-code-flow";
import { tryVerifyOidcIdToken } from "./oidc-id-token";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URI = "https://appleid.apple.com/auth/keys";

/**
 * The request body `POST /auth/apple` accepts.
 *
 * Apple mints a code for one of two kinds of client, and the token exchange
 * has to name the same one:
 * - **Web** — the code was issued to the Services ID through a browser
 *   authorization, so it carries the `redirectUri` that authorization used.
 * - **Native** — the code came from `ASAuthorizationController` in an iOS,
 *   iPadOS or macOS app. It was issued to the app's bundle id and there was no
 *   redirect, so the client names the `bundleId` instead.
 *
 * Exactly one of the two is sent.
 */
export interface AppleCodeFlowPayload extends Omit<OAuthCodeFlowPayload, "redirectUri"> {
    /** Web sign-in: the redirect URI the browser authorization used. */
    redirectUri?: string;
    /** Native sign-in: the bundle id of the app that obtained the code. */
    bundleId?: string;
    /**
     * Apple sends the user's *name* only on the first authorization, so the
     * frontend has to forward it. It is display data and nothing else — the
     * identity email comes from the id_token, never from the request body.
     */
    user?: { name?: { firstName?: string; lastName?: string } };
}

export interface AppleProviderConfig {
    /**
     * The Services ID that web sign-in authorizes against. Optional when
     * `bundleIds` is set: an app that only signs in from iOS has no Services ID.
     */
    clientId?: string;
    /**
     * Bundle ids of the native apps (iOS, iPadOS, macOS) whose codes this
     * backend accepts. A native code is issued to the app, not to the Services
     * ID, so each app is a client of its own. Apple's `sub` is per team, so the
     * same person signing in on the web and in the app is one identity.
     */
    bundleIds?: string[];
    teamId: string;
    keyId: string;
    /** The raw PEM contents of the .p8 private key file */
    privateKey: string;
}

/**
 * Creates an Apple Sign In OAuth Provider integration.
 *
 * Apple requires a client secret that is a signed JWT, regenerated on each
 * token exchange (valid up to 6 months). This provider handles that automatically.
 *
 * Required Apple Developer configuration:
 * - Services ID (clientId) for web sign-in, and/or the bundle ids of the
 *   native apps (bundleIds)
 * - Key ID from the private key registered with Apple
 * - Team ID from Apple Developer account
 * - Private key (.p8 file contents) downloaded from Apple Developer portal
 */
export function createAppleProvider(config: AppleProviderConfig): OAuthProvider<AppleCodeFlowPayload> {
    const bundleIds = (config.bundleIds ?? []).map((id) => id.trim()).filter(Boolean);
    if (!config.clientId && bundleIds.length === 0) {
        // Every code is refused without one — fail at boot, not at the first sign-in.
        throw new Error("Apple sign-in needs a Services ID (clientId), at least one app bundle id (bundleIds), or both.");
    }

    /**
     * Generate a client_secret JWT signed with the Apple private key.
     * Apple requires this instead of a static client_secret, and its `sub`
     * names the client the code was issued to.
     */
    async function generateClientSecret(clientId: string): Promise<string> {
        return jwt.sign({}, config.privateKey, {
            algorithm: "ES256",
            keyid: config.keyId,
            issuer: config.teamId,
            expiresIn: "180d",
            audience: "https://appleid.apple.com",
            subject: clientId
        });
    }

    /**
     * The client the code was issued to, or null when this backend does not
     * know it. The bundle id is the caller's claim, so it is only ever taken
     * from the configured list — and Apple refuses the exchange anyway if the
     * code was issued to a different client than the one named.
     */
    function resolveClient(payload: AppleCodeFlowPayload): { clientId: string; redirectUri?: string } | null {
        if (payload.bundleId !== undefined) {
            return bundleIds.includes(payload.bundleId) ? { clientId: payload.bundleId } : null;
        }
        return config.clientId ? { clientId: config.clientId, redirectUri: payload.redirectUri } : null;
    }

    return {
        id: "apple",
        publicClientId: config.clientId,
        schema: oauthCodeFlowSchema().extend({
            redirectUri: z.string().url("Valid redirect URI is required").optional(),
            bundleId: z.string().min(1).optional(),
            /**
             * Apple sends user info only on first authorization; the frontend
             * must forward it. Only the *name* is accepted — an `email` here
             * used to be promoted to the account's identity whenever the
             * id_token had no `email` claim, and an attacker chooses whether
             * that claim is absent simply by omitting the `email` scope from
             * their own authorization request.
             */
            user: z.object({
                name: z.object({
                    firstName: z.string().optional(),
                    lastName: z.string().optional()
                }).optional()
            }).optional()
        }).refine(
            (payload) => (payload.redirectUri === undefined) !== (payload.bundleId === undefined),
            { message: "Send redirectUri for web sign-in or bundleId for a native app, not both" }
        ),
        verify: async (payload: AppleCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
            const client = resolveClient(payload);
            if (!client) {
                logger.error(payload.bundleId !== undefined
                    ? "Apple sign-in from an app bundle id this backend does not list in bundleIds"
                    : "Apple web sign-in needs a Services ID (clientId), and none is configured");
                return null;
            }
            try {
                const clientSecret = await generateClientSecret(client.clientId);

                // Exchange code for tokens
                const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: client.clientId,
                        client_secret: clientSecret,
                        code: payload.code,
                        grant_type: "authorization_code",
                        // A native code was issued without a redirect, and
                        // Apple refuses an exchange that names one.
                        ...(client.redirectUri ? { redirect_uri: client.redirectUri } : {}),
                        ...pkceTokenParams(payload.codeVerifier)
                    })
                });

                if (!tokenResponse.ok) {
                    logger.error("Failed to get Apple access token", { detail: await tokenResponse.text() });
                    return null;
                }

                const tokenData = await tokenResponse.json() as { id_token?: string };

                // Verify the id_token against Apple's JWKS rather than
                // base64-decoding it. The signature is the least of it: `aud`
                // is what confirms the token was minted for *this* client (Services ID or app)
                // and not another one under the same Apple team, and `exp`
                // stops a captured token being replayed.
                const decoded = tokenData.id_token
                    ? await tryVerifyOidcIdToken("apple", {
                        idToken: tokenData.id_token,
                        jwksUri: APPLE_JWKS_URI,
                        issuer: APPLE_ISSUER,
                        audience: client.clientId
                    })
                    : null;

                if (!decoded) {
                    logger.error("Apple token exchange returned no verifiable id_token");
                    return null;
                }

                // The id_token is the only acceptable source of the address.
                const email = decoded.email;
                if (!email) {
                    logger.error("Apple id_token carries no email claim");
                    return null;
                }

                let displayName: string | null = null;
                if (payload.user?.name) {
                    const parts = [payload.user.name.firstName, payload.user.name.lastName].filter(Boolean);
                    displayName = parts.length > 0 ? parts.join(" ") : null;
                }

                return {
                    providerId: decoded.sub,
                    email,
                    displayName,
                    photoUrl: null, // Apple does not provide a profile photo
                    emailVerified: providerVerifiedEmail(decoded.email_verified)
                };
            } catch (error) {
                logger.error("Apple OAuth error", { error: error });
                return null;
            }
        }
    };
}
