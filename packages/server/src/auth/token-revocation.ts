import type { AuthRepository } from "./interfaces";
import type { AccessTokenPayload } from "./jwt";
import { logger } from "../utils/logger";

/**
 * Has this access token been revoked?
 *
 * Everything that ends every session a user holds — a password change or reset
 * of any kind, and `DELETE /auth/sessions` — goes through
 * {@link revokeAllSessions}, which stamps a `tokensValidAfter` watermark on the
 * user. It also deletes refresh-token rows, which is what made the gap easy to
 * miss: the session really is gone, and the *refresh* path really does check
 * the watermark — so signing out looked like it worked.
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

    // `iat` is whole seconds; the watermark is a millisecond timestamp. Compare
    // in seconds and floor the watermark, so a token issued in the same second
    // as the revocation is treated as revoked rather than surviving on a
    // rounding artefact.
    return issuedBefore(payload, validAfter);
}

/**
 * The repository reads {@link judgeAccessToken} may make. All optional: a
 * repository answers what it can, and the judge says what it could not ask.
 */
export type AccessJudgeRepository = Partial<Pick<AuthRepository,
    "getAccountAccessState" | "getUserWithRoles" | "getTokensValidAfter">>;

/**
 * Why an access token that verifies is not honoured.
 *
 * - `revoked`: issued before the account's revocation watermark — a sign-out
 *   everywhere, a password change or reset.
 * - `session-revoked`: its own sign-in was ended — `POST /auth/logout`, or
 *   `DELETE /auth/sessions/:id` from another device. Needs the token's `sid`.
 * - `account-deleted`: the account it names no longer exists.
 * - `account-disabled`: an administrator switched the account off.
 */
export type AccessTokenRefusal = "revoked" | "session-revoked" | "account-deleted" | "account-disabled";

export type AccessTokenVerdict =
    | {
        live: true;
        /**
         * The account's roles now, or `undefined` when the repository could
         * not say (it reads neither the account nor its roles).
         */
        roles?: string[];
    }
    | { live: false; refusal: AccessTokenRefusal };

/**
 * Is the account behind this verified access token still the one that may use
 * it — and with which roles?
 *
 * A verified signature says who the token was minted for, an hour ago at
 * most. This asks the database what has happened to that account since. Every
 * door that honours an access token — the data plane, the admin gates, the
 * realtime socket — asks it here, so they cannot disagree about it.
 *
 * They did. A deleted account read as "not revoked": the watermark lives on
 * the user row, so once the row was gone there was no watermark, and the
 * roles lookup answered `[]` rather than "nobody". A token its owner had
 * revoked came back to life when an administrator deleted the account, as an
 * authenticated principal with that uid, for the rest of its lifetime. MCP
 * refresh and personal API keys already treated a missing account as revoked;
 * the main door did not.
 *
 * Throws when the repository does. Unlike the watermark read on its own, this
 * one decides the roles a request runs with, so a failure is a refusal (the
 * callers answer 503) rather than a guess.
 */
export async function judgeAccessToken(
    authRepo: AccessJudgeRepository,
    payload: Pick<AccessTokenPayload, "uid" | "iat" | "sid">
): Promise<AccessTokenVerdict> {
    let roles: string[] | undefined;
    let validAfter: Date | null = null;

    if (typeof authRepo.getAccountAccessState === "function") {
        const state = await authRepo.getAccountAccessState(payload.uid, payload.sid);
        if (!state) return { live: false, refusal: "account-deleted" };
        if (state.disabled) return { live: false, refusal: "account-disabled" };
        roles = state.roles;
        validAfter = state.tokensValidAfter;
        // Only an explicit `false`: a token minted before `sid` existed, or a
        // store that cannot group sessions, is judged by the watermark alone.
        if (payload.sid && state.sessionActive === false) return { live: false, refusal: "session-revoked" };
    } else {
        if (typeof authRepo.getUserWithRoles === "function") {
            const account = await authRepo.getUserWithRoles(payload.uid);
            if (!account) return { live: false, refusal: "account-deleted" };
            if (account.user.disabled) return { live: false, refusal: "account-disabled" };
            roles = account.roles;
        }
        if (typeof authRepo.getTokensValidAfter === "function") {
            validAfter = await authRepo.getTokensValidAfter(payload.uid);
        }
    }

    if (issuedBefore(payload, validAfter)) return { live: false, refusal: "revoked" };
    return { live: true, roles };
}

/** The watermark comparison {@link isAccessTokenRevoked} and the judge share. */
function issuedBefore(payload: Pick<AccessTokenPayload, "iat">, validAfter: Date | null): boolean {
    // A token with no `iat` cannot be placed relative to the watermark; it
    // expires on its own. See `isAccessTokenRevoked`.
    if (!validAfter || typeof payload.iat !== "number") return false;
    return payload.iat < Math.floor(validAfter.getTime() / 1000);
}

/**
 * End every session this user holds, on every device.
 *
 * Two writes, because each covers what the other cannot. Deleting the refresh
 * rows ends the sessions that exist at this instant, and on a repository
 * without the watermark it is the only revocation there is. The watermark
 * voids what the delete cannot see: a refresh already in flight that inserts
 * its rotated token a moment after the delete ran, and every access token
 * already handed out, which {@link isAccessTokenRevoked} refuses from here on.
 *
 * The watermark write does not fail the caller. By the time it runs the
 * credential has usually already changed and the rows are gone, so a 500 would
 * tell someone their password did not change when it did. It is logged, because
 * a failure here leaves access tokens working until they expire.
 */
export async function revokeAllSessions(
    authRepo: Pick<AuthRepository, "deleteAllRefreshTokensForUser" | "setTokensValidAfter">,
    uid: string
): Promise<void> {
    await authRepo.deleteAllRefreshTokensForUser(uid);
    try {
        await authRepo.setTokensValidAfter?.(uid, new Date());
    } catch (error) {
        logger.warn("[Auth] Could not write the token revocation watermark; access tokens issued before now stay valid until they expire", {
            uid,
            error
        });
    }
}

/**
 * Replace a user's password and end every session they hold.
 *
 * The one way a password hash is written over an existing account. A new
 * password is what someone sets when they believe the old one — or a session
 * signed in with it — is in someone else's hands, so a password change that
 * leaves those sessions alive does not do the thing it was done for.
 *
 * It used to be a pair of lines repeated after each `updatePassword`, and it
 * reached the two self-service routes and none of the admin ones: an
 * administrator resetting a phished account left the attacker's refresh token
 * minting access tokens for the rest of its lifetime.
 * `test/password-change-revokes-sessions.test.ts` holds every route that sets a
 * password to this, and fails if anything but this function calls
 * `updatePassword`.
 *
 * `null` removes the password instead, for the same reason and with the same
 * revocation: see `confirmAddressOwnership`.
 */
export async function replaceUserPassword(
    authRepo: Pick<AuthRepository, "updatePassword" | "deleteAllRefreshTokensForUser" | "setTokensValidAfter">
        & Partial<Pick<AuthRepository, "deleteAllPasswordResetTokensForUser">>,
    uid: string,
    passwordHash: string | null
): Promise<void> {
    await authRepo.updatePassword(uid, passwordHash);
    await revokeAllSessions(authRepo, uid);
    // A reset link still in someone's inbox would set the password again for
    // the rest of its hour — the one just replaced, perhaps because a link
    // went to the wrong place. Every outstanding one goes with the old password.
    await authRepo.deleteAllPasswordResetTokensForUser?.(uid);
}
