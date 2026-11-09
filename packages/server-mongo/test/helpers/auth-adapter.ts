import type { AuthAdapter, AuthAdapterCapabilities, AuthenticatedUser } from "@rebasepro/types";

/** An external provider's capabilities: it serves no auth routes of its own. */
const NO_BUILT_IN_AUTH: AuthAdapterCapabilities = {
    hasBuiltInAuthRoutes: false,
    emailPasswordLogin: false,
    registrationEnabled: false,
    passwordReset: false,
    adminPasswordReset: false,
    sessionManagement: false,
    profileUpdate: false,
    emailVerification: false,
    magicLink: false,
    anonymousLogin: false,
    enabledProviders: []
};

/**
 * An adapter that authenticates by token alone, the way an external identity
 * provider does: `verifyToken` decides, and a bare request carries no session.
 */
export function tokenAuthAdapter(
    verifyToken: (token: string) => Promise<AuthenticatedUser | null>,
    verifyRequest: (request: Request) => Promise<AuthenticatedUser | null> = async () => null
): AuthAdapter {
    return {
        id: "test-tokens",
        verifyRequest,
        verifyToken,
        getCapabilities: () => NO_BUILT_IN_AUTH
    };
}
