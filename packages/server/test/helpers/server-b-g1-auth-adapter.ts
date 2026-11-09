import type { AuthAdapter, AuthAdapterCapabilities } from "@rebasepro/types";

/** What an adapter with no built-in auth routes can do: nothing but verify. */
export const NO_CAPABILITIES: AuthAdapterCapabilities = {
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
 * A complete `AuthAdapter` around the `verifyRequest` a test supplies, with id
 * `"fake"` and {@link NO_CAPABILITIES}. Unlike `createCustomAuthAdapter`, it
 * adds nothing the test did not pass — no synthesized `verifyToken` — so the
 * optional members the code under test branches on are exactly the test's.
 */
export function fakeAuthAdapter(adapter: Partial<AuthAdapter> & Pick<AuthAdapter, "verifyRequest">): AuthAdapter {
    return {
        id: "fake",
        getCapabilities: () => NO_CAPABILITIES,
        ...adapter
    };
}
