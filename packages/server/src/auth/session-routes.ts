import { Hono } from "hono";
import { normalizeEmail } from "@rebasepro/common";
import { z } from "zod";
import { randomBytes } from "crypto";
import { ApiError } from "../api/errors";
import { HonoEnv } from "../api/types";
import { requireAuth } from "./middleware";
import { extractBearerToken } from "./bearer-token";
import { logger } from "../utils/logger";
import { strictAuthLimiter, defaultAuthLimiter } from "./rate-limiter";
import { hashRefreshToken } from "./jwt";
import type { AuthModuleConfig } from "./routes";
import type { AuthResponsePayload, TransformAuthResponseContext } from "@rebasepro/types";
import { readRefreshToken, clearRefreshCookie } from "./cookie-utils";
import { isAnonymousAuthOpen } from "./registration-policy";
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

    /**
     * Refuse the anonymous routes unless the deployment opted in.
     *
     * 403 rather than 404: the route exists, and a client that was told
     * `anonymousLogin: true` by `GET /auth/config` and then sees a 404 has no
     * way to tell a disabled feature from a version skew. The error names the
     * key, because the failure this closes was an operator believing they had
     * already switched registration off.
     */
    function assertAnonymousAuthOpen(): void {
        if (isAnonymousAuthOpen({
            allowAnonymous: config.allowAnonymous,
            disableSelfRegistration: config.disableSelfRegistration
        })) return;
        throw ApiError.forbidden(
            config.disableSelfRegistration
                ? "Anonymous sign-in is disabled: disableSelfRegistration blocks it."
                : "Anonymous sign-in is disabled. Set `auth.allowAnonymous: true` to enable it.",
            "ANONYMOUS_AUTH_DISABLED"
        );
    }

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

    /**
     * POST /auth/logout
     */
    router.post("/logout", async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const parsed = parseBody(logoutSchema, body);
        const refreshToken = readRefreshToken(c, parsed, config.cookieAuth);

        if (refreshToken) {
            const tokenHash = hashRefreshToken(refreshToken);
            // Kill the whole sign-in, not just the token that happened to be
            // presented. Rotation can leave siblings alive (a second tab, a
            // replay inside the reuse window), and deleting one row would
            // leave the others perfectly usable — a logout that does not log
            // you out is worse than no logout at all.
            const stored = await authRepo.findRefreshTokenByHash(tokenHash).catch(() => null);
            const sessionId = stored?.sessionId;
            if (sessionId && authRepo.revokeRefreshTokenSession) {
                await authRepo.revokeRefreshTokenSession(sessionId);
            } else {
                await authRepo.deleteRefreshToken(tokenHash);
            }
        }

        // Always clear the cookie if in cookie mode
        clearRefreshCookie(c, config.cookieAuth);

        // Call afterLogout hook (fire-and-forget)
        // Extract uid from the access token if present
        const accessToken = extractBearerToken(c.req.header("authorization"));
        if (ops.afterLogout && accessToken !== undefined) {
            const { verifyAccessToken } = await import("./jwt");
            const payload = verifyAccessToken(accessToken);
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

        const tokens = await authRepo.listRefreshTokensForUser(userCtx.uid);

        // One entry per SIGN-IN, not per token row. Rotation leaves several
        // rows behind for one session (the live token, its superseded parent
        // inside the reuse window, a sibling minted for a second tab), and a
        // user reading "your devices" must not be shown three copies of the
        // laptop they are sitting at. Revoked rows are tombstones and never
        // appear at all.
        const bySession = new Map<string, typeof tokens[number]>();
        for (const token of tokens) {
            if (token.revoked) continue;
            const key = token.sessionId ?? token.id;
            const existing = bySession.get(key);
            // Keep the newest row of the session as its representative, so the
            // id offered for revocation belongs to a token that still exists.
            if (!existing || existing.createdAt < token.createdAt) bySession.set(key, token);
        }

        const mappedSessions = [...bySession.values()].map((s) => ({
            id: s.id,
            userAgent: s.userAgent,
            ipAddress: s.ipAddress,
            // The sign-in, not the last rotation — otherwise every session
            // looks like it started an hour ago, whatever its real age.
            createdAt: s.sessionStartedAt ?? s.createdAt,
            isCurrentSession: currentTokenHash
                ? tokens.some(t => t.tokenHash === currentTokenHash && (t.sessionId ?? t.id) === (s.sessionId ?? s.id))
                : false
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
        // Belt and braces: a refresh already in flight can insert a rotated
        // token a moment after the delete has run and walk away with a live
        // session. The watermark voids it on its next use.
        await authRepo.setTokensValidAfter?.(userCtx.uid, new Date()).catch(() => undefined);
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

        // The id names one token row, but the user is revoking a device — so
        // resolve it to its session and take the whole family down. Deleting
        // the single row would leave that device holding a live sibling.
        const owned = await authRepo.listRefreshTokensForUser(userCtx.uid).catch(() => []);
        const target = owned.find(t => t.id === id);
        if (target?.sessionId && authRepo.revokeRefreshTokenSession) {
            await authRepo.revokeRefreshTokenSession(target.sessionId);
        } else {
            await authRepo.deleteRefreshTokenById(id, userCtx.uid);
        }
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
            const user = await authRepo.getUserByEmail(normalizeEmail(email));
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
     * POST /auth/anonymous
     * Create an anonymous user with temporary credentials
     */
    router.post("/anonymous", strictAuthLimiter, async (c) => {
        assertAnonymousAuthOpen();

        // `email` is NOT NULL, so an anonymous user needs a synthetic address —
        // and it lands under a unique index, which makes the width of this
        // string a correctness property rather than cosmetics. It used to keep 8
        // of the 32 hex characters generated here: a 2^32 space, where a
        // collision is ~1% likely by 9,000 anonymous users and ~50% by 77,000,
        // surfacing as an unexplained 500 on sign-in for one unlucky visitor.
        // The entropy was already generated; there was no reason to discard it.
        const anonEmail = `anon_${randomBytes(16).toString("hex")}@anonymous.local`;

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
    router.post("/anonymous/link", strictAuthLimiter, requireAuth, async (c) => {
        // Gated on the same predicate as `/anonymous`, not on registration: this
        // route cannot create an account, only put credentials on one that
        // `/anonymous` already made. If anonymous auth is off, any session
        // reaching here predates the switch, and letting it finish would be a
        // second way to reach the state the switch exists to prevent.
        assertAnonymousAuthOpen();

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
        const existingUser = await authRepo.getUserByEmail(normalizeEmail(email));
        if (existingUser) {
            throw ApiError.conflict("Email already registered", "EMAIL_EXISTS");
        }

        // Hash password
        const passwordHash = await ops.hashPassword(password);

        // Update user: set email, password, remove anonymous flag
        const updatedUser = await authRepo.updateUser(user.id, {
            email: normalizeEmail(email),
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
