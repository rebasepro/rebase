import { OAuth2Client } from "google-auth-library/build/src/index.js";
import type { OAuthProvider, OAuthProviderProfile } from "./interfaces";
import { z } from "zod";

export interface GoogleUserInfo {
    googleId: string;
    email: string;
    displayName: string | null;
    photoUrl: string | null;
    emailVerified: boolean;
}

/**
 * Creates a Google OAuth Provider integration
 */
export function createGoogleProvider(clientId: string): OAuthProvider<{ idToken: string }> {
    const googleClient = new OAuth2Client(clientId);

    return {
        id: "google",
        schema: z.object({
            idToken: z.string().min(1, "ID token is required")
        }),
        verify: async (payload: { idToken: string }): Promise<OAuthProviderProfile | null> => {
            try {
                const ticket = await googleClient.verifyIdToken({
                    idToken: payload.idToken,
                    audience: clientId
                });

                const content = ticket.getPayload();
                if (!content) {
                    return null;
                }

                return {
                    providerId: content.sub,
                    email: content.email || "",
                    displayName: content.name || null,
                    photoUrl: content.picture || null
                };
            } catch (error) {
                console.error("Failed to verify Google ID token:", error);
                return null;
            }
        }
    };
}
