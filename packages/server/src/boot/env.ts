import { z } from "zod";
import { loadEnv, type RebaseEnv } from "../env";
import { BundleError } from "./bundle";

/**
 * The environment a bundle-booted runtime understands.
 *
 * This extends the base {@link loadEnv} schema with the variables an application
 * used to declare for itself in its own `env.ts`. They live here now because the
 * runtime, not the application, is what reads them: a project ships a bundle and
 * a set of environment variables, and everything either side needs to agree on
 * has to be part of the contract rather than a convention each project reinvents.
 */
const bootEnvExtension = z.object({
    // ── Email ────────────────────────────────────────────────────────────────
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().default("587").transform(Number),
    SMTP_SECURE: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    SMTP_NAME: z.string().optional(),
    APP_NAME: z.string().default("Rebase"),
    /**
     * Logo shown above the card in the default email templates, at 48x48.
     *
     * Must be a PNG or JPG on an absolute `http(s)` URL: mail clients do not
     * render SVG and block `data:` URIs, and the image is fetched by the
     * recipient's client rather than by this process. Anything else renders no
     * logo rather than a broken image — see `resolveEmailBranding`.
     *
     * Left unset, an app that still answers to the default `APP_NAME` gets the
     * Rebase mark and one that has renamed itself gets nothing. This is the only
     * way a managed tenant, which ships no code of its own, can set its own.
     */
    EMAIL_LOGO_URL: z.string().optional(),

    // ── Runtime behaviour ────────────────────────────────────────────────────
    /**
     * Serve the bundle's static/admin assets from this process.
     *
     * Default on, because a self-hosted single-container deployment is the case
     * that needs it and the assets are simply absent when there is nothing to
     * serve. A platform putting a CDN in front turns it off.
     */
    REBASE_SERVE_STATIC: z.enum(["true", "false", ""]).default("true").transform(v => v !== "false"),
    /**
     * What the runtime may do to the database schema at boot.
     *
     * - `none` — touch nothing. The schema is provisioned by something else: a
     *   migration step, or another process in a split deployment.
     * - anything else, **including unset** — run the additive provisioning pass
     *   in `boot/provision.ts`: create missing tables, columns and enum types,
     *   never drop or rewrite one.
     *
     * The default is `ensure` everywhere, production included — see
     * `provisioningDisabled`, which is the single place the value is read and
     * which only asks whether it is `none`.
     *
     * `push` is in the enum and is **not** distinguished from `ensure` anywhere
     * in the boot path; nothing implements "reconcile destructively" here. The
     * published image goes further and refuses to start on it
     * (`infra/docker/entrypoint.mjs`), because a full push computes a diff and will
     * happily `DROP COLUMN` — and a container restart must never be able to
     * destroy a production column as a side effect of rescheduling. Reshaping
     * and destructive changes stay a deliberate `rebase db generate` + `rebase
     * db migrate`, or a reviewed `rebase db push` from a checkout.
     */
    REBASE_MIGRATE_ON_BOOT: z.enum(["none", "ensure", "push", ""]).optional(),
    /** Expose Prometheus metrics at `/metrics`. Off unless asked for. */
    REBASE_METRICS: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
    /**
     * Bearer token guarding `/metrics`. When unset the endpoint is open to
     * anyone who can reach the port, which is fine on a private network and not
     * fine on a public one — hence the boot-time warning rather than a silent
     * default.
     */
    REBASE_METRICS_TOKEN: z.string().optional(),
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug", ""]).optional(),

    // ── Storage access control ───────────────────────────────────────────────
    /** Serve stored objects to unauthenticated readers. */
    STORAGE_PUBLIC_READ: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
    /**
     * Write derived image renditions back to the storage source, so a transform
     * survives a restart and is computed once across instances rather than once
     * per instance. Costs one PUT per new variant; see `rendition-cache.ts`.
     */
    STORAGE_RENDITION_CACHE: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
    /**
     * Opt out of the storage access-control boot guard, restoring the behaviour
     * where any authenticated user may read, overwrite, delete or list any key.
     * Only defensible when every signed-in user is trusted with every file.
     */
    STORAGE_ALLOW_ANY_AUTHENTICATED: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),

    // ── Auth ─────────────────────────────────────────────────────────────────
    AUTH_REQUIRE: z.enum(["true", "false", ""]).default("true").transform(v => v !== "false"),
    AUTH_ALLOW_USER_LOOKUP: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
    /**
     * Passwordless email sign-in, both shapes of it.
     *
     * Both were code-level flags only, so a bundle deployment — the shape every
     * self-hosted and managed project runs — could not turn either on without
     * rebuilding. That is the wrong place for the switch: whether a deployment
     * wants passwordless login is a property of the deployment.
     */
    AUTH_MAGIC_LINK: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
    AUTH_EMAIL_OTP: z.enum(["true", "false", ""]).default("false").transform(v => v === "true"),
    /**
     * Bot protection. Enabled by setting both — a provider without a secret
     * cannot verify anything, and is refused at boot rather than ignored.
     */
    CAPTCHA_PROVIDER: z.enum(["turnstile", "hcaptcha", ""]).optional(),
    CAPTCHA_SECRET: z.string().optional(),
    /** Comma-separated: register, login, forgotPassword, magicLink, emailOtp. */
    CAPTCHA_ROUTES: z.string().optional(),
    AUTH_COOKIE_SAME_SITE: z.enum(["Strict", "Lax", "None", ""]).optional(),
    /**
     * `Secure` on the refresh cookie. On by default, and the only way off.
     *
     * The flag used to be inferred from the request's protocol, which
     * `@hono/node-server` reads from the socket — so behind a TLS-terminating
     * proxy, the normal production topology, the server saw `http` and shipped a
     * months-lived credential in cleartext. Inverting it closed that, and left
     * one real deployment with nowhere to go: a bundle served over plain http on
     * a LAN address, where the browser drops a `Secure` cookie and the session
     * dies silently at the access token's expiry.
     *
     * So the escape hatch is an environment variable rather than a header,
     * because `X-Forwarded-Proto` is written by whoever is talking to us and a
     * request must never be able to downgrade this. Setting it to `false` warns
     * at boot: it is a deliberate, and rare, decision.
     */
    AUTH_COOKIE_SECURE: z.enum(["true", "false", ""]).default("true").transform(v => v !== "false"),
    AUTH_DEFAULT_ROLE: z.string().optional(),

    /**
     * OAuth providers, one `<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET` pair each.
     *
     * Every provider `packages/server/src/auth/*-oauth.ts` ships has a pair
     * here, and `oauth-env-coverage.test.ts` fails when one gains a factory and
     * not a pair. Three of the twelve had one; setting `DISCORD_CLIENT_ID` on a
     * managed deployment did nothing at all — the key was not in this schema, so
     * `GET /api/auth/config` kept answering `"enabledProviders":[]` and nothing
     * was logged. A bundle deployment has no other way in: its config object is
     * built by `resolveAuthOptions`, and `BundleConfigExports` carries no `auth`
     * field for a project to override it with.
     *
     * `GOOGLE_CLIENT_ID` / `_SECRET` are in the base schema (`src/env.ts`) for
     * historical reasons and are read the same way.
     */
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    LINKEDIN_CLIENT_ID: z.string().optional(),
    LINKEDIN_CLIENT_SECRET: z.string().optional(),
    FACEBOOK_CLIENT_ID: z.string().optional(),
    FACEBOOK_CLIENT_SECRET: z.string().optional(),
    TWITTER_CLIENT_ID: z.string().optional(),
    TWITTER_CLIENT_SECRET: z.string().optional(),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    GITLAB_CLIENT_ID: z.string().optional(),
    GITLAB_CLIENT_SECRET: z.string().optional(),
    BITBUCKET_CLIENT_ID: z.string().optional(),
    BITBUCKET_CLIENT_SECRET: z.string().optional(),
    SLACK_CLIENT_ID: z.string().optional(),
    SLACK_CLIENT_SECRET: z.string().optional(),
    SPOTIFY_CLIENT_ID: z.string().optional(),
    SPOTIFY_CLIENT_SECRET: z.string().optional(),
    /**
     * Apple is the one provider with no static client secret: Apple wants a
     * short-lived ES256 JWT, which `createAppleProvider` signs from these three.
     * So `APPLE_CLIENT_SECRET` does not exist, and all four keys are required
     * together — three of them is a provider that cannot mint a secret, which is
     * why `resolveAuthOptions` configures Apple only when it has all of them.
     */
    APPLE_CLIENT_ID: z.string().optional(),
    APPLE_TEAM_ID: z.string().optional(),
    APPLE_KEY_ID: z.string().optional(),
    APPLE_PRIVATE_KEY: z.string().optional(),

    // ── API surface ──────────────────────────────────────────────────────────
    REBASE_BASE_PATH: z.string().default("/api"),
    /**
     * The OpenAPI surface: `/api/docs` (the spec) and `/api/swagger` (the UI).
     *
     * Deliberately tri-state, and resolved against NODE_ENV by
     * {@link resolveEnableSwagger} rather than defaulted here. Unset means "on
     * in development, off in production"; `false` turns both off anywhere.
     *
     * `true` in production is only half a switch, and the asymmetry is in
     * `init/docs.ts` rather than here: the *spec* at `/api/docs` is served
     * whenever this is not `false`, but the Swagger *UI* at `/api/swagger` is
     * gated on `NODE_ENV !== "production"` independently and this variable
     * cannot open it.
     *
     * It used to default to `"false"` outright, which reads as a safe default
     * and was not one: the runtime is how every scaffolded project boots, so
     * the docs disappeared from projects that never asked for that. `rebase
     * init` prints "docs are at /api/swagger" on completion, the headless
     * README repeats it, and the console's API Explorer fetches `/api/docs` —
     * all three 404'd against a project running the runtime, and the baas e2e
     * failed on exactly that.
     */
    REBASE_ENABLE_SWAGGER: z.enum(["true", "false", ""]).optional()
        .transform(v => (v === undefined || v === "" ? undefined : v === "true")),
    /**
     * Maximum request body size, in **bytes**.
     *
     * Validated as a number rather than coerced loosely: `Number("10MB")` is
     * `NaN`, which is not nullish, so it would slip past the downstream default
     * and then fail a `> 0` check — silently removing every body limit from the
     * API. A boot failure naming the variable is the only safe reading of a
     * value nobody can interpret.
     */
    REBASE_MAX_BODY_SIZE: z.coerce
        .number({ message: "REBASE_MAX_BODY_SIZE must be a number of bytes (e.g. 10485760)" })
        .int()
        .nonnegative()
        .optional(),
    REBASE_COMPRESSION: z.enum(["true", "false", ""]).default("true").transform(v => v !== "false"),
    REBASE_HISTORY: z.enum(["true", "false", ""]).default("true").transform(v => v !== "false"),
    /** Comma-separated origins allowed to make credentialed cross-origin calls. */
    CORS_ORIGINS: z.string().optional(),

    // ── Split deployments ────────────────────────────────────────────────────
    /**
     * Which part of the project this process serves.
     *
     * `all` — everything, in one process. The default, and what every existing
     * deployment gets by setting nothing.
     *
     * The other three exist so one image and one bundle can be booted several
     * times over, each serving a different part: `api` (data, auth, admin,
     * storage, meta), `functions` (custom functions only), `worker` (no HTTP
     * surface at all — cron and the job queue).
     *
     * See `resolveRole` in `boot/role.ts` for exactly what each one mounts and
     * owns, and for the combinations that refuse to boot.
     */
    REBASE_ROLE: z.enum(["all", "api", "functions", "worker", ""]).default("all")
        .transform(v => (v === "" ? "all" as const : v)),
    /**
     * Override whether this process runs the cron scheduler's timers.
     *
     * Separate from the role because "which URLs answer" and "which timers fire"
     * are independent questions: a three-way split wants cron off the `api`
     * process, a two-way split wants it on. Unset follows the role.
     */
    REBASE_CRON_SCHEDULER: z.enum(["true", "false", ""]).optional()
        .transform(v => (v === undefined || v === "" ? undefined : v === "true")),
    /** Override whether this process runs job-queue workers. Unset follows the role. */
    REBASE_JOB_WORKERS: z.enum(["true", "false", ""]).optional()
        .transform(v => (v === undefined || v === "" ? undefined : v === "true")),
    /**
     * Override whether this process runs the scheduled RLS audit. Unset follows
     * the role.
     *
     * Unlike cron and the job workers this is not claim-protected — every owner
     * scans on its own timer, which is redundant rather than unsafe — so a split
     * deployment sets it false everywhere but one process.
     */
    REBASE_RLS_AUDIT: z.enum(["true", "false", ""]).optional()
        .transform(v => (v === undefined || v === "" ? undefined : v === "true")),
    /**
     * Comma-separated function names this process serves. Unset means all.
     *
     * `functions` role only. A name that is not in the bundle is a boot failure,
     * not a warning — the deployment exists to serve that function, and a typo
     * that silently serves nothing is the failure this must not have.
     */
    REBASE_FUNCTIONS_ONLY: z.string().optional(),
    /** Comma-separated function names to skip. Applied after `_ONLY`. */
    REBASE_FUNCTIONS_EXCLUDE: z.string().optional(),
    /**
     * Base URL of the process serving `/api/functions/*`.
     *
     * `api` role only. Set it and this process forwards those requests there
     * instead of mounting them, so a split deployment presents the identical URL
     * surface and nobody has to run a reverse proxy to try one.
     */
    REBASE_FUNCTIONS_UPSTREAM: z.string().optional()
});

export type RebaseBootEnv = RebaseEnv & z.infer<typeof bootEnvExtension>;

/** One entry of a ZodError, narrowed to the parts this file reads. */
interface BootEnvIssue {
    path?: (string | number)[];
    message?: string;
    code?: string;
}

/**
 * Whether an issue means "this variable is not set", as opposed to "it is set
 * to something wrong".
 *
 * The difference is the whole point of the rewrite below: `DATABASE_URL: is
 * required` tells an operator what to do, and `DATABASE_URL: Invalid input:
 * expected string, received undefined` makes them work out that a validator's
 * idea of a missing key is an undefined string.
 *
 * The old test was `message === "Invalid input"`, which is the zod 3 wording
 * and has never matched: zod 4 puts the expected and received types in the
 * message, and drops the `received` field the zod 3 issue carried — so the
 * message is the only thing left to read. Matching the code as well keeps this
 * off `invalid_format` and the other issue kinds, whose own messages are
 * already specific.
 */
function isMissingVariable(issue: BootEnvIssue): boolean {
    return issue.code === "invalid_type" && /received undefined$/.test(issue.message ?? "");
}

/**
 * Load and validate the environment for a bundle boot.
 *
 * Does not read `.env` files — that is the deployment's job (a container gets
 * real environment variables; `rebase dev` and `rebase start` load dotenv before
 * calling in).
 */
export function loadBootEnv(): RebaseBootEnv {
    try {
        return loadEnv({ extend: bootEnvExtension }) as RebaseBootEnv;
    } catch (err) {
        // A raw ZodError prints a JSON dump and a stack trace through the
        // validator — several screens of noise whose actual content is "you did
        // not set DATABASE_URL". Restate it as the list of variables to fix.
        const issues = (err as { issues?: BootEnvIssue[] }).issues;
        if (!Array.isArray(issues)) throw err;

        const lines = issues.map(issue => {
            const name = Array.isArray(issue.path) ? issue.path.join(".") : "";
            const detail = isMissingVariable(issue) ? "is required" : issue.message;
            return name ? `  ${name}: ${detail}` : `  ${detail}`;
        });

        throw new BundleError(
            `The environment is not valid:\n${lines.join("\n")}`,
            "See https://rebase.pro/docs/deployment/self-hosting/ for the variables a deployment needs."
        );
    }
}

/**
 * Whether an origin is a loopback address.
 *
 * In development the runtime reflects only localhost origins. It cannot reflect
 * an arbitrary `Origin`, because credentials are enabled: any site the developer
 * happened to visit could otherwise make credentialed requests against the dev
 * server with the developer's session and read the responses.
 */
export function isLocalhostOrigin(origin: string): boolean {
    try {
        const { hostname } = new URL(origin);
        return hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname === "::1" ||
            hostname === "[::1]";
    } catch {
        return false;
    }
}

/**
 * Whether this process serves the OpenAPI docs.
 *
 * An explicit `REBASE_ENABLE_SWAGGER` wins in either direction. Left unset, the
 * docs follow the environment: on in development, where they are part of how a
 * scaffolded project is meant to be explored, and off in production, where the
 * spec enumerates every collection and field to anyone who asks for it.
 *
 * Returning `undefined` for development is the point rather than an oversight —
 * it hands the decision to the server's own policy in `init/docs.ts`, which also
 * knows to withhold the Swagger UI while still serving the spec. Two defaults
 * that can disagree about the same route is the bug this replaces.
 */
export function resolveEnableSwagger(env: RebaseBootEnv): boolean | undefined {
    if (env.REBASE_ENABLE_SWAGGER !== undefined) return env.REBASE_ENABLE_SWAGGER;
    return env.NODE_ENV === "production" ? false : undefined;
}

/** A CORS origin resolver of the shape Hono's `cors()` middleware expects. */
export type CorsOriginResolver = (origin: string) => string | null;

/**
 * Build the CORS origin policy.
 *
 * Production serves an explicit allow-list and nothing else. `loadEnv` already
 * refuses to start a production process with neither `CORS_ORIGINS` nor
 * `FRONTEND_URL`, so an empty list here can only mean the values were blank
 * strings — still worth failing on, because the alternative is an API that
 * quietly rejects its own frontend.
 *
 * Development reflects localhost *and* whatever that same allow-list names. The
 * list is the same one in both environments; the difference is that development
 * adds localhost to it rather than replacing it.
 */
export function resolveCorsOrigin(env: RebaseBootEnv): CorsOriginResolver {
    const isProduction = env.NODE_ENV === "production";
    const raw = env.CORS_ORIGINS || env.FRONTEND_URL || "";
    const allowed = raw.split(",").map(s => s.trim()).filter(Boolean);

    if (!isProduction) {
        // Development reflects localhost, **plus** anything the developer
        // explicitly listed. The list used to be ignored outside production, so
        // setting `CORS_ORIGINS` — the variable the error message names, the
        // one the docs describe — changed nothing in the environment where it
        // is most often needed: a phone or a colleague's machine hitting the
        // dev server over the LAN, an ngrok tunnel, a Codespaces forwarded
        // port. Every one of those is a non-localhost origin, and every one of
        // them was refused with no way to allow it.
        //
        // Localhost stays reflected without being listed, and an origin that is
        // *neither* is still refused: credentials are enabled, so reflecting an
        // arbitrary `Origin` would let any site the developer happens to visit
        // make credentialed requests against the dev server with their session.
        const denied = new Set<string>();
        return (origin: string) => {
            if (!origin) return "*";
            if (isLocalhostOrigin(origin) || allowed.includes(origin)) return origin;
            // Once per origin: a refused preflight is retried on every request,
            // and the message is a fix, not an incident.
            if (!denied.has(origin)) {
                denied.add(origin);
                console.warn(
                    `[Rebase] Refused a cross-origin request from ${origin}. ` +
                    "In development only localhost is allowed by default. " +
                    `To allow it, set CORS_ORIGINS=${origin} (comma-separated for several).`
                );
            }
            return null;
        };
    }

    if (allowed.length === 0) {
        throw new Error(
            "CORS_ORIGINS or FRONTEND_URL must be set in production. " +
            "Example: CORS_ORIGINS=https://yourdomain.com"
        );
    }

    const wildcard = allowed.includes("*");
    if (wildcard) {
        // `*` with credentials is rejected by every browser, so a config that
        // asks for it is a misconfiguration that would present as an opaque CORS
        // failure at runtime. Say so at boot instead.
        throw new Error(
            "CORS_ORIGINS cannot be \"*\" — the API sends credentials, and browsers " +
            "refuse a wildcard origin on credentialed requests. List the exact origins."
        );
    }

    return (origin: string) => (allowed.includes(origin) ? origin : null);
}
