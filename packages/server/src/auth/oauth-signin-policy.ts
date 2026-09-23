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
    | "local-account-unverified"
    /**
     * The local account has no password, and its address was never proven
     * either: it was made by a sign-in through a provider that did not vouch
     * for the address, or by someone who never had to. Its sign-in methods are
     * whatever that someone attached, so this is the same pre-hijack as a
     * password would be. Reported apart from `local-account-unverified` only
     * so a login screen does not tell its owner to use a password.
     */
    | "local-account-unverified-passwordless";

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
 * Both sides have to be trustworthy:
 *
 *  - the **provider** must have verified the address, or the caller has not
 *    shown they control it;
 *  - the **local account**'s address must have been verified too. Whoever
 *    made an unverified account never proved the address, and every way in
 *    they left on it — a password, an identity from a provider that did not
 *    vouch for the address — would go on opening the account the owner is
 *    about to be signed into.
 *
 * The second rule used to exempt an account with no password, on the theory
 * that one made by an OAuth sign-in holds no credential an attacker could have
 * planted. It holds exactly one: the identity it was made with, which is an
 * attacker's whenever the provider did not vouch for the address.
 *
 * A refusal is not a dead end. `POST /auth/link/<provider>` attaches the
 * identity once the caller proves ownership by holding a session, and proving
 * the address (a magic link, an email code, a password reset) verifies the
 * account — removing what nobody proved — after which this answers yes.
 */
export function decideOAuthAutoLink(args: {
    providerEmailVerified: boolean | undefined;
    existingUser: AutoLinkExistingUser;
}): AutoLinkDecision {
    if (args.providerEmailVerified !== true) {
        return { allowed: false, reason: "provider-email-unverified" };
    }
    if (!args.existingUser.emailVerified) {
        return {
            allowed: false,
            reason: args.existingUser.passwordHash ? "local-account-unverified" : "local-account-unverified-passwordless"
        };
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
