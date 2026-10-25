/**
 * The two decisions the OAuth sign-in route makes before it will hand a caller
 * an existing account, extracted so they are stated once for all twelve
 * providers and can be tested without a provider, a network or a database.
 */

/** Why an incoming OAuth identity may not be auto-attached to an existing account. */
export type AutoLinkRefusal =
    /** The provider did not report that it verified the address. */
    | "provider-email-unverified";

export type AutoLinkDecision =
    | {
        allowed: true;
        /**
         * The local account's address was never proven, and this sign-in
         * proves it. The route settles the account the way an email code does
         * (`confirmAddressOwnership`) before it links the identity: the
         * password and every identity whose provider did not vouch for the
         * address go, and every session ends.
         */
        provesAddress: boolean;
    }
    | { allowed: false; reason: AutoLinkRefusal };

/** The part of an existing user row the decision depends on. */
export interface AutoLinkExistingUser {
    emailVerified: boolean;
    passwordHash?: string | null;
}

/**
 * May an OAuth identity be attached to a pre-existing account found *by email*?
 *
 * Only when the **provider** verified the address. Otherwise the caller has
 * not shown they control it, and linking would hand them the account.
 *
 * When it did, the caller has proven the address exactly as reading a code out
 * of the inbox does: only the inbox's owner can hold a provider account that
 * vouches for it. If the **local account**'s address was never verified,
 * whoever made it never proved the address, and every way in they left on it —
 * a password, an identity from a provider that did not vouch for the address,
 * a live session — would go on opening the account the owner is about to be
 * signed into. So that case answers `provesAddress: true`, and the route
 * removes those ways in before it links (the pre-hijack defence). It used to
 * refuse instead, which left the owner of the address locked out of their own
 * address until they found a magic link or a reset.
 */
export function decideOAuthAutoLink(args: {
    providerEmailVerified: boolean | undefined;
    existingUser: AutoLinkExistingUser;
}): AutoLinkDecision {
    if (args.providerEmailVerified !== true) {
        return { allowed: false, reason: "provider-email-unverified" };
    }
    return { allowed: true, provesAddress: !args.existingUser.emailVerified };
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
