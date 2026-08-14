import type { CollectionConfig } from "@rebasepro/types";
import type { RebaseAuthConfig } from "../init";
import type { EmailConfig } from "../email";
import type { RebaseBootEnv } from "./env";
import { normalizePemFromEnv } from "../auth/jwt-keys";

/**
 * Build the email configuration, or `undefined` when no SMTP host is set.
 *
 * Without it the auth adapter still works; password-reset and verification mail
 * simply has nowhere to go, which the auth routes report for themselves.
 */
export function resolveEmailOptions(env: RebaseBootEnv): EmailConfig | undefined {
    if (!env.SMTP_HOST) return undefined;

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
        resetPasswordUrl: env.FRONTEND_URL
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
