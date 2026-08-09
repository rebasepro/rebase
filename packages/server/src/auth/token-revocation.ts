import type { AuthRepository } from "./interfaces";
import type { AccessTokenPayload } from "./jwt";
import { logger } from "../utils/logger";

/**
 * Has this access token been revoked?
 *
 * `logout`, `change-password`, `reset-password` and `DELETE /auth/sessions` all
 * stamp a `tokensValidAfter` watermark on the user. Every one of them also
 * deletes refresh-token rows, which is what made the gap easy to miss: the
 * session really is gone, and the *refresh* path really does check the
 * watermark — so signing out looked like it worked.
 *
 * The access token was untouched. It is a bearer credential that nothing
 * consulted a database about, so it stayed valid for its full lifetime after
 * every one of those actions. "Sign out everywhere" left the stolen token
 * working; so did changing your password because you thought it had leaked.
 *
 * The watermark had exactly one read in the repository, on refresh. This adds
 * the other one.
 *
 * ## Cost
 *
 * One indexed lookup per request, on the paths that already make one. The
 * adapter re-reads roles for every authenticated request; the admin routes now
 * do too. Both call this with the row they were already fetching in mind — a
 * repository that wants to serve both from one query is free to cache
 * internally, but nothing here assumes it.
 *
 * ## Failure
 *
 * Fails **open**, deliberately, and this is the one place in the auth stack
 * where that is right. The watermark is an extra revocation signal layered over
 * a token that has already been verified — signature, expiry and purpose all
 * checked. Refusing every request when the database is unreachable would turn a
 * transient outage into a total sign-out of an entire deployment, and the
 * attacker this protects against needs to have already stolen a live token. The
 * failure is logged at warn so it is visible rather than silent.
 */
export async function isAccessTokenRevoked(
    authRepo: Pick<AuthRepository, "getTokensValidAfter">,
    payload: Pick<AccessTokenPayload, "uid" | "iat">
): Promise<boolean> {
    // A repository that does not implement the watermark cannot revoke, and
    // says so by absence. Nothing to check.
    if (typeof authRepo.getTokensValidAfter !== "function") return false;

    // A token with no `iat` cannot be placed relative to the watermark. Tokens
    // minted before `iat` was carried through verification are in this class,
    // and they expire on their own; treating them as revoked would sign out
    // every live session on deploy.
    if (typeof payload.iat !== "number") return false;

    let validAfter: Date | null;
    try {
        validAfter = await authRepo.getTokensValidAfter(payload.uid);
    } catch (error) {
        logger.warn("[Auth] Could not read the token revocation watermark; allowing the request", {
            uid: payload.uid,
            error
        });
        return false;
    }

    if (!validAfter) return false;

    // `iat` is whole seconds; the watermark is a millisecond timestamp. Compare
    // in seconds and floor the watermark, so a token issued in the same second
    // as the revocation is treated as revoked rather than surviving on a
    // rounding artefact.
    const issuedAtSec = payload.iat;
    const revokedFromSec = Math.floor(validAfter.getTime() / 1000);
    return issuedAtSec < revokedFromSec;
}
