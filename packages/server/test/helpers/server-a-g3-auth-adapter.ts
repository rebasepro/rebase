/**
 * A complete `AuthAdapter` around the one method a test cares about.
 *
 * Tests of the auth middleware hand it an adapter that only verifies requests;
 * the interface also requires an `id` and `getCapabilities`, which those doors
 * never read. This fills them with an inert adapter's answers — no built-in
 * routes, no login methods — so the fixture is a real `AuthAdapter` rather
 * than a partial one cast into the type.
 */
import type { AuthAdapter, AuthAdapterCapabilities } from "@rebasepro/types";

/** What an adapter with no sign-in surface of its own offers: nothing. */
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

export function testAuthAdapter(members: Pick<AuthAdapter, "verifyRequest"> & Partial<AuthAdapter>): AuthAdapter {
    return {
        id: "test",
        getCapabilities: () => NO_CAPABILITIES,
        ...members
    };
}
