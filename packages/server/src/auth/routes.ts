import { Hono } from "hono";
import { ApiError, errorHandler } from "../api/errors";
import { randomBytes } from "crypto";
import { generateSecureToken, hashToken } from "./admin-user-ops";
import type { AuthRepository, OAuthProvider, CreateUserData } from "./interfaces";
import { generateAccessToken, generateRefreshToken, hashRefreshToken, getRefreshTokenExpiry, getAccessTokenExpiry } from "./jwt";
import type { AuthHooks } from "./auth-hooks";
import { resolveAuthHooks } from "./auth-hooks";
import { requireAuth } from "./middleware";
import { EmailService, EmailConfig } from "../email";
import { getPasswordResetTemplate, getEmailVerificationTemplate, getWelcomeEmailTemplate } from "../email/templates";
import { HonoEnv } from "../api/types";
import { defaultAuthLimiter, strictAuthLimiter } from "./rate-limiter";
import { z } from "zod";
import { logger } from "../utils/logger";
import { mountMfaRoutes } from "./mfa-routes";
import { mountSessionRoutes } from "./session-routes";
import { mountMagicLinkRoutes } from "./magic-link-routes";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";
import type { Context } from "hono";
import { readRefreshToken, redactRefreshToken, clearRefreshCookie } from "./cookie-utils";

/**
 * Shared configuration for auth and admin route factories.
 */
export interface AuthModuleConfig {
    authRepo: AuthRepository;
    emailService?: EmailService;
    emailConfig?: EmailConfig;
    /** Allow new user registration (default: false). */
    allowRegistration?: boolean;
    /** Expose the authenticated email→minimal-profile lookup route (default: false). */
    allowUserLookup?: boolean;
    /** Default role ID to assign to new users (default: none). Must NOT be "admin". */
    defaultRole?: string;
    /** Optional array of OAuth providers */
    oauthProviders?: OAuthProvider<unknown>[];
    /** When true, blocks all self-registration regardless of `allowRegistration`. */
    disableSelfRegistration?: boolean;
    /**
     * Auth hooks for customizing password hashing, credential
     * verification, lifecycle hooks, etc.
     */
    authHooks?: AuthHooks;
    /**
     * Callback that checks if bootstrap has already been completed.
     * Used by GET /auth/config to report `needsSetup` status.
     * When not provided, falls back to checking if any users exist.
     */
    isBootstrapCompleted?: () => Promise<boolean>;
    /** Enable magic link (passwordless email) login. Requires email service. */
    enableMagicLink?: boolean;
    /**
     * Opt-in httpOnly cookie mode for refresh tokens.
     *
     * When set, the refresh token is delivered as an `httpOnly`, `Secure`,
     * `SameSite` cookie instead of in the JSON response body. This
     * prevents XSS from stealing the long-lived refresh token.
     *
     * The access token remains in the JSON body so the client can use it
     * in `Authorization: Bearer` headers for API calls.
     *
     * **Requires** `credentials: "include"` on client-side fetch calls to
     * auth endpoints, and CORS must allow credentials (no `origin: "*"`).
     */
    cookieAuth?: CookieAuthConfig;
}

/**
 * Configuration for httpOnly refresh-token cookies.
 */
export interface CookieAuthConfig {
    /** Cookie name (default: "__rb_refresh"). */
    cookieName?: string;
    /** Cookie domain. Omit to use the current domain. */
    domain?: string;
    /** Cookie path (default: "/"). */
    path?: string;
    /** SameSite attribute (default: "Lax"). */
    sameSite?: "Strict" | "Lax" | "None";
    /** Force the Secure flag. Defaults to `true` when SameSite is "None", otherwise auto-detected from the request protocol. */
    secure?: boolean;
}

/**
 * Helper to build standard auth response output
 */
function buildAuthResponse(
    user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; emailVerified?: boolean; isAnonymous?: boolean; metadata?: Record<string, unknown> | null },
    roleIds: string[],
    accessToken: string,
    refreshToken: string,
    providerId: string
): AuthResponsePayload {
    return {
        user: {
            uid: user.id,
            email: user.email,
            displayName: user.displayName ?? null,
            photoURL: user.photoUrl ?? null,
            providerId,
            isAnonymous: user.isAnonymous ?? false,
            emailVerified: user.emailVerified ?? false,
            roles: roleIds,
            metadata: user.metadata ?? {}
        },
        tokens: {
            accessToken,
            refreshToken,
            accessTokenExpiresAt: getAccessTokenExpiry()
        }
    };
}


/**
 * Get password reset token expiry (1 hour from now)
 */
function getPasswordResetExpiry(): Date {
    return new Date(Date.now() + 60 * 60 * 1000); // 1 hour
}

export function createAuthRoutes(config: AuthModuleConfig): Hono<HonoEnv> {
    if (config.defaultRole === "admin") {
        throw new Error("CRITICAL SECURITY ERROR: defaultRole cannot be 'admin'. Administrative privilege escalation via registration is strictly forbidden. Use the POST /admin/bootstrap endpoint to promote the initial administrator.");
    }

    const router = new Hono<HonoEnv>();

    // Attach Rebase error handler to ensure ApiError exceptions are correctly
    // formatted instead of caught by Hono's default error handler.
    // Hono's onError does NOT propagate from parent to child routers.
    router.onError(errorHandler);

    const authRepo = config.authRepo;
    const { emailService, emailConfig, allowRegistration = false } = config;
    const ops = resolveAuthHooks(config.authHooks);

    /**
     * Apply the `transformAuthResponse` hook if provided.
     *
     * Errors are caught and logged — the untransformed response is returned
     * as a graceful fallback so auth never breaks due to a hook failure.
     */
    async function applyTransformHook(
        response: AuthResponsePayload,
        method: TransformAuthResponseContext["method"],
        request: Request,
        uid: string
    ): Promise<AuthResponsePayload> {
        if (!ops.transformAuthResponse) return response;
        try {
            return await ops.transformAuthResponse(response, { uid, method, request });
        } catch (err) {
            logger.error("[AuthHooks] transformAuthResponse error", {
                error: err instanceof Error ? err.message : err
            });
            return response;
        }
    }

    // ── Zod input schemas ──────────────────────────────────────────────
    const registerSchema = z.object({
        email: z.string().email("Invalid email address").max(255),
        password: z.string().min(1, "Password is required").max(128),
        displayName: z.string().max(255).optional()
    });
    const loginSchema = z.object({
        email: z.string().email("Invalid email address").max(255),
        password: z.string().min(1, "Password is required").max(128)
    });
    const forgotPasswordSchema = z.object({
        email: z.string().email("Invalid email address").max(255)
    });
    const resetPasswordSchema = z.object({
        token: z.string().min(1, "Token is required"),
        password: z.string().min(1, "Password is required").max(128)
    });
    const changePasswordSchema = z.object({
        oldPassword: z.string().min(1, "Old password is required").max(128),
        newPassword: z.string().min(1, "New password is required").max(128)
    });
    const refreshSchema = z.object({
        // When cookieAuth is enabled the refresh token arrives via cookie, so
        // the body field becomes optional.
        refreshToken: config.cookieAuth
            ? z.string().optional()
            : z.string().min(1, "Refresh token is required")
    });
    const logoutSchema = z.object({
        refreshToken: z.string().optional()
    });
    const updateProfileSchema = z.object({
        displayName: z.string().max(255).optional(),
        photoURL: z.string().url().max(2048).optional()
    });

    /** Parse a Zod schema against the request body, throwing ApiError on failure */
    function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
        const result = schema.safeParse(body);
        if (!result.success) {
            const messages = result.error.issues.map(e => `${e.path.join(".")}: ${e.message}`).join(". ");
            throw ApiError.badRequest(messages, "INVALID_INPUT");
        }
        return result.data;
    }

    /**
     * Check if email service is configured
     */
    function isEmailConfigured(): boolean {
        return !!(emailService && emailService.isConfigured());
    }

    /**
     * Check if registration is allowed.
     * Registration is only allowed when explicitly enabled via `allowRegistration`.
     * First-user bootstrap must use POST /admin/bootstrap instead.
     */
    function isRegistrationAllowed(): boolean {
        if (config.disableSelfRegistration) return false;
        return !!allowRegistration;
    }

    /**
     * Send welcome email to a newly registered user (fire-and-forget).
     */
    function sendWelcomeEmail(user: { email: string; displayName?: string | null }) {
        if (!isEmailConfigured()) return;
        const appName = emailConfig?.appName || "Rebase";
        const loginUrl = emailConfig?.resetPasswordUrl || ""; // reuse base URL → the login / app page
        const templateFn = emailConfig?.templates?.welcomeEmail;
        const emailContent = templateFn
            ? templateFn(user, appName)
            : getWelcomeEmailTemplate(user, appName, loginUrl ? `${loginUrl}/app` : undefined);

        emailService!.send({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text
        }).catch(err => {
            logger.error("Failed to send welcome email", { error: err instanceof Error ? err.message : err });
        });
    }

    /**
     * Helper to generate and store session tokens
     */
    async function createSessionAndTokens(uid: string, userAgent: string, ipAddress: string) {
        const roles = await authRepo.getUserRoles(uid);
        const roleIds = roles.map(r => r.id);

        // Allow customization of access token claims via hook
        let customClaims: Record<string, unknown> | undefined;
        if (ops.customizeAccessToken) {
            const user = await authRepo.getUserById(uid);
            if (user) {
                const defaultClaims: Record<string, unknown> = { uid,
roles: roleIds,
aal: "aal1" };
                customClaims = await ops.customizeAccessToken(defaultClaims, user);
            }
        }

        const accessToken = generateAccessToken(uid, roleIds, "aal1", customClaims);
        const refreshToken = generateRefreshToken();

        await authRepo.createRefreshToken(
            uid,
            hashRefreshToken(refreshToken),
            getRefreshTokenExpiry(),
            userAgent,
            ipAddress
        );

        return { roleIds,
accessToken,
refreshToken };
    }

    /**
     * POST /auth/register
     * Create a new account with email/password
     */
    router.post("/register", defaultAuthLimiter, async (c) => {
        const { email, password, displayName } = parseBody(registerSchema, await c.req.json());

        // Hard kill switch — blocks registration regardless of allowRegistration
        if (config.disableSelfRegistration) {
            throw ApiError.forbidden("Registration is disabled", "REGISTRATION_DISABLED");
        }

        // Check if registration is allowed (no bypass for empty databases)
        if (!isRegistrationAllowed()) {
            throw ApiError.forbidden("Registration is disabled", "REGISTRATION_DISABLED");
        }

        // Validate password strength
        const passwordValidation = ops.validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            throw ApiError.badRequest(passwordValidation.errors.join(". "), "WEAK_PASSWORD");
        }

        // Check if email already exists
        const existingUser = await authRepo.getUserByEmail(email);
        if (existingUser) {
            throw ApiError.conflict("Email already registered", "EMAIL_EXISTS");
        }

        // Create user
        const passwordHash = await ops.hashPassword(password);
        let createData: import("./interfaces").CreateUserData = {
            email: email.toLowerCase(),
            passwordHash,
            displayName: displayName || undefined
        };
        if (ops.beforeUserCreate) {
            createData = await ops.beforeUserCreate(createData);
        }
        const user = await authRepo.createUser(createData);

        // Auto-bootstrap: if this is the very first user in the system, promote to admin.
        // This avoids the chicken-and-egg problem where the first user has no permissions
        // and no way to access the bootstrap endpoint from the UI.
        const existingUsers = await authRepo.listUsers();
        const isFirstUser = existingUsers.length === 1 && existingUsers[0].id === user.id;

        if (isFirstUser) {
            await authRepo.setUserRoles(user.id, ["admin"]);
        } else if (config.defaultRole) {
            // Assign configured default role (never auto-assign admin via registration)
            await authRepo.assignDefaultRole(user.id, config.defaultRole);
        }

        const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
            user.id,
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown"
        );

        // Send welcome email (fire-and-forget, don't block registration)
        sendWelcomeEmail({ email: user.email,
displayName: user.displayName });

        // Fire afterUserCreate hook
        if (ops.afterUserCreate) {
            try {
                await ops.afterUserCreate(user);
            } catch (err) {
                logger.error("[AuthHooks] afterUserCreate error", { error: err instanceof Error ? err.message : err });
            }
        }

        // Fire onAuthenticated hook (fire-and-forget)
        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "register").catch(err => {
                logger.error("[AuthHooks] onAuthenticated error", { error: err instanceof Error ? err.message : err });
            });
        }

        const authResponse = buildAuthResponse(user, roleIds, accessToken, refreshToken, "password");
        const transformedResponse = await applyTransformHook(authResponse, "register", c.req.raw, user.id);
        const finalResponse = redactRefreshToken(transformedResponse, c, refreshToken, config.cookieAuth);
        return c.json(finalResponse, 201);
    });

    /**
     * POST /auth/login
     * Login with email/password
     */
    router.post("/login", defaultAuthLimiter, async (c) => {
        const { email, password } = parseBody(loginSchema, await c.req.json());

        // Call beforeLogin hook if provided (throw to reject)
        if (ops.beforeLogin) {
            await ops.beforeLogin(email, "login");
        }

        let user;

        if (ops.verifyCredentials) {
            // Full credential verification override
            user = await ops.verifyCredentials(email, password, authRepo);
            if (!user) {
                throw ApiError.unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
            }
        } else {
            // Default: email lookup + password hash verification
            user = await authRepo.getUserByEmail(email);
            if (!user) {
                throw ApiError.unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
            }

            if (!user.passwordHash) {
                throw ApiError.unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
            }

            const isValidPassword = await ops.verifyPassword(password, user.passwordHash);
            if (!isValidPassword) {
                logger.warn("[Security Audit] Auth login failure", {
                    eventType: "auth.login.failure",
                    email,
                    uid: user.id
                });
                throw ApiError.unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
            }
        }

        const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
            user.id,
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown"
        );

        // Fire onAuthenticated hook (fire-and-forget)
        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "login").catch(err => {
                logger.error("[AuthHooks] onAuthenticated error", { error: err instanceof Error ? err.message : err });
            });
        }

        logger.info("[Security Audit] Auth login success", {
            eventType: "auth.login.success",
            uid: user.id,
            email
        });

        const authResponse = buildAuthResponse(user, roleIds, accessToken, refreshToken, "password");
        const transformedResponse = await applyTransformHook(authResponse, "login", c.req.raw, user.id);
        const finalResponse = redactRefreshToken(transformedResponse, c, refreshToken, config.cookieAuth);
        return c.json(finalResponse);
    });

    /**
     * Dynamically mount OAuth provider routes
     */
    if (config.oauthProviders && config.oauthProviders.length > 0) {
        for (const provider of config.oauthProviders) {
            router.post(`/${provider.id}`, defaultAuthLimiter, async (c) => {
                const payload = parseBody(provider.schema, await c.req.json());

                let externalUser;
                try {
                    externalUser = await provider.verify(payload);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    throw ApiError.unauthorized(`${provider.id} login failed: ${msg}`, "OAUTH_ERROR");
                }
                if (!externalUser) {
                    throw ApiError.unauthorized(`Invalid ${provider.id} credentials`, "INVALID_TOKEN");
                }

                // Find or create user
                let user = await authRepo.getUserByIdentity(provider.id, externalUser.providerId);

                if (!user) {
                    // Check if email exists (link accounts)
                    user = await authRepo.getUserByEmail(externalUser.email);

                    if (user) {
                        // Only auto-link if the OAuth provider confirmed the email is verified
                        if (!externalUser.emailVerified) {
                            throw ApiError.forbidden(
                                `An account with this email already exists with a different sign-in method. ${provider.id} has not verified this email address, so it cannot be linked automatically. Sign in with your existing method, then POST to /auth/link/${provider.id} to link ${provider.id} to your account.`,
                                "EMAIL_NOT_VERIFIED"
                            );
                        }
                        // Link Provider to existing account
                        await authRepo.linkUserIdentity(user.id, provider.id, externalUser.providerId, { email: externalUser.email });

                        // Optional: Update profile info from external provider if empty
                        await authRepo.updateUser(user.id, {
                            displayName: user.displayName || externalUser.displayName || undefined,
                            photoUrl: user.photoUrl || externalUser.photoUrl || undefined
                        });
                    } else {
                        // Create new user
                        user = await authRepo.createUser({
                            email: externalUser.email.toLowerCase(),
                            displayName: externalUser.displayName || undefined,
                            photoUrl: externalUser.photoUrl || undefined
                        });

                        await authRepo.linkUserIdentity(user.id, provider.id, externalUser.providerId, { email: externalUser.email });

                        // Fire afterUserCreate hook
                        if (ops.afterUserCreate) {
                            try {
                                await ops.afterUserCreate(user);
                            } catch (err) {
                                logger.error("[AuthHooks] afterUserCreate error", { error: err instanceof Error ? err.message : err });
                            }
                        }

                        // Auto-bootstrap: first user in the system gets admin
                        const allUsers = await authRepo.listUsers();
                        const isFirstUser = allUsers.length === 1 && allUsers[0].id === user.id;

                        if (isFirstUser) {
                            await authRepo.setUserRoles(user.id, ["admin"]);
                        } else if (config.defaultRole) {
                            // Assign configured default role (never auto-assign admin via registration)
                            await authRepo.assignDefaultRole(user.id, config.defaultRole);
                        }

                        // Send welcome email for new OAuth users (fire-and-forget)
                        sendWelcomeEmail({ email: user.email,
displayName: user.displayName });
                    }
                } else {
                    // Update profile info from external provider
                    await authRepo.updateUser(user.id, {
                        displayName: externalUser.displayName || user.displayName || undefined,
                        photoUrl: externalUser.photoUrl || user.photoUrl || undefined
                    });
                }

                const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
                    user.id,
                    c.req.header("user-agent") || "unknown",
                    c.req.header("x-forwarded-for") || "unknown"
                );

                const authResponse = buildAuthResponse(user, roleIds, accessToken, refreshToken, provider.id);
                const transformedResponse = await applyTransformHook(authResponse, "oauth", c.req.raw, user.id);
                const finalResponse = redactRefreshToken(transformedResponse, c, refreshToken, config.cookieAuth);
                return c.json(finalResponse);
            });

            /**
             * POST /auth/link/:provider
             * Attach an OAuth identity to the *already authenticated* account.
             *
             * This is the escape hatch from the `EMAIL_NOT_VERIFIED` rejection
             * on the sign-in route above, and the way to attach a provider
             * whose email differs from the account's.
             *
             * Note the deliberate asymmetry with sign-in: linking here does
             * NOT require the provider to have verified the email, and does
             * not require the emails to match at all. On the sign-in route the
             * provider's email is the *only* evidence tying the incoming
             * identity to an existing account, so an unverified address would
             * let an attacker claim someone else's account. Here the caller
             * has already proven ownership by holding a valid session, and the
             * OAuth credential proves control of the provider identity — the
             * email plays no part in the decision, so its verification status
             * is irrelevant.
             */
            router.post(`/link/${provider.id}`, defaultAuthLimiter, requireAuth, async (c) => {
                const userCtx = c.get("user") as { uid: string } | undefined;
                if (!userCtx) {
                    throw ApiError.unauthorized("Not authenticated");
                }

                const payload = parseBody(provider.schema, await c.req.json());

                let externalUser;
                try {
                    externalUser = await provider.verify(payload);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    throw ApiError.unauthorized(`${provider.id} link failed: ${msg}`, "OAUTH_ERROR");
                }
                if (!externalUser) {
                    throw ApiError.unauthorized(`Invalid ${provider.id} credentials`, "INVALID_TOKEN");
                }

                // Refuse to attach an identity that already belongs to someone
                // else — one provider identity must resolve to exactly one
                // user, or the sign-in lookup above becomes ambiguous.
                const identityOwner = await authRepo.getUserByIdentity(provider.id, externalUser.providerId);
                if (identityOwner && identityOwner.id !== userCtx.uid) {
                    throw ApiError.conflict(
                        `That ${provider.id} account is already linked to a different user.`,
                        "IDENTITY_ALREADY_LINKED"
                    );
                }
                if (identityOwner) {
                    // Already linked to this same user — idempotent success.
                    return c.json({ success: true, provider: provider.id, alreadyLinked: true });
                }

                await authRepo.linkUserIdentity(
                    userCtx.uid,
                    provider.id,
                    externalUser.providerId,
                    { email: externalUser.email }
                );

                return c.json({ success: true, provider: provider.id, alreadyLinked: false });
            });
        }
    }

    /**
     * POST /auth/forgot-password
     * Request password reset email
     */
    router.post("/forgot-password", strictAuthLimiter, async (c) => {
        const { email } = parseBody(forgotPasswordSchema, await c.req.json());

        // Check if email service is configured
        if (!isEmailConfigured()) {
            throw ApiError.serviceUnavailable("Email service not configured. Password reset is not available.", "EMAIL_NOT_CONFIGURED");
        }

        // Always return success (security: don't reveal if email exists)
        // But only send email if user exists
        const user = await authRepo.getUserByEmail(email);

        if (user) {
            // Generate reset token
            const token = generateSecureToken();
            const tokenHash = hashToken(token);
            const expiresAt = getPasswordResetExpiry();

            await authRepo.createPasswordResetToken(user.id, tokenHash, expiresAt);

            // Build reset URL
            const baseUrl = emailConfig?.resetPasswordUrl || "";
            const resetUrl = `${baseUrl}/reset-password?token=${token}`;

            // Get email template
            const appName = emailConfig?.appName || "Rebase";
            const templateFn = emailConfig?.templates?.passwordReset;
            const emailContent = templateFn
                ? templateFn(resetUrl, { email: user.email,
displayName: user.displayName })
                : getPasswordResetTemplate(resetUrl, { email: user.email,
displayName: user.displayName }, appName);

            // Send email
            try {
                await emailService!.send({
                    to: user.email,
                    subject: emailContent.subject,
                    html: emailContent.html,
                    text: emailContent.text
                });
            } catch (emailError: unknown) {
                logger.error("Failed to send password reset email", { error: emailError instanceof Error ? emailError.message : emailError });
                // Don't reveal email sending failure to client
            }
        }

        // Always return success
        return c.json({
            success: true,
            message: "If an account with that email exists, a password reset link has been sent."
        });
    });

    /**
     * POST /auth/reset-password
     * Reset password using token
     */
    router.post("/reset-password", strictAuthLimiter, async (c) => {
        const { token, password } = parseBody(resetPasswordSchema, await c.req.json());

        // Validate password strength
        const passwordValidation = ops.validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            throw ApiError.badRequest(passwordValidation.errors.join(". "), "WEAK_PASSWORD");
        }

        // Find valid token
        const tokenHash = hashToken(token);
        const storedToken = await authRepo.findValidPasswordResetToken(tokenHash);

        if (!storedToken) {
            throw ApiError.badRequest("Invalid or expired reset token", "INVALID_TOKEN");
        }

        // Update password
        const passwordHash = await ops.hashPassword(password);
        await authRepo.updatePassword(storedToken.uid, passwordHash);

        // Mark token as used
        await authRepo.markPasswordResetTokenUsed(tokenHash);

        // Invalidate all refresh tokens (security: log out all sessions)
        await authRepo.deleteAllRefreshTokensForUser(storedToken.uid);

        // Fire onPasswordReset hook (fire-and-forget)
        if (ops.onPasswordReset) {
            ops.onPasswordReset(storedToken.uid).catch(err => {
                logger.error("[AuthHooks] onPasswordReset error", { error: err instanceof Error ? err.message : err });
            });
        }

        return c.json({ success: true,
message: "Password has been reset successfully" });
    });

    /**
     * POST /auth/change-password
     * Change password for authenticated user
     */
    router.post("/change-password", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const { oldPassword, newPassword } = parseBody(changePasswordSchema, await c.req.json());

        // Get user
        const user = await authRepo.getUserById(userCtx.uid);
        if (!user || !user.passwordHash) {
            throw ApiError.badRequest("Cannot change password for this account", "INVALID_ACCOUNT");
        }

        // Verify old password
        const isValidOldPassword = await ops.verifyPassword(oldPassword, user.passwordHash);
        if (!isValidOldPassword) {
            throw ApiError.unauthorized("Current password is incorrect", "INVALID_CREDENTIALS");
        }

        // Validate new password strength
        const passwordValidation = ops.validatePasswordStrength(newPassword);
        if (!passwordValidation.valid) {
            throw ApiError.badRequest(passwordValidation.errors.join(". "), "WEAK_PASSWORD");
        }

        // Update password
        const passwordHash = await ops.hashPassword(newPassword);
        await authRepo.updatePassword(user.id, passwordHash);

        // Invalidate all refresh tokens (security: log out all sessions)
        await authRepo.deleteAllRefreshTokensForUser(user.id);

        return c.json({ success: true,
message: "Password has been changed successfully" });
    });

    /**
     * POST /auth/send-verification
     * Send email verification link (authenticated)
     */
    router.post("/send-verification", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        // Check if email service is configured
        if (!isEmailConfigured()) {
            throw ApiError.serviceUnavailable("Email service not configured. Email verification is not available.", "EMAIL_NOT_CONFIGURED");
        }

        const user = await authRepo.getUserById(userCtx.uid);
        if (!user) {
            throw ApiError.notFound("User not found");
        }

        if (user.emailVerified) {
            throw ApiError.badRequest("Email is already verified", "ALREADY_VERIFIED");
        }

        // Generate verification token
        const token = generateSecureToken();

        // Store hashed token in user record (raw token goes in the email URL)
        await authRepo.setVerificationToken(user.id, hashToken(token));

        // Build verification URL
        const baseUrl = emailConfig?.verifyEmailUrl || "";
        const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

        // Get email template
        const appName = emailConfig?.appName || "Rebase";
        const templateFn = emailConfig?.templates?.emailVerification;
        const emailContent = templateFn
            ? templateFn(verifyUrl, { email: user.email,
displayName: user.displayName })
            : getEmailVerificationTemplate(verifyUrl, { email: user.email,
displayName: user.displayName }, appName);

        // Send email
        await emailService!.send({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text
        });

        return c.json({ success: true,
message: "Verification email sent" });
    });

    /**
     * GET /auth/verify-email
     * Verify email address using token
     */
    router.get("/verify-email", async (c) => {
        const token = c.req.query("token");

        if (!token) {
            throw ApiError.badRequest("Verification token is required", "INVALID_INPUT");
        }

        // Find user by hashed verification token
        const user = await authRepo.getUserByVerificationToken(hashToken(token));
        if (!user) {
            throw ApiError.badRequest("Invalid or expired verification token", "INVALID_TOKEN");
        }

        // Mark email as verified
        await authRepo.setEmailVerified(user.id, true);

        return c.json({ success: true,
message: "Email verified successfully" });
    });

    /**
     * POST /auth/refresh
     * Refresh access token using refresh token
     */
    router.post("/refresh", async (c) => {
        // Cookie mode sends NO body: the refresh token lives in the httpOnly
        // cookie, which is the entire point of it. Hono's `json()` throws
        // "Unexpected end of JSON input" on an empty body, so parsing it
        // unguarded turned every cookie-mode refresh into a 500 — and clients
        // refresh on page load, so sessions never restored and users were
        // signed out on every reload.
        //
        // `refreshToken` is already optional under cookieAuth and
        // `readRefreshToken` already falls back to the cookie; this is only
        // what makes that reachable.
        const body = await c.req.json().catch(() => ({}));
        const parsed = parseBody(refreshSchema, body);
        const refreshToken = readRefreshToken(c, parsed, config.cookieAuth);

        if (!refreshToken) {
            throw ApiError.badRequest("Refresh token is required", "INVALID_INPUT");
        }

        const tokenHash = hashRefreshToken(refreshToken);
        const storedToken = await authRepo.findRefreshTokenByHash(tokenHash);

        if (!storedToken) {
            // When cookie mode is active, clear the stale cookie
            clearRefreshCookie(c, config.cookieAuth);
            throw ApiError.unauthorized("Invalid refresh token", "INVALID_TOKEN");
        }

        if (new Date() > storedToken.expiresAt) {
            await authRepo.deleteRefreshToken(tokenHash);
            clearRefreshCookie(c, config.cookieAuth);
            throw ApiError.unauthorized("Refresh token expired", "TOKEN_EXPIRED");
        }

        // Generate new tokens
        const roles = await authRepo.getUserRoles(storedToken.uid);
        const roleIds = roles.map(r => r.id);

        // Best-effort: load the user so we can return it in the response, which
        // lets the client restore a session from an httpOnly cookie alone (cold
        // start in cookie mode). This enrichment must NEVER break refresh — on
        // any failure we fall back to a tokens-only response (the pre-existing
        // behavior), and the client restores the user via GET /me.
        const user = await authRepo.getUserById(storedToken.uid).catch((err: unknown) => {
            logger.warn("[Auth] Could not load user during token refresh; returning tokens only", {
                uid: storedToken.uid,
                error: err instanceof Error ? err.message : String(err)
            });
            return null;
        });

        // Allow customization of access token claims via hook
        let customClaims: Record<string, unknown> | undefined;
        if (ops.customizeAccessToken && user) {
            const defaultClaims: Record<string, unknown> = { uid: storedToken.uid,
roles: roleIds,
aal: "aal1" };
            customClaims = await ops.customizeAccessToken(defaultClaims, user);
        }

        const newAccessToken = generateAccessToken(storedToken.uid, roleIds, "aal1", customClaims);
        const newRefreshToken = generateRefreshToken();

        // Rotate refresh token (delete old, create new)
        const userAgent = c.req.header("user-agent") || "unknown";
        const ipAddress = c.req.header("x-forwarded-for") || "unknown";

        await authRepo.deleteRefreshToken(tokenHash);
        await authRepo.createRefreshToken(
            storedToken.uid,
            hashRefreshToken(newRefreshToken),
            getRefreshTokenExpiry(),
            userAgent,
            ipAddress
        );

        const tokensOnlyResponse: AuthResponsePayload = {
            tokens: {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
                accessTokenExpiresAt: getAccessTokenExpiry()
            }
        };
        let refreshResponse: AuthResponsePayload = tokensOnlyResponse;
        if (user) {
            try {
                refreshResponse = buildAuthResponse(user, roleIds, newAccessToken, newRefreshToken, "password");
            } catch (err: unknown) {
                logger.warn("[Auth] Could not build enriched refresh response; returning tokens only", {
                    error: err instanceof Error ? err.message : String(err)
                });
                refreshResponse = tokensOnlyResponse;
            }
        }
        const transformedResponse = await applyTransformHook(refreshResponse, "refresh", c.req.raw, storedToken.uid);
        const finalResponse = redactRefreshToken(transformedResponse, c, newRefreshToken, config.cookieAuth);
        return c.json(finalResponse);
    });

    mountSessionRoutes({
        router,
        config,
        ops,
        parseBody,
        buildAuthResponse,
        createSessionAndTokens,
        applyTransformHook
    });

    // ═══════════════════════════════════════════════════════════════════════
    // MFA / TOTP
    // ═══════════════════════════════════════════════════════════════════════
    mountMfaRoutes(router, config, ops, parseBody, applyTransformHook);

    // ═══════════════════════════════════════════════════════════════════════
    // Magic Link (passwordless email login)
    // ═══════════════════════════════════════════════════════════════════════
    if (config.enableMagicLink) {
        mountMagicLinkRoutes({
            router,
            config,
            ops,
            parseBody,
            buildAuthResponse,
            createSessionAndTokens,
            applyTransformHook
        });
    }

    return router;
}
