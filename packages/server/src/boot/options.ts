import type { CollectionConfig } from "@rebasepro/types";
import type { RebaseAuthConfig } from "../init";
import type { EmailConfig } from "../email";
import { createDevEmailSink, registerDevEmailSink } from "../email/dev-sink";
import type { CaptchaConfig, CaptchaRoute } from "../auth/captcha";
import type { RebaseBootEnv } from "./env";
import { normalizePemFromEnv } from "../auth/jwt-keys";

/**
 * True when an emailed link would be followable — i.e. when there is an
 * absolute base to build one from. Mirrors `assertEmailLinkBases`, which
 * refuses the boot otherwise.
 */
function hasAbsoluteLinkBase(value: string | undefined): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Build the email configuration.
 *
 * With `SMTP_HOST`, that is a real SMTP transport. Without it, outside
 * production, it is the development sink: mail is captured and its links are
 * printed, so `POST /auth/magic-link` and `POST /auth/forgot-password` complete
 * on a fresh project instead of answering `503 EMAIL_NOT_CONFIGURED`. The token
 * was always minted and valid; only delivery was missing.
 *
 * Three conditions, all required, none configurable:
 *
 *  - no `SMTP_HOST` — a configured mail server always wins;
 *  - `NODE_ENV` is not `production` — a captured reset mail carries a working
 *    token, so this must not be reachable there (see `dev-sink.ts`);
 *  - an absolute `FRONTEND_URL`, or the emailed link has no base and is dead on
 *    arrival — which is the condition `assertEmailLinkBases` fails the boot on.
 *
 * When any of those does not hold this returns `undefined`, exactly as before,
 * and the auth routes report the missing service for themselves.
 */
export function resolveEmailOptions(env: RebaseBootEnv): EmailConfig | undefined {
    if (!env.SMTP_HOST) {
        if (env.NODE_ENV === "production") return undefined;
        if (!hasAbsoluteLinkBase(env.FRONTEND_URL)) return undefined;

        return {
            from: env.SMTP_FROM || `${env.APP_NAME} <noreply@rebase.pro>`,
            // Registered, not just constructed: the handle is what lets
            // `GET /api/admin/dev/emails` show the captured message, so a
            // magic link can be opened without a mail server or a terminal.
            sendEmail: registerDevEmailSink(createDevEmailSink()).sendEmail,
            appName: env.APP_NAME,
            logoUrl: env.EMAIL_LOGO_URL,
            resetPasswordUrl: env.FRONTEND_URL
        };
    }

    return {
        from: env.SMTP_FROM || `${env.APP_NAME} <noreply@rebase.pro>`,
        smtp: {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth: env.SMTP_USER
                ? { user: env.SMTP_USER,
pass: env.SMTP_PASS ?? "" }
                : undefined,
            name: env.SMTP_NAME
        },
        appName: env.APP_NAME,
        logoUrl: env.EMAIL_LOGO_URL,
        resetPasswordUrl: env.FRONTEND_URL
    };
}

/**
 * Bot protection from the environment, or `undefined` when it is not configured.
 *
 * Both halves are required together. A provider with no secret cannot verify
 * anything, so it is left off here and `resolveCaptchaVerifier` refuses the boot
 * if something else turns it on — the one failure this feature must not have is
 * being silently absent while the config says otherwise.
 */
export function resolveCaptchaOptions(env: RebaseBootEnv): CaptchaConfig | undefined {
    if (!env.CAPTCHA_PROVIDER || !env.CAPTCHA_SECRET) return undefined;

    const routes = env.CAPTCHA_ROUTES
        ?.split(",")
        .map(part => part.trim())
        .filter(Boolean) as CaptchaRoute[] | undefined;

    return {
        enabled: true,
        provider: env.CAPTCHA_PROVIDER,
        secret: env.CAPTCHA_SECRET,
        ...(routes?.length ? { routes } : {})
    };
}

/**
 * Build the auth configuration from the environment and the bundle's users
 * collection.
 *
 * OAuth providers are included only when both halves of a credential pair are
 * present. Google is the exception the template already made: a client id alone
 * is enough, because the ID-token flow needs no secret.
 */
export function resolveAuthOptions(
    env: RebaseBootEnv,
    usersCollection: CollectionConfig | undefined
): RebaseAuthConfig {
    const auth: RebaseAuthConfig = {
        collection: usersCollection,
        jwtSecret: env.JWT_SECRET,
        // One key from the environment. A rotation window needs two at once,
        // which is more than an env var wants to express — configure
        // `auth.signingKeys` directly for that.
        signingKeys: env.JWT_PRIVATE_KEY
            ? [{ kid: env.JWT_KEY_ID, privateKey: normalizePemFromEnv(env.JWT_PRIVATE_KEY) }]
            : undefined,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        serviceKey: env.REBASE_SERVICE_KEY,
        requireAuth: env.AUTH_REQUIRE,
        allowRegistration: env.ALLOW_REGISTRATION,
        disableSelfRegistration: env.DISABLE_SELF_REGISTRATION,
        allowAnonymous: env.ALLOW_ANONYMOUS,
        allowUserLookup: env.AUTH_ALLOW_USER_LOOKUP,
        captcha: resolveCaptchaOptions(env),
        email: resolveEmailOptions(env),
        // Cookie auth keeps the refresh token in an httpOnly cookie rather than
        // localStorage, putting it out of reach of XSS. Enabling it costs a
        // token-flow client nothing — the client opts in via `authFlowMode` —
        // so the safer flow is simply always available.
        cookieAuth: { sameSite: env.AUTH_COOKIE_SAME_SITE || "Lax" }
    };

    if (env.AUTH_DEFAULT_ROLE) {
        auth.defaultRole = env.AUTH_DEFAULT_ROLE;
    }

    if (env.GOOGLE_CLIENT_ID) {
        auth.google = {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET
        };
    }
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
        auth.github = {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET
        };
    }
    if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
        auth.microsoft = {
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET
        };
    }

    return auth;
}
