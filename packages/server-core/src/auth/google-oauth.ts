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
 * Creates a Google OAuth Provider integration.
 * Supports both ID-token verification (One Tap / renderButton) and
 * access-token verification (popup via initTokenClient).
 */
export function createGoogleProvider(clientId: string): OAuthProvider<{ idToken?: string; accessToken?: string }> {
    const googleClient = new OAuth2Client(clientId);

    return {
        id: "google",
        schema: z.object({
            idToken: z.string().min(1).optional(),
            accessToken: z.string().min(1).optional()
        }).refine(
            (data) => data.idToken || data.accessToken,
            { message: "Either idToken or accessToken is required" }
        ),
        verify: async (payload: { idToken?: string; accessToken?: string }): Promise<OAuthProviderProfile | null> => {
            try {
                // Path 1: verify an ID token (legacy / One Tap)
                if (payload.idToken) {
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
                }

                // Path 2: verify an access token via Google's userinfo endpoint
                if (payload.accessToken) {
                    const res = await fetch(
                        "https://www.googleapis.com/oauth2/v3/userinfo",
                        { headers: { Authorization: `Bearer ${payload.accessToken}` } }
                    );
                    if (!res.ok) {
                        console.error("Google userinfo request failed:", res.status);
                        return null;
                    }
                    const info = await res.json() as {
                        sub: string;
                        email?: string;
                        name?: string;
                        picture?: string;
                    };
                    if (!info.sub || !info.email) {
                        return null;
                    }
                    return {
                        providerId: info.sub,
                        email: info.email,
                        displayName: info.name || null,
                        photoUrl: info.picture || null
                    };
                }

                return null;
            } catch (error) {
                console.error("Failed to verify Google token:", error);
                return null;
            }
        }
    };
}

