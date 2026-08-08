import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";
import { oauthCodeFlowSchema, pkceTokenParams, providerVerifiedEmail, type OAuthCodeFlowPayload } from "./oauth-code-flow";
import { tryVerifyOidcIdToken } from "./oidc-id-token";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URI = "https://appleid.apple.com/auth/keys";

/** Extra field Apple's client sends that no other provider has. */
export interface AppleCodeFlowPayload extends OAuthCodeFlowPayload {
    /**
     * Apple sends the user's *name* only on the first authorization, so the
     * frontend has to forward it. It is display data and nothing else — the
     * identity email comes from the id_token, never from the request body.
     */
    user?: { name?: { firstName?: string; lastName?: string } };
}

/**
 * Creates an Apple Sign In OAuth Provider integration.
 *
 * Apple requires a client secret that is a signed JWT, regenerated on each
 * token exchange (valid up to 6 months). This provider handles that automatically.
 *
 * Required Apple Developer configuration:
 * - Services ID (clientId)
 * - Key ID from the private key registered with Apple
 * - Team ID from Apple Developer account
 * - Private key (.p8 file contents) downloaded from Apple Developer portal
 */
export function createAppleProvider(config: {
    clientId: string;
    teamId: string;
    keyId: string;
    /** The raw PEM contents of the .p8 private key file */
    privateKey: string;
}): OAuthProvider<AppleCodeFlowPayload> {
    /**
     * Generate a client_secret JWT signed with the Apple private key.
     * Apple requires this instead of a static client_secret.
     */
    async function generateClientSecret(): Promise<string> {
        return jwt.sign({}, config.privateKey, {
            algorithm: "ES256",
            keyid: config.keyId,
            issuer: config.teamId,
            expiresIn: "180d",
            audience: "https://appleid.apple.com",
            subject: config.clientId
        });
    }

    return {
        id: "apple",
        schema: oauthCodeFlowSchema().extend({
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
        }),
        verify: async (payload: AppleCodeFlowPayload): Promise<OAuthProviderProfile | null> => {
            try {
                const clientSecret = await generateClientSecret();

                // Exchange code for tokens
                const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: config.clientId,
                        client_secret: clientSecret,
                        code: payload.code,
                        grant_type: "authorization_code",
                        redirect_uri: payload.redirectUri,
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
                // is what confirms the token was minted for *this* Services ID
                // and not another one under the same Apple team, and `exp`
                // stops a captured token being replayed.
                const decoded = tokenData.id_token
                    ? await tryVerifyOidcIdToken("apple", {
                        idToken: tokenData.id_token,
                        jwksUri: APPLE_JWKS_URI,
                        issuer: APPLE_ISSUER,
                        audience: config.clientId
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
