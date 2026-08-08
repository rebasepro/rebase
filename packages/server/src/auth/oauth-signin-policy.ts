/**
 * The two decisions the OAuth sign-in route makes before it will hand a caller
 * an existing account, extracted so they are stated once for all twelve
 * providers and can be tested without a provider, a network or a database.
 */

/** Why an incoming OAuth identity may not be auto-attached to an existing account. */
export type AutoLinkRefusal =
    /** The provider did not report that it verified the address. */
    | "provider-email-unverified"
    /**
     * The local account holds a password nobody ever proved they own: it was
     * created through `POST /auth/register`, which does not verify the
     * address. Attaching a provider identity to it would hand the session to
     * whoever registered the address first — the classic pre-hijack.
     */
    | "local-account-unverified";

export type AutoLinkDecision =
    | { allowed: true }
    | { allowed: false; reason: AutoLinkRefusal };

/** The part of an existing user row the decision depends on. */
export interface AutoLinkExistingUser {
    emailVerified: boolean;
    passwordHash?: string | null;
}

/**
 * May an OAuth identity be attached to a pre-existing account found *by email*?
 *
 * Both sides have to be trustworthy, and only one of them used to be checked:
 *
 *  - the **provider** must have verified the address, or the caller has not
 *    shown they control it;
 *  - the **local account** must itself be trustworthy — either its address was
 *    verified, or it has no password at all (it was created by an OAuth
 *    sign-in or an invitation, so there is no credential an attacker could
 *    have planted in advance).
 *
 * A refusal is not a dead end: `POST /auth/link/<provider>` attaches the
 * identity once the caller proves ownership by holding a session.
 */
export function decideOAuthAutoLink(args: {
    providerEmailVerified: boolean | undefined;
    existingUser: AutoLinkExistingUser;
}): AutoLinkDecision {
    if (args.providerEmailVerified !== true) {
        return { allowed: false, reason: "provider-email-unverified" };
    }
    const hasPassword = Boolean(args.existingUser.passwordHash);
    if (hasPassword && !args.existingUser.emailVerified) {
        return { allowed: false, reason: "local-account-unverified" };
    }
    return { allowed: true };
}

/**
 * Is `redirectUri` one the operator authorised?
 *
 * The provider's own registered-URI match is a real control but a coarse one:
 * it authorises *every* URI registered on that OAuth client, so a `localhost`
 * entry kept for development, or a second product sharing the client id, can
 * mint codes this backend accepts. An empty or absent allowlist keeps the old
 * behaviour (the provider's check is the only one) so existing deployments are
 * unaffected; setting one narrows it to the origins this backend serves.
 *
 * Comparison is on origin plus path, with the origin lowercased and a trailing
 * slash ignored — query strings and fragments are not part of the identity of a
 * redirect URI, and neither is the case of the host.
 */
export function isRedirectUriAllowed(redirectUri: string, allowlist?: string[]): boolean {
    if (!allowlist || allowlist.length === 0) return true;
    const candidate = canonicalRedirectUri(redirectUri);
    if (!candidate) return false;
    return allowlist.some((allowed) => canonicalRedirectUri(allowed) === candidate);
}

function canonicalRedirectUri(uri: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(uri);
    } catch {
        return null;
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}`;
}
