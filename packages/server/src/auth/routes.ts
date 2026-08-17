import { Hono } from "hono";
import { ADMINISTRATIVE_ROLES, isAdministrativeRole } from "./admin-roles";
import { normalizeEmail } from "@rebasepro/common";
import { ApiError, errorHandler } from "../api/errors";
import { randomBytes, randomUUID } from "crypto";
import { generateSecureToken, hashToken } from "./admin-user-ops";
import type { AuthRepository, OAuthProvider, CreateUserData } from "./interfaces";
import { generateAccessToken, generateRefreshToken, hashRefreshToken, getRefreshTokenExpiry, getAccessTokenExpiry } from "./jwt";
import type { AuthHooks } from "./auth-hooks";
import { resolveAuthHooks } from "./auth-hooks";
import { requireAuth } from "./middleware";
import { EmailService, EmailConfig, resolveEmailLinkBase } from "../email";
import { getPasswordResetTemplate, getEmailVerificationTemplate, getWelcomeEmailTemplate } from "../email/templates";
import { HonoEnv } from "../api/types";
import { defaultAuthLimiter, strictAuthLimiter, verificationEmailLimiter } from "./rate-limiter";
import { z } from "zod";
import { logger } from "../utils/logger";
import { mountMfaRoutes } from "./mfa-routes";
import { assertMfaSatisfied } from "./mfa-gate";
import { mountSessionRoutes } from "./session-routes";
import { mountMagicLinkRoutes } from "./magic-link-routes";
import { isSteadyStateRegistrationOpen } from "./registration-policy";
import { decideOAuthAutoLink, isRedirectUriAllowed } from "./oauth-signin-policy";
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
    /**
     * Redirect URIs the OAuth routes will accept, for every provider.
     *
     * Left unset, the only check is the provider's own registered-URI match,
     * which authorises every URI registered on that OAuth client. Compared on
     * origin plus path; query and fragment are ignored, as is a trailing slash.
     */
    allowedRedirectUris?: string[];
    /** When true, blocks all self-registration regardless of `allowRegistration`. */
    disableSelfRegistration?: boolean;
    /**
     * Opt-in: allow `POST /auth/anonymous` to mint a user without credentials.
     *
     * Off by default. See {@link isAnonymousAuthOpen} for why this is opt-in
     * rather than opt-out, and why `disableSelfRegistration` overrides it.
     */
    allowAnonymous?: boolean;
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
    /**
     * How long a refresh token stays usable after it has been rotated away,
     * in seconds. Default 10, matching GoTrue's `refresh_token_reuse_interval`.
     *
     * Rotation is only safe if the client is guaranteed to receive the
     * replacement, and no network guarantees that. A pod rolls mid-response, a
     * laptop suspends, a second tab boots at the same instant — and the client
     * is left holding a token the database has moved past. Within this window
     * that client is handed a fresh token of the same session instead of a
     * 401, which is the difference between a hiccup and being silently signed
     * out of an app you were using.
     *
     * Widen it if your clients are flaky or your deploys are long; the cost is
     * how long a captured token stays useful to someone who copied it.
     */
    refreshTokenReuseIntervalSeconds?: number;
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
    // Every administrative role, not just the one named "admin". This compared
    // against `"admin"` alone while `requireAdmin` accepted `schema-admin` too,
    // so `AUTH_DEFAULT_ROLE=schema-admin` walked past it and handed every public
    // registrant the schema editor and the SQL surfaces — from which real
    // `admin` is one user edit away.
    if (config.defaultRole && isAdministrativeRole(config.defaultRole)) {
        throw new Error(
            `CRITICAL SECURITY ERROR: defaultRole cannot be '${config.defaultRole}'. ` +
            `Administrative privilege escalation via registration is strictly forbidden ` +
            `(administrative roles: ${ADMINISTRATIVE_ROLES.join(", ")}). ` +
            "Use the POST /admin/bootstrap endpoint to promote the initial administrator."
        );
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
        // Always optional. The token may arrive in the body or, under cookieAuth,
        // in an httpOnly cookie, so "is a token present" cannot be decided at the
        // schema — `readRefreshToken` decides it, and the handler answers a
        // missing one with 401 NO_SESSION. Making the body field required in
        // non-cookie mode meant an anonymous visitor (who sends no body) got a
        // 400 INVALID_INPUT logged at warn on every page load, when the honest
        // answer is simply "not signed in".
        refreshToken: z.string().min(1).optional()
    });
    // `logoutSchema` and `updateProfileSchema` were declared here and used by
    // nothing: `/auth/logout` and `PATCH /auth/me` live in `session-routes.ts`,
    // which declares its own and applies them. Two copies of a validation rule,
    // one of them unreachable, is a rule that will be tightened in the wrong
    // file some day.

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
     * Whether registration is open without consulting the user table.
     *
     * The rule lives in `registration-policy.ts` and is shared with both config
     * endpoints, so what this route enforces and what they advertise cannot
     * drift apart — which is exactly how the empty-database dead end happened.
     *
     * `false` here does not mean "refuse": it means the answer depends on
     * whether the table is empty, which `POST /auth/register` checks only at
     * that point, because it serves anonymous callers and a count per rejected
     * attempt is a free hit on the database.
     */
    function isRegistrationAllowed(): boolean {
        return isSteadyStateRegistrationOpen({
            disableSelfRegistration: config.disableSelfRegistration,
            allowRegistration
        });
    }

    /**
     * Send welcome email to a newly registered user (fire-and-forget).
     */
    function sendWelcomeEmail(user: { email: string; displayName?: string | null }) {
        if (!isEmailConfigured()) return;
        const appName = emailConfig?.appName || "Rebase";
        const loginUrl = resolveEmailLinkBase(emailConfig, "resetPassword"); // reuse base URL → the login / app page
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
     * Helper to generate and store session tokens.
     *
     * Every route that signs somebody in comes through here — password login,
     * register, each OAuth provider, magic link, anonymous and anonymous-link —
     * which is why the second-factor gate is *inside* it rather than repeated at
     * each call site. An account with a verified factor gets no session from
     * this function at all: it throws `MFA_REQUIRED`, and the only thing that
     * mints a session for that user is `POST /auth/mfa/challenge/verify`.
     *
     * `skipMfaGate` exists for exactly one caller: the challenge-verify route
     * itself, which has just seen the second factor and mints at `aal2`.
     */
    async function createSessionAndTokens(
        uid: string,
        userAgent: string,
        ipAddress: string,
        options?: { skipMfaGate?: boolean; aal?: "aal1" | "aal2" }
    ) {
        if (!options?.skipMfaGate) {
            await assertMfaSatisfied(authRepo, uid);
        }
        const aal = options?.aal ?? "aal1";
        const roles = await authRepo.getUserRoles(uid);
        const roleIds = roles.map(r => r.id);

        // Allow customization of access token claims via hook
        let customClaims: Record<string, unknown> | undefined;
        if (ops.customizeAccessToken) {
            const user = await authRepo.getUserById(uid);
            if (user) {
                const defaultClaims: Record<string, unknown> = { uid,
roles: roleIds,
aal };
                customClaims = await ops.customizeAccessToken(defaultClaims, user);
            }
        }

        const accessToken = generateAccessToken(uid, roleIds, aal, customClaims);
        const refreshToken = generateRefreshToken();

        // A sign-in opens a session; every token later rotated out of it
        // inherits this id and start time. `startedAt` is what
        // `tokens_valid_after` is judged against, so it must NOT advance on
        // rotation — otherwise a session could stay one step ahead of a
        // revocation forever simply by refreshing.
        await authRepo.createRefreshToken(
            uid,
            hashRefreshToken(refreshToken),
            getRefreshTokenExpiry(),
            userAgent,
            ipAddress,
            { id: randomUUID(), startedAt: new Date(), aal }
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

        // Hard kill switch — blocks registration regardless of allowRegistration,
        // including the empty-database bootstrap exception below.
        if (config.disableSelfRegistration) {
            throw ApiError.forbidden("Registration is disabled", "REGISTRATION_DISABLED");
        }

        // Bootstrap exception: an empty user table always admits the first
        // registration, even with `allowRegistration: false` — see
        // isRegistrationAllowed() for why refusing here is a dead end. The
        // moment one user exists the flag is enforced again.
        let bootstrapRegistration = false;
        if (!isRegistrationAllowed()) {
            // Paginated on purpose: this runs for anonymous callers, and the
            // unbounded listUsers() would hand them a full-table fetch per
            // rejected attempt.
            const { total } = await authRepo.listUsersPaginated({ limit: 1 });
            bootstrapRegistration = total === 0;
            if (!bootstrapRegistration) {
                throw ApiError.forbidden("Registration is disabled", "REGISTRATION_DISABLED");
            }
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
            email: normalizeEmail(email),
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

        if (bootstrapRegistration && !isFirstUser) {
            // Two registrations raced through the empty-table check. Only the
            // genuine first user may ride the bootstrap exception — the loser
            // would otherwise become a regular account created while
            // registration is disabled. Undo it and report the gate.
            await authRepo.deleteUser(user.id);
            throw ApiError.forbidden("Registration is disabled", "REGISTRATION_DISABLED");
        }

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

                // Allowlist the redirect URI before the code is spent. The
                // provider's own registered-URI match authorises *every* URI
                // on that OAuth client — a leftover localhost entry, a staging
                // host, a second product sharing the client id — and any of
                // them can mint a code this backend would otherwise accept.
                const requestedRedirectUri = (payload as { redirectUri?: unknown }).redirectUri;
                if (typeof requestedRedirectUri === "string"
                    && !isRedirectUriAllowed(requestedRedirectUri, config.allowedRedirectUris)) {
                    throw ApiError.badRequest(
                        "redirectUri is not allowed for this backend",
                        "REDIRECT_URI_NOT_ALLOWED"
                    );
                }

                let externalUser;
                try {
                    externalUser = await provider.verify(payload);
                } catch (err: unknown) {
                    // The message is logged, never returned: a provider's
                    // token-endpoint error body routinely echoes the client_id,
                    // the redirect URI and diagnostics about the credential
                    // state, and this response goes to an anonymous caller.
                    logger.error(`[OAuth] ${provider.id} verification threw`, {
                        error: err instanceof Error ? err.message : String(err)
                    });
                    throw ApiError.unauthorized(`Invalid ${provider.id} credentials`, "OAUTH_ERROR");
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
                        const decision = decideOAuthAutoLink({
                            providerEmailVerified: externalUser.emailVerified,
                            existingUser: user
                        });
                        if (!decision.allowed) {
                            const why = decision.reason === "provider-email-unverified"
                                ? `${provider.id} has not verified this email address, so it cannot be linked automatically.`
                                : "That account's email address was never verified, so it cannot be linked automatically.";
                            throw ApiError.forbidden(
                                `An account with this email already exists with a different sign-in method. ${why} Sign in with your existing method, then POST to /auth/link/${provider.id} to link ${provider.id} to your account.`,
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
                        // Creating an account through an OAuth button is still
                        // registration, and used to be the one account-creating
                        // path that consulted no policy at all — kill switch
                        // included, first-user-becomes-admin included.
                        //
                        // The bare "Registration is disabled" that POST
                        // /auth/register returns is a non-sequitur here: nobody
                        // pressed a Create-account button, they pressed Sign in
                        // with Google and there is no account behind that
                        // identity. Say both halves, since the visitor can see
                        // neither.
                        const noSignupsMessage = `No account exists for this ${provider.id} identity, and new sign-ups are disabled on this backend. Ask an administrator to create your account.`;
                        if (config.disableSelfRegistration) {
                            throw ApiError.forbidden(noSignupsMessage, "REGISTRATION_DISABLED");
                        }
                        let bootstrapRegistration = false;
                        if (!isRegistrationAllowed()) {
                            const { total } = await authRepo.listUsersPaginated({ limit: 1 });
                            bootstrapRegistration = total === 0;
                            if (!bootstrapRegistration) {
                                throw ApiError.forbidden(noSignupsMessage, "REGISTRATION_DISABLED");
                            }
                        }

                        // Create new user. `emailVerified` was computed for the
                        // link decision above and used to be discarded here, so
                        // every OAuth account sat unverified forever — and was
                        // then exactly the unverified local account the link
                        // decision refuses to trust.
                        user = await authRepo.createUser({
                            email: normalizeEmail(externalUser.email),
                            displayName: externalUser.displayName || undefined,
                            photoUrl: externalUser.photoUrl || undefined,
                            emailVerified: externalUser.emailVerified === true
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

                        if (bootstrapRegistration && !isFirstUser) {
                            // Two sign-ups raced through the empty-table check;
                            // same undo as POST /auth/register.
                            await authRepo.deleteUser(user.id);
                            throw ApiError.forbidden(noSignupsMessage, "REGISTRATION_DISABLED");
                        }

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
            const baseUrl = resolveEmailLinkBase(emailConfig, "resetPassword");
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

        // Invalidate all refresh tokens (security: log out all sessions).
        // The watermark is what makes this airtight: deleting rows only
        // catches the sessions that exist at this instant, and the whole
        // point of a reset is that someone else may be holding a token and
        // actively refreshing it.
        await authRepo.deleteAllRefreshTokensForUser(storedToken.uid);
        await authRepo.setTokensValidAfter?.(storedToken.uid, new Date()).catch(() => undefined);

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
        await authRepo.setTokensValidAfter?.(user.id, new Date()).catch(() => undefined);

        return c.json({ success: true,
message: "Password has been changed successfully" });
    });

    /**
     * POST /auth/send-verification
     * Send email verification link (authenticated)
     *
     * Two limiters, because they bound different things: `strictAuthLimiter`
     * bounds the caller by IP as it does on every other email-sending route, and
     * `verificationEmailLimiter` bounds how much mail one account — i.e. one
     * recipient address — can be made to receive. Authentication is not a bound
     * here: the address is unverified by construction, so an attacker can hold a
     * session for a mailbox that is not theirs.
     */
    router.post("/send-verification", strictAuthLimiter, requireAuth, verificationEmailLimiter, async (c) => {
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

        // Build verification URL. `verifyEmailUrl` is set by no boot path, so
        // this used to be `""` — a relative href, dead in every mail client,
        // reported as `{ success: true }`. The resolver falls back to the reset
        // base, and `createEmailService` refuses to boot when neither is absolute.
        const baseUrl = resolveEmailLinkBase(emailConfig, "verifyEmail");
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
            // Presenting no token at all is not a malformed request — it is an
            // unauthenticated one, and the overwhelmingly common case is a
            // first-time visitor, because clients refresh on page load before
            // they know whether a session exists. Answering 400 INVALID_INPUT
            // told them their request was wrong and logged a warning for every
            // anonymous page view. The invalid- and expired-token branches below
            // already answer 401; having no token is the same class of thing.
            throw ApiError.unauthenticated("No refresh token presented", "NO_SESSION");
        }

        const tokenHash = hashRefreshToken(refreshToken);
        const storedToken = await authRepo.findRefreshTokenByHash(tokenHash);

        if (!storedToken) {
            // Deliberately NOT clearing the cookie. A token we do not recognise
            // means we cannot authenticate THIS request; it does not mean the
            // credential in the browser should be destroyed. Clearing here made
            // any single stale request — a duplicate from a second tab, a retry
            // after a rolled pod — permanently sign out a user whose session was
            // otherwise perfectly alive, because the good cookie went with it.
            throw ApiError.unauthorized("Invalid refresh token", "INVALID_TOKEN");
        }

        if (storedToken.revoked) {
            // A hard kill: logout, a remotely revoked device, an admin action.
            // Unlike the case above this session really is over, so clearing is
            // correct — there is nothing left for the cookie to authenticate.
            clearRefreshCookie(c, config.cookieAuth);
            throw ApiError.unauthorized("Session has been revoked", "SESSION_REVOKED");
        }

        if (new Date() > storedToken.expiresAt) {
            await authRepo.deleteRefreshToken(tokenHash);
            clearRefreshCookie(c, config.cookieAuth);
            throw ApiError.unauthorized("Refresh token expired", "TOKEN_EXPIRED");
        }

        // A session that began before the user's revocation mark is void, even
        // if its row survived. This closes the race in which a refresh already
        // in flight inserts a rotated token microseconds after a password reset
        // has deleted every row it could see.
        const sessionStartedAt = storedToken.sessionStartedAt ?? storedToken.createdAt;
        const tokensValidAfter = await authRepo.getTokensValidAfter?.(storedToken.uid).catch(() => null);
        if (tokensValidAfter && sessionStartedAt < tokensValidAfter) {
            await authRepo.deleteRefreshToken(tokenHash);
            clearRefreshCookie(c, config.cookieAuth);
            throw ApiError.unauthorized("Session has been revoked", "SESSION_REVOKED");
        }

        // A token that was already rotated away is the normal signature of a
        // client that never received the answer — a response lost to a deploy,
        // a suspended laptop, two tabs booting together. Inside the reuse window
        // it earns a fresh token of the same session rather than a 401.
        const reuseWindowMs = Math.max(0, config.refreshTokenReuseIntervalSeconds ?? 10) * 1000;
        const supersededAt = storedToken.rotatedAt ? new Date(storedToken.rotatedAt) : null;
        if (supersededAt && Date.now() - supersededAt.getTime() > reuseWindowMs) {
            // Outside the window we decline the request but leave the session
            // standing: the live token this one was rotated into is still good,
            // and punishing its holder for a late straggler is how a legitimate
            // user gets signed out. Logged because a genuine replay of an old
            // token — long after it was superseded — is also what a stolen
            // token looks like, and that signal should not vanish silently.
            logger.warn("[Auth] Refresh token replayed after the reuse window", {
                uid: storedToken.uid,
                sessionId: storedToken.sessionId,
                supersededSecondsAgo: Math.round((Date.now() - supersededAt.getTime()) / 1000),
                userAgent: c.req.header("user-agent") || "unknown"
            });
            throw ApiError.unauthorized("Refresh token already used", "TOKEN_ALREADY_USED");
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

        // The assurance level is a property of the sign-in, and rotation is not
        // a new sign-in — so it is read off the presented token's row and
        // carried forward. Hardcoding `aal1` here meant an MFA-verified session
        // silently dropped back to password-grade within one access-token
        // lifetime, which both defeats the step-up and locks the user out of
        // the operations that require it. A row with no stored value (written
        // before the column existed, or by a repository that does not keep it)
        // reads as `aal1`, the restrictive value.
        const sessionAal: "aal1" | "aal2" = storedToken.aal === "aal2" ? "aal2" : "aal1";

        // Allow customization of access token claims via hook
        let customClaims: Record<string, unknown> | undefined;
        if (ops.customizeAccessToken && user) {
            const defaultClaims: Record<string, unknown> = { uid: storedToken.uid,
roles: roleIds,
aal: sessionAal };
            customClaims = await ops.customizeAccessToken(defaultClaims, user);
        }

        const newAccessToken = generateAccessToken(storedToken.uid, roleIds, sessionAal, customClaims);
        const newRefreshToken = generateRefreshToken();

        // Rotate: mark the presented token superseded and mint its successor
        // into the same session. Note the ORDER and the absence of a delete —
        // the old row has to survive, because it is the only thing that can
        // tell a client replaying it apart from a stranger.
        //
        // If the presented token was ALREADY superseded (a replay inside the
        // reuse window, allowed above), leave the existing rotation stamp alone
        // and simply add a sibling: two tabs then hold two live tokens of one
        // session, which is exactly what we want them to have.
        const userAgent = c.req.header("user-agent") || "unknown";
        const ipAddress = c.req.header("x-forwarded-for") || "unknown";
        const session = {
            id: storedToken.sessionId ?? storedToken.id,
            startedAt: sessionStartedAt,
            aal: sessionAal
        };

        if (!supersededAt) {
            if (authRepo.markRefreshTokenRotated) {
                await authRepo.markRefreshTokenRotated(tokenHash);
            } else {
                // Repository from an older release: no way to record the
                // supersession, so fall back to the lossy delete.
                await authRepo.deleteRefreshToken(tokenHash);
            }
        }

        await authRepo.createRefreshToken(
            storedToken.uid,
            hashRefreshToken(newRefreshToken),
            getRefreshTokenExpiry(),
            userAgent,
            ipAddress,
            session
        );

        // Housekeeping, deliberately after the new token exists and never
        // allowed to fail the request: rotation adds a row per refresh, and
        // nothing else would ever remove them.
        authRepo.pruneRefreshTokens?.(
            storedToken.uid,
            session.id,
            new Date(Date.now() - reuseWindowMs)
        ).catch((err: unknown) => {
            logger.warn("[Auth] Refresh token prune failed", {
                error: err instanceof Error ? err.message : String(err)
            });
        });

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
    mountMfaRoutes({
        router,
        config,
        ops,
        parseBody,
        buildAuthResponse,
        createSessionAndTokens,
        applyTransformHook
    });

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
