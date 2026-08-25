/**
 * Email one-time codes: six digits, typed in, instead of a link to click.
 *
 * Magic link already logs somebody in from their inbox, and on a desktop it is
 * the better flow. It stops being the better flow the moment the two devices
 * are not the same one: the link opens the session on the phone that has the
 * mail, not on the television, the terminal, or the browser the person is
 * actually sitting in front of. A code crosses that gap because a human carries
 * it.
 *
 * ```
 * POST /auth/otp          { "email": "…" }             → always 200
 * POST /auth/otp/verify   { "email": "…", "code": "…" } → a session
 * ```
 *
 * ## Six digits is a small number, so the shape matters
 *
 * A million possibilities is nothing to a machine, which is why each of these
 * is load-bearing rather than decorative:
 *
 *  - **the code is bound to the address.** What is stored is a hash of
 *    `otp:<email>:<code>`, so `verify` needs both halves and there is no
 *    "guess any valid code in the system" — the search space is one account's,
 *    not the deployment's. A lookup keyed on the code alone would make every
 *    account in the database a target of the same million guesses;
 *  - **attempts are limited per address**, not only per IP. An IP is the
 *    attacker's to rotate and the account under attack is not — the same
 *    reasoning `mfaVerificationLimiter` is built on, and the same numbers;
 *  - **ten minutes**, and single use. The window is what the brute force gets;
 *  - **the digits are uniform.** `randomInt` rather than `random() * 1e6` or a
 *    modulo of random bytes, both of which make some codes likelier.
 *
 * ## Why it reuses the magic-link token store
 *
 * A one-time code and a magic-link token are the same object: a hashed secret
 * for one account, with an expiry and a used flag. Reusing the store means no
 * schema change, no second cleanup path, and no second place for "was this
 * already used?" to be answered differently. What is hashed differs, and that
 * is the whole difference — a code cannot be presented as a link token because
 * the hash carries `otp:` and the address.
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { randomInt } from "node:crypto";
import { z } from "zod";

import type { AuthModuleConfig } from "./routes";
import type { ResolvedAuthHooks } from "./auth-hooks";
import type { HonoEnv } from "../api/types";
import { ApiError } from "../api/errors";
import { hashToken } from "./admin-user-ops";
import { getEmailOtpTemplate, resolveEmailBranding } from "../email/templates";
import { createRateLimiter, strictAuthLimiter } from "./rate-limiter";
import { logger } from "../utils/logger";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";

/** How long a code is good for. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/** How many digits. Six is what people expect to be asked to type. */
const OTP_DIGITS = 6;

/** Verification attempts allowed per address per window. */
const OTP_ATTEMPTS_PER_WINDOW = 5;

/**
 * A uniformly random code, as a zero-padded string.
 *
 * `randomInt` over the whole range rather than digit-by-digit or a modulo of
 * random bytes: both of those are ways to make some codes likelier than others,
 * and one of them is the classic modulo bias.
 */
export function generateOtpCode(): string {
    return String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, "0");
}

/**
 * What gets hashed and stored.
 *
 * The address is part of the secret, which is what makes `verify` a question
 * about one account rather than about the whole table. Lower-cased and trimmed
 * so that the address the user types matches the one they were mailed at.
 */
export function otpTokenMaterial(email: string, code: string): string {
    return `otp:${email.trim().toLowerCase()}:${code}`;
}

/**
 * Per-address throttle on code verification.
 *
 * Keyed on the address rather than the IP, for the reason
 * `mfaVerificationLimiter` gives: an IP is the attacker's to rotate and the
 * account is not, so a distributed run against one address passes an IP-keyed
 * limiter untouched. `strictAuthLimiter` still runs in front — they bound
 * different things.
 *
 * Like every limiter here, this counts in the store the deployment configured:
 * per replica by default, shared with `REBASE_RATE_LIMIT_STORE=sql`. On several
 * replicas with the default, the effective budget is five attempts per replica.
 */
const otpVerificationLimiter: MiddlewareHandler<HonoEnv> = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: OTP_ATTEMPTS_PER_WINDOW,
    keyGenerator: (c) => {
        const email = (c.get("otpEmail") as string | undefined) ?? "unidentified";
        return `otp-verify:${email}`;
    },
    message: "Too many verification attempts for this account, please try again later."
});

/**
 * Read the address out of the body and put it where the limiter can key on it.
 *
 * The limiter runs before the handler, and Hono has already consumed nothing —
 * so this parses the JSON body first, stashes the address, and lets the handler
 * re-read it from the same cached request. Without it the limiter has no
 * account to key on and falls back to one global bucket, which is a limiter in
 * name only.
 */
const captureOtpEmail: MiddlewareHandler<HonoEnv> = async (c, next) => {
    try {
        const body = await c.req.raw.clone().json() as { email?: unknown };
        if (typeof body?.email === "string") {
            c.set("otpEmail", body.email.trim().toLowerCase());
        }
    } catch {
        // A malformed body is the handler's error to report, with the message
        // that names the field. Failing here would answer 429 to bad JSON.
    }
    await next();
};

export function mountOtpRoutes(deps: {
    router: Hono<HonoEnv>;
    config: AuthModuleConfig;
    ops: ResolvedAuthHooks;
    parseBody: <T>(schema: z.ZodSchema<T>, body: unknown) => T;
    buildAuthResponse: (
        user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; emailVerified?: boolean; isAnonymous?: boolean; metadata?: Record<string, unknown> | null },
        roleIds: string[],
        accessToken: string,
        refreshToken: string,
        providerId: string
    ) => unknown;
    createSessionAndTokens: (uid: string, userAgent: string, ipAddress: string) => Promise<{ roleIds: string[]; accessToken: string; refreshToken: string }>;
    applyTransformHook: (
        response: AuthResponsePayload,
        method: TransformAuthResponseContext["method"],
        request: Request,
        uid: string
    ) => Promise<AuthResponsePayload>;
    /** Built by the caller, as for magic link. Absent when captcha is off. */
    captchaMiddleware?: MiddlewareHandler<HonoEnv>;
}) {
    const { router, config, ops, parseBody, buildAuthResponse, createSessionAndTokens, applyTransformHook, captchaMiddleware } = deps;
    const { authRepo, emailService, emailConfig } = config;

    const requestSchema = z.object({
        email: z.string().email("Invalid email address").max(255)
    });

    const verifySchema = z.object({
        email: z.string().email("Invalid email address").max(255),
        code: z.string().regex(/^\d{6}$/, "A code is six digits")
    });

    const isEmailConfigured = (): boolean => !!(emailService && emailService.isConfigured());

    /**
     * POST /auth/otp — send a code.
     *
     * Answers the same thing whether or not the address has an account. The
     * alternative is an oracle that turns this endpoint into a way to ask "is
     * this person a customer?", one address at a time.
     */
    router.post("/otp", strictAuthLimiter, ...(captchaMiddleware ? [captchaMiddleware] : []), async (c) => {
        const { email } = parseBody(requestSchema, await c.req.json());

        if (!isEmailConfigured()) {
            throw ApiError.serviceUnavailable(
                "Email service not configured. One-time code login is not available.",
                "EMAIL_NOT_CONFIGURED"
            );
        }

        const user = await authRepo.getUserByEmail(email);

        if (user) {
            if (ops.beforeLogin) {
                await ops.beforeLogin(email, "otp");
            }

            const code = generateOtpCode();
            await authRepo.createMagicLinkToken(
                user.id,
                hashToken(otpTokenMaterial(user.email, code)),
                new Date(Date.now() + OTP_TTL_MS)
            );

            const { appName, logoUrl } = resolveEmailBranding(emailConfig);
            const templateFn = emailConfig?.templates?.emailOtp;
            const content = templateFn
                ? templateFn(code, { email: user.email, displayName: user.displayName })
                : getEmailOtpTemplate(
                    code,
                    { email: user.email, displayName: user.displayName },
                    appName,
                    logoUrl
                );

            try {
                await emailService!.send({
                    to: user.email,
                    subject: content.subject,
                    html: content.html,
                    text: content.text
                });
            } catch (emailError: unknown) {
                // Not reported to the caller: the answer must not depend on
                // whether the address exists, and a delivery failure is one of
                // the ways it could.
                logger.error("Failed to send one-time code email", {
                    error: emailError instanceof Error ? emailError.message : emailError
                });
            }
        }

        return c.json({
            success: true,
            message: "If an account with that email exists, a sign-in code has been sent.",
            expiresInSeconds: OTP_TTL_MS / 1000
        });
    });

    /**
     * POST /auth/otp/verify — trade a code for a session.
     */
    router.post("/otp/verify", strictAuthLimiter, captureOtpEmail, otpVerificationLimiter, async (c) => {
        const { email, code } = parseBody(verifySchema, await c.req.json());

        // The lookup and the binding are the same act: a hash that does not
        // include this address cannot be found by this request.
        const tokenHash = hashToken(otpTokenMaterial(email, code));
        const storedToken = await authRepo.findValidMagicLinkToken(tokenHash);

        if (!storedToken) {
            throw ApiError.badRequest("Invalid or expired code", "INVALID_CODE");
        }

        await authRepo.markMagicLinkTokenUsed(tokenHash);

        const user = await authRepo.getUserById(storedToken.uid);
        if (!user) {
            throw ApiError.badRequest("Invalid or expired code", "INVALID_CODE");
        }

        // Reading a code out of the inbox proves the address, exactly as
        // following a link does.
        if (!user.emailVerified) {
            await authRepo.setEmailVerified(user.id, true);
            user.emailVerified = true;
        }

        const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
            user.id,
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown"
        );

        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "otp").catch(err => {
                logger.error("[AuthHooks] onAuthenticated error", {
                    error: err instanceof Error ? err.message : err
                });
            });
        }

        const authResponse = buildAuthResponse(user, roleIds, accessToken, refreshToken, "otp") as AuthResponsePayload;
        const finalResponse = await applyTransformHook(authResponse, "otp", c.req.raw, user.id);
        return c.json(finalResponse);
    });
}

