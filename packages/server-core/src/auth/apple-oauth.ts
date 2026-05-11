import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";
import jwt from "jsonwebtoken";
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
}): OAuthProvider<{
            code: string;
            redirectUri: string;
            user?: { name?: { firstName?: string; lastName?: string }; email?: string };
        }> {
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
        schema: z.object({
            code: z.string().min(1, "Auth code is required"),
            redirectUri: z.string().url("Valid redirect URI is required"),
            /** Apple sends user info only on first authorization; the frontend must forward it. */
            user: z.object({
                name: z.object({
                    firstName: z.string().optional(),
                    lastName: z.string().optional()
                }).optional(),
                email: z.string().email().optional()
            }).optional()
        }),
        verify: async (payload: {
            code: string;
            redirectUri: string;
            user?: { name?: { firstName?: string; lastName?: string }; email?: string };
        }): Promise<OAuthProviderProfile | null> => {
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
                        redirect_uri: payload.redirectUri
                    })
                });

                if (!tokenResponse.ok) {
                    console.error("Failed to get Apple access token:", await tokenResponse.text());
                    return null;
                }

                const tokenData = await tokenResponse.json() as { id_token: string };

                // Decode the id_token (JWT) to get user info.
                // Apple's id_token is a standard JWT — we only need the payload.
                const [, payloadB64] = tokenData.id_token.split(".");
                const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
                    sub: string;
                    email?: string;
                    email_verified?: string | boolean;
                };

                // Apple only sends the user's name on the FIRST authorization.
                // Subsequent logins only have the id_token. The frontend should pass
                // the user object from the first auth for us to capture the name.
                const email = decoded.email || payload.user?.email;
                if (!email) {
                    console.error("Apple user has no email");
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
                    photoUrl: null // Apple does not provide a profile photo
                };
            } catch (error) {
                console.error("Apple OAuth error:", error);
                return null;
            }
        }
    };
}
