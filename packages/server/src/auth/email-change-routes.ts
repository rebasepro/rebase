/**
 * A signed-in user changes their own email address.
 *
 * `POST /auth/change-email { newEmail }` records the change and mails a link to
 * the new address, and a notice without a link to the old one.
 * `POST /auth/confirm-email-change { token }` — the link's landing screen calls
 * it — moves the account onto the new address.
 *
 * The address moves only when its inbox answers, so the account is never
 * pointed at an address nobody proved, and nothing is reserved meanwhile: a
 * pending change that held the address would let any account keep a stranger
 * from signing up with their own address. Whoever has the address when the link
 * is followed keeps it, and the link answers 409.
 *
 * On confirmation the address is the account's, verified. The identities whose
 * provider vouched for the old address are detached: the old address may be
 * the reason for the change — a job left, an inbox lost — and whoever controls
 * it now would otherwise sign in through that provider. The sessions stay: the
 * change was asked for from one, and the link proves the new inbox, not
 * anything about the others.
 *
 * @module
 */

import { Hono } from "hono";
import { z } from "zod";
import { normalizeEmail } from "@rebasepro/common";
import { ApiError } from "../api/errors";
import type { HonoEnv } from "../api/types";
import type { MiddlewareHandler } from "hono";
import { logger } from "../utils/logger";
import { getEmailChangeNoticeTemplate, getEmailChangeTemplate, resolveEmailBranding } from "../email/templates";
import { resolveEmailLinkBase } from "../email/link-base";
import { generateSecureToken, hashToken } from "./admin-user-ops";
import { identityVouchesForAddress } from "./address-ownership";
import type { resolveAuthHooks } from "./auth-hooks";
import type { AccessTokenPayload } from "./jwt";
import { strictAuthLimiter, verificationEmailLimiter } from "./rate-limiter";
import { isDeliverableAddress } from "./deliverable-address";
import type { AuthModuleConfig } from "./routes";

/** How long an address-change link stays usable. */
export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

interface EmailChangeRoutesConfig {
    router: Hono<HonoEnv>;
    config: AuthModuleConfig;
    ops: ReturnType<typeof resolveAuthHooks>;
    parseBody: <T>(schema: z.ZodSchema<T>, body: unknown) => T;
    /** A signed-in user, with the revocation watermark consulted. */
    requireLiveSession: MiddlewareHandler<HonoEnv>;
}

export function mountEmailChangeRoutes(opts: EmailChangeRoutesConfig): void {
    const { router, config, ops, parseBody, requireLiveSession } = opts;
    const authRepo = config.authRepo;
    const { emailService, emailConfig } = config;

    const changeSchema = z.object({
        newEmail: z.string().email("Invalid email address").max(255)
    });
    const confirmSchema = z.object({
        token: z.string().min(1, "Token is required")
    });

    /** The repository's address-change methods, or a 501 saying it has none. */
    function emailChangeStore() {
        const { setPendingEmailChange, findPendingEmailChange, applyPendingEmailChange } = authRepo;
        if (!setPendingEmailChange || !findPendingEmailChange || !applyPendingEmailChange) {
            throw new ApiError(501, "NOT_SUPPORTED", "This backend's auth repository cannot change an account's email address.");
        }
        return {
            setPendingEmailChange: setPendingEmailChange.bind(authRepo),
            findPendingEmailChange: findPendingEmailChange.bind(authRepo),
            applyPendingEmailChange: applyPendingEmailChange.bind(authRepo)
        };
    }

    /**
     * POST /auth/change-email { newEmail }
     *
     * Two limiters, as on `/send-verification`: per address of the caller's
     * machine, and per account, which is what bounds the mail one account can
     * have sent to addresses of its choosing.
     */
    router.post("/change-email", strictAuthLimiter, requireLiveSession, verificationEmailLimiter, async (c) => {
        const userCtx = c.get("user") as AccessTokenPayload | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }
        const { newEmail } = parseBody(changeSchema, await c.req.json());
        const store = emailChangeStore();
        if (!emailService?.isConfigured()) {
            throw ApiError.serviceUnavailable("Email service not configured. The confirmation link cannot be sent.", "EMAIL_NOT_CONFIGURED");
        }

        const user = await authRepo.getUserById(userCtx.uid);
        if (!user) {
            throw ApiError.notFound("User not found");
        }
        if (user.isAnonymous) {
            throw ApiError.forbidden("A guest has no address to change. Make it an account first (POST /auth/anonymous/link).", "ANONYMOUS_USER");
        }
        // Moving the address moves where every reset link and magic link
        // goes, so it is held to what changing a factor is held to.
        if (userCtx.aal !== "aal2" && await authRepo.hasVerifiedMfaFactors(user.id)) {
            throw ApiError.forbidden(
                "This account has a second factor. Sign in with it before changing the email address.",
                "AAL2_REQUIRED"
            );
        }

        const email = normalizeEmail(newEmail);
        if (email === normalizeEmail(user.email)) {
            throw ApiError.badRequest("That is already this account's email address.", "EMAIL_UNCHANGED");
        }
        if (!isDeliverableAddress(email)) {
            throw ApiError.conflict("No mail reaches that address.", "UNDELIVERABLE_ADDRESS");
        }
        if (await authRepo.getUserByEmail(email)) {
            throw ApiError.conflict("Email already registered", "EMAIL_EXISTS");
        }
        if (ops.beforeEmailChange) {
            await ops.beforeEmailChange(user, email);
        }

        const token = generateSecureToken();
        await store.setPendingEmailChange(user.id, { email, tokenHash: hashToken(token) });

        const confirmUrl = `${resolveEmailLinkBase(emailConfig, "verifyEmail")}/confirm-email-change?token=${token}`;
        const { appName, logoUrl } = resolveEmailBranding(emailConfig);
        const recipient = { email: user.email, displayName: user.displayName };
        const confirmation = emailConfig?.templates?.emailChange
            ? emailConfig.templates.emailChange(confirmUrl, recipient, email)
            : getEmailChangeTemplate(confirmUrl, recipient, email, appName, logoUrl);
        // Awaited: the caller asked for this mail, and is told when it could
        // not be sent rather than left waiting for one that will not come.
        await emailService.send({ to: email, subject: confirmation.subject, html: confirmation.html, text: confirmation.text });

        // The old address hears of it, without a link. Not awaited: a notice
        // that fails does not undo the request.
        if (isDeliverableAddress(user.email)) {
            const notice = emailConfig?.templates?.emailChangeNotice
                ? emailConfig.templates.emailChangeNotice(recipient, email)
                : getEmailChangeNoticeTemplate(recipient, email, appName, logoUrl);
            emailService.send({ to: user.email, subject: notice.subject, html: notice.html, text: notice.text }).catch((err: unknown) => {
                logger.error("Failed to send the email change notice", { error: err instanceof Error ? err.message : err });
            });
        }

        logger.info("[Security Audit] Email change requested", {
            eventType: "auth.email_change.requested",
            uid: user.id
        });
        return c.json({
            success: true,
            pendingEmail: email,
            expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS).toISOString()
        });
    });

    /**
     * POST /auth/confirm-email-change { token }
     *
     * No session: the link is often opened on another device, and it proves
     * the new inbox, which is all this needs.
     */
    router.post("/confirm-email-change", strictAuthLimiter, async (c) => {
        const { token } = parseBody(confirmSchema, await c.req.json());
        const store = emailChangeStore();
        const tokenHash = hashToken(token);
        const invalid = () => ApiError.badRequest("Invalid or expired email change link", "INVALID_TOKEN");

        const found = await store.findPendingEmailChange(tokenHash);
        if (!found || Date.now() - found.change.sentAt.getTime() > EMAIL_CHANGE_TTL_MS) {
            throw invalid();
        }
        const { user } = found;
        const previousEmail = user.email;

        // Settled before the address moves, so a backend that cannot detach
        // them refuses with nothing changed rather than moving the address
        // and leaving the old address's way in on the account.
        const vouchingForOld = (await authRepo.getUserIdentities(user.id))
            .filter(identity => identityVouchesForAddress(identity, previousEmail));
        if (vouchingForOld.length > 0 && typeof authRepo.unlinkUserIdentity !== "function") {
            throw ApiError.conflict(
                "This account signs in through a provider that vouched for its current address, and this backend " +
                "cannot detach it. Ask an administrator to change the address.",
                "UNVERIFIED_IDENTITIES"
            );
        }

        // One write, held to the token: a second click, or a change replaced
        // since, finds nothing to apply. The unique index decides an address
        // somebody took meanwhile, as a 409.
        const updated = await store.applyPendingEmailChange(user.id, tokenHash);
        if (!updated) {
            throw invalid();
        }

        for (const identity of vouchingForOld) {
            await authRepo.unlinkUserIdentity?.(user.id, identity.provider, identity.providerId);
        }
        // A reset link still in the old inbox would set the password for the
        // rest of its hour.
        await authRepo.deleteAllPasswordResetTokensForUser(user.id);

        logger.info("[Security Audit] Email address changed", {
            eventType: "auth.email_change.confirmed",
            uid: user.id,
            detachedProviders: vouchingForOld.map(identity => identity.provider)
        });
        return c.json({
            success: true,
            user: { uid: updated.id, email: updated.email, emailVerified: true },
            removedProviders: vouchingForOld.map(identity => identity.provider)
        });
    });
}
