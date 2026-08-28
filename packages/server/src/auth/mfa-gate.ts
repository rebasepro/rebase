/**
 * The gate between "first factor accepted" and "session issued".
 *
 * MFA used to be modelled as an optional step-up that no resource required: a
 * user could enrol TOTP, print recovery codes, and change nothing about what a
 * stolen password bought, because every session-minting route issued a full
 * `aal1` token without ever asking whether the account had a second factor.
 * This module is the ask. It lives apart from the routes so that there is one
 * decision, made once, that `createSessionAndTokens` cannot be extended past —
 * a new sign-in route inherits the gate by construction rather than by the
 * author remembering it.
 *
 * @module
 */

import { ApiError } from "../api/errors";
import { logger } from "../utils/logger";
import { generateMfaPendingToken } from "./jwt";
import type { AuthRepository } from "./interfaces";

/** Error code a client watches for to switch a sign-in into its second step. */
export const MFA_REQUIRED_CODE = "MFA_REQUIRED";

/** Shape carried in `error.details` of an {@link MFA_REQUIRED_CODE} response. */
export interface MfaRequiredDetails {
    /**
     * Short-lived, purpose-scoped credential proving the first factor was
     * accepted. It is refused as a session everywhere (`verifyAccessToken`
     * rejects purpose-scoped tokens); `POST /auth/mfa/challenge` and
     * `POST /auth/mfa/challenge/verify` are the only routes that accept it.
     */
    mfaToken: string;
    /** The verified factors the caller may answer the challenge with. */
    factors: Array<{ id: string; factorType: string; friendlyName?: string }>;
}

/**
 * Refuse to mint a session for an account whose second factor has not been
 * presented, handing back what the client needs to present it.
 *
 * A 401 rather than a 200 with a different body: a client that has not been
 * taught about MFA must fail, not proceed. The credential in `details` is
 * useless for anything except the challenge routes.
 */
export async function assertMfaSatisfied(authRepo: AuthRepository, uid: string): Promise<void> {
    if (typeof authRepo.hasVerifiedMfaFactors !== "function") {
        // A custom repository from before MFA existed. It cannot hold a factor
        // either, so there is nothing to enforce — but say so once, because a
        // repository that *does* have factors and no way to report them would
        // be a silent bypass.
        logger.warn("[MFA] Auth repository cannot report enrolled factors; the login step-up gate is inert on this backend");
        return;
    }

    if (!(await authRepo.hasVerifiedMfaFactors(uid))) return;

    const factors = (await authRepo.getMfaFactors(uid)).filter(f => f.verified);
    const details: MfaRequiredDetails = {
        mfaToken: await generateMfaPendingToken(uid),
        factors: factors.map(f => ({ id: f.id,
factorType: f.factorType,
friendlyName: f.friendlyName }))
    };

    logger.info("[Security Audit] MFA step-up required", {
        eventType: "auth.mfa.required",
        uid
    });

    throw new ApiError(
        401,
        MFA_REQUIRED_CODE,
        "Multi-factor authentication is required to complete sign-in.",
        details,
        // Routine: every sign-in by an enrolled user takes this path.
        true
    );
}
