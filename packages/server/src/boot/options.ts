import type { CollectionConfig } from "@rebasepro/types";
import type { RebaseAuthConfig } from "../init";
import type { EmailConfig } from "../email";
import { createDevEmailSink, registerDevEmailSink } from "../email/dev-sink";
import type { CaptchaConfig, CaptchaRoute } from "../auth/captcha";
import type { RebaseBootEnv } from "./env";
import { normalizePemFromEnv } from "../auth/jwt-keys";
import { logger } from "../utils/logger";

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
/**
 * The OAuth providers configured from a plain `<PROVIDER>_CLIENT_ID` /
 * `_CLIENT_SECRET` pair, spelled exactly as the field on `RebaseAuthConfig`.
 *
 * Google, GitHub and Microsoft are handled above because their shapes differ
 * (Google's secret is optional, Microsoft carries a tenant); Apple is below
 * because it has no static secret at all.
 */
const ENV_PAIR_PROVIDERS = [
    "linkedin",
    "facebook",
    "twitter",
    "discord",
    "gitlab",
    "bitbucket",
    "slack",
    "spotify"
] as const satisfies readonly (keyof RebaseAuthConfig)[];

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
        magicLink: env.AUTH_MAGIC_LINK,
        emailOtp: env.AUTH_EMAIL_OTP,
        email: resolveEmailOptions(env),
        // Cookie auth keeps the refresh token in an httpOnly cookie rather than
        // localStorage, putting it out of reach of XSS. Enabling it costs a
        // token-flow client nothing — the client opts in via `authFlowMode` —
        // so the safer flow is simply always available.
        //
        // `secure` is passed through rather than left undefined so that a
        // deployment configured entirely by environment can reach it at all:
        // `getCookieSettings` defaults an absent value to `Secure`, which is
        // right, but left `AUTH_COOKIE_SECURE=false` with nothing to set.
        cookieAuth: {
            sameSite: env.AUTH_COOKIE_SAME_SITE || "Lax",
            secure: env.AUTH_COOKIE_SECURE
        }
    };

    // Loud, because it is the one setting here that makes a credential
    // travel in cleartext, and because the symptom of getting it wrong in the
    // other direction (a browser silently dropping the cookie) is what leads
    // people to set it. Named at boot so it appears in the log of the
    // deployment that has it, not only in the config of the one that wrote it.
    if (env.AUTH_COOKIE_SECURE === false) {
        logger.warn(
            "AUTH_COOKIE_SECURE=false — the refresh cookie is being sent without `Secure`, so it " +
            "travels in cleartext over plain http. That is a long-lived credential: only do this " +
            "on a network you control, and put TLS in front of this deployment before it is public."
        );
    }

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

    // The rest of the twelve. Each is the same two lines, so they are a loop
    // rather than nine near-identical blocks: the failure this is fixing is one
    // provider being forgotten, and a list is easier to compare against
    // `ls src/auth/*-oauth.ts` than nine hand-written ifs. `oauth-env-coverage`
    // does that comparison.
    for (const provider of ENV_PAIR_PROVIDERS) {
        const clientId = env[`${provider.toUpperCase()}_CLIENT_ID` as keyof RebaseBootEnv] as string | undefined;
        const clientSecret = env[`${provider.toUpperCase()}_CLIENT_SECRET` as keyof RebaseBootEnv] as string | undefined;
        if (clientId && clientSecret) {
            auth[provider] = { clientId, clientSecret };
        }
    }

    // Apple has no static secret to pair with the id: `createAppleProvider`
    // signs a short-lived ES256 JWT per token exchange. All four or nothing —
    // a partial set would build a provider that fails at the first sign-in
    // rather than at boot.
    if (env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) {
        auth.apple = {
            clientId: env.APPLE_CLIENT_ID,
            teamId: env.APPLE_TEAM_ID,
            keyId: env.APPLE_KEY_ID,
            privateKey: normalizePemFromEnv(env.APPLE_PRIVATE_KEY)
        };
    }

    return auth;
}
