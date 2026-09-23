import type { AuthControllerExtended, MfaFactorSummary } from "@rebasepro/cms-types";

/**
 * A sign-in that is waiting for its second factor.
 *
 * The server refuses the first factor of an account with MFA enrolled with
 * `401 MFA_REQUIRED`, and puts in `details` what the second step needs: a
 * pending token, good for five minutes and for the two challenge routes only,
 * and the factors the account can answer with.
 */
export interface PendingMfaSignIn {
    mfaToken: string;
    factors: MfaFactorSummary[];
}

function isFactor(value: unknown): value is MfaFactorSummary {
    return typeof value === "object" && value !== null
        && "id" in value && typeof value.id === "string" && value.id.length > 0
        && "factorType" in value && typeof value.factorType === "string";
}

/**
 * The pending sign-in an `MFA_REQUIRED` refusal describes, or `null` for any
 * other error — including an `MFA_REQUIRED` without the token or a factor to
 * answer with, which no code step could finish.
 */
export function readMfaRequired(error: unknown): PendingMfaSignIn | null {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "MFA_REQUIRED") return null;
    const details = "details" in error ? error.details : undefined;
    if (typeof details !== "object" || details === null) return null;
    const mfaToken = "mfaToken" in details ? details.mfaToken : undefined;
    const factors = "factors" in details && Array.isArray(details.factors) ? details.factors.filter(isFactor) : [];
    if (typeof mfaToken !== "string" || !mfaToken || factors.length === 0) return null;
    return { mfaToken, factors };
}

/** Whether this controller can take a sign-in through its second step. */
export function canAnswerMfa(authController: AuthControllerExtended): boolean {
    return Boolean(authController.startMfaChallenge && authController.verifyMfaChallenge);
}

/**
 * What a refused challenge means for the code step.
 *
 * - `invalid-code`: the code was wrong; the same challenge takes another.
 * - `exhausted`: the challenge has had its five attempts; the next code needs
 *   a new one.
 * - `expired`: the sign-in itself is over. The pending token lasts five
 *   minutes from the password, and once it has lapsed both routes refuse the
 *   caller as unauthenticated; a challenge that lapsed, or a sign-in revoked
 *   meanwhile, ends the same way. Only a new sign-in gets a new token.
 */
export function classifyMfaRefusal(error: unknown): "invalid-code" | "exhausted" | "expired" | "other" {
    if (!(error instanceof Error)) return "other";
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
    if (code === "INVALID_CODE") return "invalid-code";
    if (code === "CHALLENGE_EXHAUSTED") return "exhausted";
    if (code === "INVALID_CHALLENGE" || code === "SESSION_REVOKED") return "expired";
    if (status === 401 && (code === undefined || code === "UNAUTHORIZED")) return "expired";
    return "other";
}
