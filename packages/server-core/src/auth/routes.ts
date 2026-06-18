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
import { generateTotpSecret, verifyTotp, base32Decode, generateRecoveryCodes, hashRecoveryCode } from "./mfa";

/**
 * Shared configuration for auth and admin route factories.
 */
export interface AuthModuleConfig {
    authRepo: AuthRepository;
    emailService?: EmailService;
    emailConfig?: EmailConfig;
    /** Allow new user registration (default: false). */
    allowRegistration?: boolean;
    /** Default role ID to assign to new users (default: none). Must NOT be "admin". */
    defaultRole?: string;
    /** Optional array of OAuth providers */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    oauthProviders?: OAuthProvider<any>[];
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
}

/**
 * Helper to build standard auth response output
 */
function buildAuthResponse(
    user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; metadata?: Record<string, unknown> | null },
    roleIds: string[],
    accessToken: string,
    refreshToken: string
) {
    return {
        user: {
            uid: user.id,
            email: user.email,
            displayName: user.displayName ?? null,
            photoURL: user.photoUrl ?? null,
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
        refreshToken: z.string().min(1, "Refresh token is required")
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
            console.error("Failed to send welcome email:", err instanceof Error ? err.message : err);
        });
    }

    /**
     * Helper to generate and store session tokens
     */
    async function createSessionAndTokens(userId: string, userAgent: string, ipAddress: string) {
        const roles = await authRepo.getUserRoles(userId);
        const roleIds = roles.map(r => r.id);

        // Allow customization of access token claims via hook
        let customClaims: Record<string, unknown> | undefined;
        if (ops.customizeAccessToken) {
            const user = await authRepo.getUserById(userId);
            if (user) {
                const defaultClaims: Record<string, unknown> = { userId,
roles: roleIds,
aal: "aal1" };
                customClaims = await ops.customizeAccessToken(defaultClaims, user);
            }
        }

        const accessToken = generateAccessToken(userId, roleIds, "aal1", customClaims);
        const refreshToken = generateRefreshToken();

        await authRepo.createRefreshToken(
            userId,
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
                console.error("[AuthHooks] afterUserCreate error:", err instanceof Error ? err.message : err);
            }
        }

        // Fire onAuthenticated hook (fire-and-forget)
        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "register").catch(err => {
                console.error("[AuthHooks] onAuthenticated error:", err instanceof Error ? err.message : err);
            });
        }

        return c.json(buildAuthResponse(user, roleIds, accessToken, refreshToken), 201);
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
                console.error("[AuthHooks] onAuthenticated error:", err instanceof Error ? err.message : err);
            });
        }

        return c.json(buildAuthResponse(user, roleIds, accessToken, refreshToken));
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
                                console.error("[AuthHooks] afterUserCreate error:", err instanceof Error ? err.message : err);
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

                return c.json(buildAuthResponse(user, roleIds, accessToken, refreshToken));
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
                console.error("Failed to send password reset email:", emailError instanceof Error ? emailError.message : emailError);
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
        await authRepo.updatePassword(storedToken.userId, passwordHash);

        // Mark token as used
        await authRepo.markPasswordResetTokenUsed(tokenHash);

        // Invalidate all refresh tokens (security: log out all sessions)
        await authRepo.deleteAllRefreshTokensForUser(storedToken.userId);

        // Fire onPasswordReset hook (fire-and-forget)
        if (ops.onPasswordReset) {
            ops.onPasswordReset(storedToken.userId).catch(err => {
                console.error("[AuthHooks] onPasswordReset error:", err instanceof Error ? err.message : err);
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
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const { oldPassword, newPassword } = parseBody(changePasswordSchema, await c.req.json());

        // Get user
        const user = await authRepo.getUserById(userCtx.userId);
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
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        // Check if email service is configured
        if (!isEmailConfigured()) {
            throw ApiError.serviceUnavailable("Email service not configured. Email verification is not available.", "EMAIL_NOT_CONFIGURED");
        }

        const user = await authRepo.getUserById(userCtx.userId);
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
        const { refreshToken } = parseBody(refreshSchema, await c.req.json());

        const tokenHash = hashRefreshToken(refreshToken);
        const storedToken = await authRepo.findRefreshTokenByHash(tokenHash);

        if (!storedToken) {
            throw ApiError.unauthorized("Invalid refresh token", "INVALID_TOKEN");
        }

        if (new Date() > storedToken.expiresAt) {
            await authRepo.deleteRefreshToken(tokenHash);
            throw ApiError.unauthorized("Refresh token expired", "TOKEN_EXPIRED");
        }

        // Generate new tokens
        const roles = await authRepo.getUserRoles(storedToken.userId);
        const roleIds = roles.map(r => r.id);

        // Allow customization of access token claims via hook
        let customClaims: Record<string, unknown> | undefined;
        if (ops.customizeAccessToken) {
            const user = await authRepo.getUserById(storedToken.userId);
            if (user) {
                const defaultClaims: Record<string, unknown> = { userId: storedToken.userId,
roles: roleIds,
aal: "aal1" };
                customClaims = await ops.customizeAccessToken(defaultClaims, user);
            }
        }

        const newAccessToken = generateAccessToken(storedToken.userId, roleIds, "aal1", customClaims);
        const newRefreshToken = generateRefreshToken();

        // Rotate refresh token (delete old, create new)
        const userAgent = c.req.header("user-agent") || "unknown";
        const ipAddress = c.req.header("x-forwarded-for") || "unknown";

        await authRepo.deleteRefreshToken(tokenHash);
        await authRepo.createRefreshToken(
            storedToken.userId,
            hashRefreshToken(newRefreshToken),
            getRefreshTokenExpiry(),
            userAgent,
            ipAddress
        );

        return c.json({
            tokens: {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
                accessTokenExpiresAt: getAccessTokenExpiry()
            }
        });
    });

    /**
     * POST /auth/logout
     * Invalidate refresh token
     */
    router.post("/logout", async (c) => {
        const { refreshToken } = parseBody(logoutSchema, await c.req.json());

        if (refreshToken) {
            const tokenHash = hashRefreshToken(refreshToken);
            await authRepo.deleteRefreshToken(tokenHash);
        }

        // Call afterLogout hook (fire-and-forget)
        // Extract userId from the access token if present
        const authHeader = c.req.header("authorization");
        if (ops.afterLogout && authHeader?.startsWith("Bearer ")) {
            const { verifyAccessToken } = await import("./jwt");
            const payload = verifyAccessToken(authHeader.substring(7));
            if (payload) {
                ops.afterLogout(payload.userId).catch(err => {
                    console.error("[AuthHooks] afterLogout error:", err instanceof Error ? err.message : err);
                });
            }
        }

        return c.json({ success: true });
    });

    /**
     * GET /auth/sessions
     * Get active refresh tokens (sessions) for the current user
     */
    router.get("/sessions", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const currentRefreshToken = c.req.header("x-refresh-token") as string;
        const currentTokenHash = currentRefreshToken ? hashRefreshToken(currentRefreshToken) : null;

        const sessions = await authRepo.listRefreshTokensForUser(userCtx.userId);

        const mappedSessions = sessions.map(s => ({
            id: s.id,
            userAgent: s.userAgent,
            ipAddress: s.ipAddress,
            createdAt: s.createdAt,
            isCurrentSession: currentTokenHash ? s.tokenHash === currentTokenHash : false
        }));

        return c.json({ sessions: mappedSessions });
    });

    /**
     * DELETE /auth/sessions
     * Delete all refresh tokens for the current user (remote logout every device)
     */
    router.delete("/sessions", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        await authRepo.deleteAllRefreshTokensForUser(userCtx.userId);
        return c.json({ success: true,
message: "All sessions revoked successfully" });
    });

    /**
     * DELETE /auth/sessions/:id
     * Delete a specific refresh token (remote logout)
     */
    router.delete("/sessions/:id", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const id = c.req.param("id");
        if (!id) {
            throw ApiError.badRequest("Session ID is required", "INVALID_INPUT");
        }

        await authRepo.deleteRefreshTokenById(id, userCtx.userId);
        return c.json({ success: true,
message: "Session revoked successfully" });
    });

    /**
     * GET /auth/me
     * Get current authenticated user
     */
    router.get("/me", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const result = await authRepo.getUserWithRoles(userCtx.userId);
        if (!result) {
            throw ApiError.notFound("User not found");
        }

        return c.json({
            user: {
                uid: result.user.id,
                email: result.user.email,
                displayName: result.user.displayName,
                photoURL: result.user.photoUrl,
                emailVerified: result.user.emailVerified,
                roles: result.roles.map(r => r.id),
                metadata: result.user.metadata ?? {}
            }
        });
    });

    /**
     * PATCH /auth/me
     * Update current authenticated user profile
     */
    router.patch("/me", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const { displayName, photoURL } = parseBody(updateProfileSchema, await c.req.json());

        const updatedUser = await authRepo.updateUser(userCtx.userId, {
            displayName: displayName !== undefined ? displayName : undefined,
            photoUrl: photoURL !== undefined ? photoURL : undefined
        });

        if (!updatedUser) {
            throw ApiError.notFound("User not found");
        }

        const result = await authRepo.getUserWithRoles(userCtx.userId);
        if (!result) {
            throw ApiError.notFound("User not found");
        }

        return c.json({
            user: {
                uid: result.user.id,
                email: result.user.email,
                displayName: result.user.displayName,
                photoURL: result.user.photoUrl,
                emailVerified: result.user.emailVerified,
                roles: result.roles.map(r => r.id),
                metadata: result.user.metadata ?? {}
            }
        });
    });

    /**
     * GET /auth/config
     * Get public auth configuration (for frontend to know what's available)
     */
    router.get("/config", defaultAuthLimiter, async (c) => {
        // Determine if setup is needed using the persistent bootstrap flag
        // when available, falling back to user-count check for backward compat.
        let needsSetup: boolean;
        if (config.isBootstrapCompleted) {
            needsSetup = !(await config.isBootstrapCompleted());
        } else {
            const allUsers = await authRepo.listUsers();
            needsSetup = allUsers.length === 0;
        }

        // Registration is allowed when explicitly enabled OR during initial setup
        const registrationAllowed = needsSetup || !!allowRegistration;

        // Build the list of enabled OAuth providers for frontend discovery.
        const enabledProviders = (config.oauthProviders || []).map(p => p.id);

        return c.json({
            needsSetup,
            registrationEnabled: registrationAllowed,
            emailServiceEnabled: isEmailConfigured(),
            enabledProviders
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // ANONYMOUS SIGN-IN
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * POST /auth/anonymous
     * Create an anonymous user with temporary credentials
     */
    router.post("/anonymous", strictAuthLimiter, async (c) => {
        const anonId = randomBytes(16).toString("hex");
        const anonEmail = `anon_${anonId.slice(0, 8)}@anonymous.local`;

        let createData: CreateUserData = {
            email: anonEmail,
            emailVerified: false,
            isAnonymous: true
        };

        if (ops.beforeUserCreate) {
            createData = await ops.beforeUserCreate(createData);
        }

        const user = await authRepo.createUser(createData);

        // Assign default role (follow register route pattern, but never auto-admin)
        if (config.defaultRole) {
            await authRepo.assignDefaultRole(user.id, config.defaultRole);
        }

        const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
            user.id,
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown"
        );

        // Fire afterUserCreate hook
        if (ops.afterUserCreate) {
            ops.afterUserCreate(user).catch(err => {
                console.error("[AuthHooks] afterUserCreate error:", err instanceof Error ? err.message : err);
            });
        }

        // Fire onAuthenticated hook
        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "anonymous").catch(err => {
                console.error("[AuthHooks] onAuthenticated error:", err instanceof Error ? err.message : err);
            });
        }

        return c.json(buildAuthResponse(user, roleIds, accessToken, refreshToken), 201);
    });

    /**
     * POST /auth/anonymous/link
     * Upgrade an anonymous user to a permanent account with email/password
     */
    router.post("/anonymous/link", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const user = await authRepo.getUserById(userCtx.userId);
        if (!user?.isAnonymous) {
            throw ApiError.badRequest("User is not anonymous", "NOT_ANONYMOUS");
        }

        const linkSchema = z.object({
            email: z.string().email("Invalid email address").max(255),
            password: z.string().min(1, "Password is required").max(128)
        });
        const { email, password } = parseBody(linkSchema, await c.req.json());

        // Validate password strength
        const passwordValidation = ops.validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            throw ApiError.badRequest(passwordValidation.errors.join(". "), "WEAK_PASSWORD");
        }

        // Check if email is already taken
        const existingUser = await authRepo.getUserByEmail(email.toLowerCase());
        if (existingUser) {
            throw ApiError.conflict("Email already registered", "EMAIL_EXISTS");
        }

        // Hash password
        const passwordHash = await ops.hashPassword(password);

        // Update user: set email, password, remove anonymous flag
        const updatedUser = await authRepo.updateUser(user.id, {
            email: email.toLowerCase(),
            passwordHash,
            isAnonymous: false
        });

        if (!updatedUser) {
            throw ApiError.notFound("User not found");
        }

        // Generate new tokens with updated identity
        const { roleIds, accessToken, refreshToken } = await createSessionAndTokens(
            user.id,
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown"
        );

        return c.json(buildAuthResponse(updatedUser, roleIds, accessToken, refreshToken));
    });

    // ═══════════════════════════════════════════════════════════════════════
    // MFA / TOTP
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * POST /auth/mfa/enroll
     * Start MFA enrollment: generate TOTP secret and recovery codes
     */
    router.post("/mfa/enroll", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
        const friendlyName = typeof body.friendlyName === "string" ? body.friendlyName : undefined;
        const issuer = typeof body.issuer === "string" ? body.issuer : (emailConfig?.appName || "Rebase");

        // Get user for account name
        const user = await authRepo.getUserById(userCtx.userId);
        if (!user) {
            throw ApiError.notFound("User not found");
        }

        // Generate TOTP secret
        const { secret, uri } = generateTotpSecret(issuer, user.email);

        // Store the factor (unverified until user confirms with a valid code)
        const factor = await authRepo.createMfaFactor(
            user.id,
            "totp",
            secret, // In production, encrypt this before storage
            friendlyName
        );

        // Generate recovery codes
        const codes = generateRecoveryCodes(10);
        const codeHashes = codes.map(hashRecoveryCode);
        await authRepo.createRecoveryCodes(user.id, codeHashes);

        return c.json({
            factor: {
                id: factor.id,
                factorType: factor.factorType,
                friendlyName: factor.friendlyName
            },
            totp: {
                secret,
                uri,
                qrUri: uri // Client can use a QR library to render this
            },
            recoveryCodes: codes
        }, 201);
    });

    /**
     * POST /auth/mfa/verify
     * Verify TOTP code to complete MFA enrollment
     */
    router.post("/mfa/verify", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const verifySchema = z.object({
            factorId: z.string().min(1, "Factor ID is required"),
            code: z.string().length(6, "Code must be 6 digits")
        });
        const { factorId, code } = parseBody(verifySchema, await c.req.json());

        // Get the factor
        const factor = await authRepo.getMfaFactorById(factorId);
        if (!factor || factor.userId !== userCtx.userId) {
            throw ApiError.notFound("MFA factor not found");
        }

        if (factor.verified) {
            throw ApiError.badRequest("Factor is already verified", "ALREADY_VERIFIED");
        }

        // Verify the TOTP code
        const secretBuffer = base32Decode(factor.secretEncrypted);
        const isValid = verifyTotp(secretBuffer, code);

        if (!isValid) {
            throw ApiError.unauthorized("Invalid TOTP code", "INVALID_CODE");
        }

        // Mark factor as verified
        await authRepo.verifyMfaFactor(factorId);

        return c.json({ success: true,
message: "MFA factor verified and enrolled" });
    });

    /**
     * POST /auth/mfa/challenge
     * Create an MFA challenge during login (user has MFA enrolled)
     */
    router.post("/mfa/challenge", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const challengeSchema = z.object({
            factorId: z.string().min(1, "Factor ID is required")
        });
        const { factorId } = parseBody(challengeSchema, await c.req.json());

        // Verify the factor belongs to this user and is verified
        const factor = await authRepo.getMfaFactorById(factorId);
        if (!factor || factor.userId !== userCtx.userId) {
            throw ApiError.notFound("MFA factor not found");
        }

        if (!factor.verified) {
            throw ApiError.badRequest("MFA factor is not yet verified", "FACTOR_NOT_VERIFIED");
        }

        const ipAddress = c.req.header("x-forwarded-for") || "unknown";
        const challenge = await authRepo.createMfaChallenge(factorId, ipAddress);

        return c.json({
            challengeId: challenge.id,
            factorId: challenge.factorId,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
        });
    });

    /**
     * POST /auth/mfa/challenge/verify
     * Verify a TOTP code for an active challenge, upgrade aal1 → aal2
     */
    router.post("/mfa/challenge/verify", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const challengeVerifySchema = z.object({
            challengeId: z.string().min(1, "Challenge ID is required"),
            code: z.string().min(1, "Code is required")
        });
        const { challengeId, code } = parseBody(challengeVerifySchema, await c.req.json());

        // Find the challenge
        const challenge = await authRepo.getMfaChallengeById(challengeId);
        if (!challenge) {
            throw ApiError.badRequest("Invalid or expired challenge", "INVALID_CHALLENGE");
        }

        // Get the factor and verify ownership
        const factor = await authRepo.getMfaFactorById(challenge.factorId);
        if (!factor || factor.userId !== userCtx.userId) {
            throw ApiError.notFound("MFA factor not found");
        }

        // Try TOTP verification first (standard 6-digit codes)
        const secretBuffer = base32Decode(factor.secretEncrypted);
        let isValid = verifyTotp(secretBuffer, code);

        // Fall back to recovery code verification if TOTP didn't match
        if (!isValid) {
            const codeHash = hashRecoveryCode(code);
            isValid = await authRepo.useRecoveryCode(userCtx.userId, codeHash);
        }

        if (!isValid) {
            throw ApiError.unauthorized("Invalid verification code", "INVALID_CODE");
        }

        // Mark challenge as verified
        await authRepo.verifyMfaChallenge(challengeId);

        // Generate new access token with aal2
        const roles = await authRepo.getUserRoles(userCtx.userId);
        const roleIds = roles.map(r => r.id);
        const accessToken = generateAccessToken(userCtx.userId, roleIds, "aal2");
        const refreshToken = generateRefreshToken();

        // Create new refresh token
        await authRepo.createRefreshToken(
            userCtx.userId,
            hashRefreshToken(refreshToken),
            getRefreshTokenExpiry(),
            c.req.header("user-agent") || "unknown",
            c.req.header("x-forwarded-for") || "unknown"
        );

        // Fire onMfaVerified hook
        if (ops.onMfaVerified) {
            ops.onMfaVerified(userCtx.userId, factor.id).catch(err => {
                console.error("[AuthHooks] onMfaVerified error:", err instanceof Error ? err.message : err);
            });
        }

        return c.json({
            tokens: {
                accessToken,
                refreshToken,
                accessTokenExpiresAt: getAccessTokenExpiry()
            }
        });
    });

    /**
     * GET /auth/mfa/factors
     * List enrolled MFA factors for the current user
     */
    router.get("/mfa/factors", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const factors = await authRepo.getMfaFactors(userCtx.userId);
        return c.json({
            factors: factors.map(f => ({
                id: f.id,
                factorType: f.factorType,
                friendlyName: f.friendlyName,
                verified: f.verified,
                createdAt: f.createdAt
            }))
        });
    });

    /**
     * DELETE /auth/mfa/unenroll
     * Remove an MFA factor
     */
    router.delete("/mfa/unenroll", requireAuth, async (c) => {
        const userCtx = c.get("user") as { userId: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const unenrollSchema = z.object({
            factorId: z.string().min(1, "Factor ID is required")
        });
        const { factorId } = parseBody(unenrollSchema, await c.req.json());

        // Verify ownership
        const factor = await authRepo.getMfaFactorById(factorId);
        if (!factor || factor.userId !== userCtx.userId) {
            throw ApiError.notFound("MFA factor not found");
        }

        await authRepo.deleteMfaFactor(factorId, userCtx.userId);

        // If no more verified factors, clean up recovery codes
        const hasFactors = await authRepo.hasVerifiedMfaFactors(userCtx.userId);
        if (!hasFactors) {
            await authRepo.deleteAllRecoveryCodes(userCtx.userId);
        }

        return c.json({ success: true,
message: "MFA factor removed" });
    });

    return router;
}
