/**
 * What happens when the owner of an address proves it for the first time.
 *
 * Nothing verifies the address an account is made with: `POST /auth/register`
 * takes whatever it is given, and so does a sign-in through a provider that
 * does not vouch for the address (Spotify and Facebook never do; Discord and
 * multi-tenant Microsoft sometimes do not). So anyone can make an account for
 * someone else's address and leave a way in on it — a password, or the
 * provider identity they signed up with — then wait for the owner.
 *
 * The owner turns up by proving the address: a magic link, an email code or a
 * password reset, each read out of their inbox. That proof used to mark the
 * account verified and leave the attacker's way in where it was, so the owner
 * and the attacker shared the account from then on. Now the proof also removes
 * everything on the account that nobody proved: the password, every identity
 * whose provider did not vouch for this address, and every session.
 *
 * @module
 */

import { normalizeEmail } from "@rebasepro/common";
import { ApiError } from "../api/errors";
import { logger } from "../utils/logger";
import type { AuthRepository, OAuthProviderProfile, UserData, UserIdentityData } from "./interfaces";
import { replaceUserPassword } from "./token-revocation";

/**
 * The profile stored with a linked OAuth identity.
 *
 * `emailVerified` is recorded so that a later proof of the address can tell an
 * identity whose provider vouched for it from one whose provider did not.
 */
export function identityProfileData(profile: OAuthProviderProfile): Record<string, unknown> {
    return { email: profile.email, emailVerified: profile.emailVerified === true };
}

/**
 * Did this identity's provider vouch for `email` when it was linked?
 *
 * Only whoever controls the inbox can hold a provider account that vouches for
 * the address, so such an identity is the owner's. An identity linked before
 * the flag was recorded reads as not vouching: it is detached, and if its
 * provider does vouch, the next sign-in with it links it again.
 */
export function identityVouchesForAddress(identity: UserIdentityData, email: string): boolean {
    const profile = identity.profileData;
    return profile?.emailVerified === true
        && typeof profile.email === "string"
        && normalizeEmail(profile.email) === normalizeEmail(email);
}

/**
 * Settle an account whose address its owner has just proven, and mark it
 * verified.
 *
 * Call it only for an account that is not yet verified, from a route that has
 * just consumed something mailed to the address. It detaches every identity
 * whose provider did not vouch for the address, sets the password to
 * `passwordHash` — the one the owner just chose on a reset, or `null` to remove
 * the one somebody else may have registered with — and ends every session, in
 * that order and before the account is marked verified.
 *
 * A repository that cannot detach an identity makes this refuse with 409 when
 * there is one to detach. Marking the account verified with the identity still
 * on it is the takeover itself, and leaving the account unverified while
 * signing the owner in would share the account all the same.
 */
export async function confirmAddressOwnership(
    authRepo: AuthRepository,
    user: Pick<UserData, "id" | "email" | "passwordHash">,
    passwordHash: string | null
): Promise<void> {
    const unproven = (await authRepo.getUserIdentities(user.id))
        .filter(identity => !identityVouchesForAddress(identity, user.email));

    if (unproven.length > 0) {
        if (typeof authRepo.unlinkUserIdentity !== "function") {
            logger.error("[Security Audit] Proof of address refused: the account has sign-in methods nobody proved, and this auth repository cannot remove them", {
                eventType: "auth.address_proof.refused",
                uid: user.id,
                providers: unproven.map(identity => identity.provider)
            });
            throw ApiError.conflict(
                "This account has sign-in methods that were added before its email address was verified, " +
                "and this backend cannot remove them. Ask an administrator to review the account.",
                "UNVERIFIED_IDENTITIES"
            );
        }
        for (const identity of unproven) {
            await authRepo.unlinkUserIdentity(user.id, identity.provider, identity.providerId);
        }
    }

    await replaceUserPassword(authRepo, user.id, passwordHash);
    await authRepo.setEmailVerified(user.id, true);

    if (unproven.length > 0 || user.passwordHash) {
        logger.info("[Security Audit] First proof of address removed sign-in methods nobody proved", {
            eventType: "auth.address_proof.cleared",
            uid: user.id,
            removedProviders: unproven.map(identity => identity.provider),
            replacedPassword: Boolean(user.passwordHash)
        });
    }
}
