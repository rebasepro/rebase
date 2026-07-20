import { Hono } from "hono";
import { z } from "zod";
import { randomBytes } from "crypto";
import { ApiError } from "../api/errors";
import { HonoEnv } from "../api/types";
import { requireAuth } from "./middleware";
import { logger } from "../utils/logger";
import { strictAuthLimiter, defaultAuthLimiter } from "./rate-limiter";
import { hashRefreshToken } from "./jwt";
import type { AuthModuleConfig } from "./routes";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";
import { readRefreshToken, clearRefreshCookie } from "./cookie-utils";
import type { resolveAuthHooks } from "./auth-hooks";
import type { CreateUserData } from "./interfaces";

interface SessionRoutesConfig {
    router: Hono<HonoEnv>;
    config: AuthModuleConfig;
    ops: ReturnType<typeof resolveAuthHooks>;
    parseBody: <T>(schema: z.ZodSchema<T>, body: unknown) => T;
    buildAuthResponse: (
        user: { id: string; email: string; displayName?: string | null; photoUrl?: string | null; emailVerified?: boolean; isAnonymous?: boolean; metadata?: Record<string, unknown> | null },
        roleIds: string[],
        accessToken: string,
        refreshToken: string,
        providerId: string
    ) => unknown;
    createSessionAndTokens: (uid: string, userAgent: string, ipAddress: string) => Promise<{
        roleIds: string[];
        accessToken: string;
        refreshToken: string;
    }>;
    applyTransformHook: (
        response: AuthResponsePayload,
        method: TransformAuthResponseContext["method"],
        request: Request,
        uid: string
    ) => Promise<AuthResponsePayload>;
}

export function mountSessionRoutes(opts: SessionRoutesConfig): void {
    const { router, config, ops, parseBody, buildAuthResponse, createSessionAndTokens, applyTransformHook } = opts;
    const authRepo = config.authRepo;

    const logoutSchema = z.object({
        refreshToken: z.string().optional()
    });

    const linkSchema = z.object({
        email: z.string().email("Invalid email address").max(255),
        password: z.string().min(1, "Password is required").max(128)
    });

    const updateProfileSchema = z.object({
        displayName: z.string().max(255).optional(),
        photoURL: z.string().url().max(2048).optional()
    });

    const findUserSchema = z.object({
        email: z.string().email("Invalid email address").max(255)
    });

    const isEmailConfigured = () => !!(config.emailService && config.emailService.isConfigured());

    /**
     * POST /auth/logout
     */
    router.post("/logout", async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const parsed = parseBody(logoutSchema, body);
        const refreshToken = readRefreshToken(c, parsed, config.cookieAuth);

        if (refreshToken) {
            const tokenHash = hashRefreshToken(refreshToken);
            await authRepo.deleteRefreshToken(tokenHash);
        }

        // Always clear the cookie if in cookie mode
        clearRefreshCookie(c, config.cookieAuth);

        // Call afterLogout hook (fire-and-forget)
        // Extract uid from the access token if present
        const authHeader = c.req.header("authorization");
        if (ops.afterLogout && authHeader?.startsWith("Bearer ")) {
            const { verifyAccessToken } = await import("./jwt");
            const payload = verifyAccessToken(authHeader.substring(7));
            if (payload) {
                ops.afterLogout(payload.uid).catch((err: unknown) => {
                    logger.error("[AuthHooks] afterLogout error", {
                        error: err instanceof Error ? err.message : err
                    });
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
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const currentRefreshToken = c.req.header("x-refresh-token") as string;
        const currentTokenHash = currentRefreshToken ? hashRefreshToken(currentRefreshToken) : null;

        const sessions = await authRepo.listRefreshTokensForUser(userCtx.uid);

        const mappedSessions = sessions.map((s) => ({
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
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        await authRepo.deleteAllRefreshTokensForUser(userCtx.uid);
        return c.json({
            success: true,
            message: "All sessions revoked successfully"
        });
    });

    /**
     * DELETE /auth/sessions/:id
     * Delete a specific refresh token (remote logout)
     */
    router.delete("/sessions/:id", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const id = c.req.param("id");
        if (!id) {
            throw ApiError.badRequest("Session ID is required", "INVALID_INPUT");
        }

        await authRepo.deleteRefreshTokenById(id, userCtx.uid);
        return c.json({
            success: true,
            message: "Session revoked successfully"
        });
    });

    /**
     * GET /auth/me
     * Get current authenticated user
     */
    router.get("/me", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const result = await authRepo.getUserWithRoles(userCtx.uid);
        if (!result) {
            throw ApiError.notFound("User not found");
        }

        return c.json({
            user: {
                uid: result.user.id,
                email: result.user.email,
                displayName: result.user.displayName,
                photoURL: result.user.photoUrl,
                providerId: "password",
                isAnonymous: result.user.isAnonymous ?? false,
                emailVerified: result.user.emailVerified,
                roles: result.roles.map((r) => r.id),
                metadata: result.user.metadata ?? {}
            }
        });
    });

    /**
     * POST /auth/find-user
     * Resolve an email to a MINIMAL public profile (uid, displayName, photoURL).
     * Opt-in (`auth.allowUserLookup`) and authenticated-only — powers
     * invite-by-email flows without exposing the users table or a custom admin
     * server function. Never returns the email, roles, metadata, or any other
     * field of the looked-up user.
     */
    if (config.allowUserLookup) {
        router.post("/find-user", defaultAuthLimiter, requireAuth, async (c) => {
            const userCtx = c.get("user") as { uid: string } | undefined;
            if (!userCtx) {
                throw ApiError.unauthorized("Not authenticated");
            }
            const { email } = parseBody(findUserSchema, await c.req.json());
            const user = await authRepo.getUserByEmail(email.toLowerCase());
            return c.json({
                user: user
                    ? { uid: user.id, displayName: user.displayName ?? null, photoURL: user.photoUrl ?? null }
                    : null
            });
        });
    }

    /**
     * PATCH /auth/me
     * Update current authenticated user profile
     */
    router.patch("/me", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const { displayName, photoURL } = parseBody(updateProfileSchema, await c.req.json());

        const updatedUser = await authRepo.updateUser(userCtx.uid, {
            displayName: displayName !== undefined ? displayName : undefined,
            photoUrl: photoURL !== undefined ? photoURL : undefined
        });

        if (!updatedUser) {
            throw ApiError.notFound("User not found");
        }

        const result = await authRepo.getUserWithRoles(userCtx.uid);
        if (!result) {
            throw ApiError.notFound("User not found");
        }

        return c.json({
            user: {
                uid: result.user.id,
                email: result.user.email,
                displayName: result.user.displayName,
                photoURL: result.user.photoUrl,
                providerId: "password",
                isAnonymous: result.user.isAnonymous ?? false,
                emailVerified: result.user.emailVerified,
                roles: result.roles.map((r) => r.id),
                metadata: result.user.metadata ?? {}
            }
        });
    });

    /**
     * GET /auth/config
     * Get public auth configuration
     */
    router.get("/config", defaultAuthLimiter, async (c) => {
        let needsSetup: boolean;
        if (config.isBootstrapCompleted) {
            needsSetup = !(await config.isBootstrapCompleted());
        } else {
            const allUsers = await authRepo.listUsers();
            needsSetup = allUsers.length === 0;
        }

        const registrationAllowed = needsSetup || !!config.allowRegistration;
        const enabledProviders = (config.oauthProviders || []).map((p) => p.id);

        return c.json({
            needsSetup,
            registrationEnabled: registrationAllowed,
            emailServiceEnabled: isEmailConfigured(),
            magicLinkEnabled: !!config.enableMagicLink && isEmailConfigured(),
            enabledProviders
        });
    });

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
            ops.afterUserCreate(user).catch((err: unknown) => {
                logger.error("[AuthHooks] afterUserCreate error", {
                    error: err instanceof Error ? err.message : err
                });
            });
        }

        // Fire onAuthenticated hook
        if (ops.onAuthenticated) {
            ops.onAuthenticated(user, "anonymous").catch((err: unknown) => {
                logger.error("[AuthHooks] onAuthenticated error", {
                    error: err instanceof Error ? err.message : err
                });
            });
        }

        const authResponse = buildAuthResponse(user, roleIds, accessToken, refreshToken, "anonymous") as AuthResponsePayload;
        const finalResponse = await applyTransformHook(authResponse, "anonymous", c.req.raw, user.id);
        return c.json(finalResponse, 201);
    });

    /**
     * POST /auth/anonymous/link
     * Upgrade an anonymous user to a permanent account with email/password
     */
    router.post("/anonymous/link", requireAuth, async (c) => {
        const userCtx = c.get("user") as { uid: string; roles?: string[] } | undefined;
        if (!userCtx) {
            throw ApiError.unauthorized("Not authenticated");
        }

        const user = await authRepo.getUserById(userCtx.uid);
        if (!user?.isAnonymous) {
            throw ApiError.badRequest("User is not anonymous", "NOT_ANONYMOUS");
        }

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

        const authResponse = buildAuthResponse(updatedUser, roleIds, accessToken, refreshToken, "password") as AuthResponsePayload;
        const finalResponse = await applyTransformHook(authResponse, "anonymous", c.req.raw, user.id);
        return c.json(finalResponse);
    });
}
