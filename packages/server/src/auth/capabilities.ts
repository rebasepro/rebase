/**
 * The `GET /auth/config` payload, assembled in exactly one place.
 *
 * Two handlers used to claim that path — `init.ts` registers it directly and
 * only afterwards mounts the auth router, so the router's copy never ran — and
 * they returned *different shapes*: one reported `emailServiceEnabled` and
 * `magicLinkEnabled`, the other `passwordReset` and `magicLink`. A fix applied
 * to the shadowed copy therefore changed nothing, twice.
 *
 * The router's copy is gone. This module is what the surviving handler calls,
 * so the payload has one definition and one set of rules — the same move
 * `registration-policy.ts` makes for the predicate itself.
 */

import type { AuthAdapterCapabilities } from "@rebasepro/types";
import { isAnonymousAuthOpen, isRegistrationOpen } from "./registration-policy";

/** Everything the built-in payload is derived from. */
export interface BuiltinAuthCapabilityInputs {
    /**
     * True when the user table is empty — the first-user bootstrap window.
     *
     * The caller resolves this, because how you count users is the adapter's
     * business and it is also reported verbatim as `needsSetup`.
     */
    needsSetup: boolean;
    /** Steady-state self-registration. */
    allowRegistration?: boolean;
    /** The hard kill switch: blocks registration and anonymous sign-in alike. */
    disableSelfRegistration?: boolean;
    /** Opt-in `POST /auth/anonymous`. */
    allowAnonymous?: boolean;
    /** Magic-link login. Needs an email service to be of any use. */
    enableMagicLink?: boolean;
    /**
     * Whether an email service is configured.
     *
     * Every email-borne flow hangs off this — password reset, verification and
     * magic link are advertised only when a message can actually be sent.
     */
    emailConfigured: boolean;
    /** OAuth provider ids the backend has wired, e.g. `["google", "github"]`. */
    enabledProviders: string[];
}

/**
 * Build the capability document for the built-in auth adapter.
 *
 * Every flag is a *runtime* answer, not a compile-time feature list: what this
 * advertises, the matching route must accept. `registrationEnabled` and
 * `anonymousLogin` go through the shared predicates for exactly that reason.
 */
export function buildBuiltinAuthCapabilities(
    inputs: BuiltinAuthCapabilityInputs
): AuthAdapterCapabilities {
    const {
        needsSetup,
        allowRegistration,
        disableSelfRegistration,
        allowAnonymous,
        enableMagicLink,
        emailConfigured,
        enabledProviders
    } = inputs;

    return {
        hasBuiltInAuthRoutes: true,
        emailPasswordLogin: true,
        registrationEnabled: isRegistrationOpen({
            disableSelfRegistration,
            allowRegistration,
            needsSetup
        }),
        passwordReset: emailConfigured,
        // Always available: createAdminRoutes() unconditionally mounts the
        // reset-password route, which falls back to returning a one-time
        // temporary password when no email service is configured.
        adminPasswordReset: true,
        sessionManagement: true,
        profileUpdate: true,
        emailVerification: emailConfigured,
        magicLink: !!enableMagicLink && emailConfigured,
        // A capability that exists and is not in the capability surface is how a
        // client ends up calling a route it cannot discover is off.
        anonymousLogin: isAnonymousAuthOpen({ allowAnonymous, disableSelfRegistration }),
        enabledProviders,
        needsSetup
    };
}
