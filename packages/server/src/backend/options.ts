/**
 * What a Rebase backend is built from.
 *
 * `createRebaseBackend(options)` takes {@link RebaseBackendOptions} and returns
 * a backend that has mounted nothing and started nothing; the convenience
 * `initializeRebaseBackend(config)` takes the same options plus the HTTP pieces
 * it mounts onto (`app`, `server`, `basePath`). The shapes live here, apart from
 * both functions, so neither has to import the other to name them.
 *
 * @module
 */
import type {
    AnyCollectionConfig,
    AuthAdapter,
    BackendBootstrapper,
    CollectionCallbacks,
    DatabaseAdapter,
    HistoryConfig,
    InitializedDriver
} from "@rebasepro/types";
import type { CaptchaConfig } from "../auth/captcha";
import type { JwtSigningKeyConfig } from "../auth/jwt-keys";
import type { AuthHooks } from "../auth/auth-hooks";
import type { OAuthProvider } from "../auth/interfaces";
import type { DataRateLimitConfig } from "../auth/rate-limiter";
import type { EmailConfig } from "../email";
import type { JobQueueOptions } from "../jobs/types";
import type { RlsAuditConfig } from "../rls-audit";
import type { BackendStorageConfig, StorageController } from "../storage";
import type { SchemaEditPolicy, RemoteRepositoryConfig } from "../schema-edit/schema-edit-permissions";
import type { RuntimeOwnershipOptions, RuntimeSurfaceOptions } from "../init/surfaces";

/**
 * Who may change this project's schema through a running backend.
 *
 * An alias rather than its own shape: the policy is defined next to the code
 * that enforces it, and a second declaration here would be a second place for
 * it to drift.
 *
 * @see `packages/server/src/schema-edit/schema-edit-permissions.ts`
 */
export interface LiveSchemaConfig extends SchemaEditPolicy {
    /**
     * A repository to commit to when the source is not on this machine.
     *
     * A bundle deployment ships compiled output, so there is nothing for the
     * collection editor to rewrite locally. Configure this and the change is
     * read from the repository, rewritten, and committed back through the Git
     * Data API — no clone, no working tree.
     *
     * Configuring it is the opt-in for a deployment with no source of its own:
     * live editing then works under `NODE_ENV=production` and with
     * `schemaEditor: false` (which a bundle boots with), because the write
     * goes to this repository and never to the files beside the process. The
     * collections directory is read from it whole, so a relation can name
     * another collection and a deletion can check its importers.
     *
     * Absent, live schema editing needs the project mounted and says so. A
     * bundle sets it from `REBASE_LIVE_SCHEMA_REPOSITORY` and its credential.
     */
    repository?: RemoteRepositoryConfig;
}

export interface RebaseAuthConfig {
    /**
     * The collection that represents auth users.
     *
     * When provided, this collection's underlying database table is used
     * for all auth operations (login, registration, password reset, etc.).
     *
     * Import the built-in default:
     * ```ts
     * import { defaultUsersCollection } from "@rebasepro/common";
     * auth: { collection: defaultUsersCollection, jwtSecret: "..." }
     * ```
     *
     * Or pass your own collection with the required auth fields
     * (email, passwordHash, displayName, etc.).
     */
    /**
     * Accepts a collection of any row type: `defineCollection` infers `M` from
     * the properties, and `CollectionConfig` is invariant in `M`, so a bare
     * `CollectionConfig` here rejects everything the builder returns.
     */
    collection?: AnyCollectionConfig;
    jwtSecret?: string;
    /**
     * Asymmetric keys for signing access tokens, newest first. Additive —
     * without them tokens stay HS256, exactly as before. With them, anyone can
     * verify a session from `/.well-known/jwks.json` without holding the key
     * that mints one, and a key can be rotated without signing users out.
     *
     * ```ts
     * auth: {
     *   jwtSecret: process.env.JWT_SECRET,
     *   signingKeys: [{ kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }]
     * }
     * ```
     */
    signingKeys?: JwtSigningKeyConfig[];
    /** Which of {@link signingKeys} mints new tokens. Defaults to the first. */
    activeKid?: string;
    accessExpiresIn?: string;
    refreshExpiresIn?: string;
    requireAuth?: boolean;
    allowRegistration?: boolean;
    /**
     * Block self-registration outright — the hard kill switch.
     *
     * `allowRegistration: false` still admits the very first user on an empty
     * database, because otherwise a fresh deployment has no way to create its
     * own admin: `POST /admin/bootstrap` needs an authenticated caller. This
     * closes that window too, for operators who provision every account out of
     * band and never want a public first-come-first-admin race.
     *
     * With this set, an empty backend has no self-service path in at all —
     * create the first user with the CLI or a seed script.
     */
    disableSelfRegistration?: boolean;
    /**
     * Opt-in: allow `POST /auth/anonymous` to mint a user with no credentials.
     *
     * Off by default. Anonymous sign-in inserts a `users` row and assigns
     * `defaultRole` exactly as registration does, so leaving it always-on meant
     * a backend with `allowRegistration: false` and `disableSelfRegistration:
     * true` still handed out permanent accounts: `/auth/anonymous` for the row
     * and the session, then `/auth/anonymous/link` to put an email and password
     * on it. `disableSelfRegistration` overrides this key.
     */
    allowAnonymous?: boolean;
    /**
     * Opt-in: expose `POST /auth/find-user` so an authenticated user can resolve
     * an email address to a minimal public profile (`uid`, `displayName`,
     * `photoURL` only). This powers invite-by-email flows without a custom
     * admin server function. Off by default because it enables user enumeration
     * by any signed-in user. Available on the client as `auth.findUserByEmail`.
     */
    allowUserLookup?: boolean;
    /**
     * Bot protection on the auth routes that cost something to hit.
     *
     * Off unless `enabled`. Rate limiting bounds one caller; a botnet of a
     * thousand addresses sending one request each never touches a per-IP window,
     * and `/register` and `/forgot-password` both send mail — so the bill for an
     * unprotected form is paid in reputation on a sending domain.
     *
     * ```ts
     * auth: { captcha: { enabled: true, provider: "turnstile", secret: process.env.TURNSTILE_SECRET } }
     * ```
     *
     * Verification fails closed: if the provider cannot be reached, the request
     * is refused. See `auth/captcha.ts` for why that is the safe direction.
     */
    captcha?: CaptchaConfig;
    /**
     * A static secret key for server-to-server / script authentication.
     *
     * When a request includes `Authorization: Bearer <serviceKey>`, it is
     * granted admin-level access without JWT verification. This is the
     * Rebase equivalent of a Service Account key.
     *
     * Generate with: `node -e "logger.info(require('crypto').randomBytes(48).toString('base64'))"`
     *
     * Set via `REBASE_SERVICE_KEY` in your `.env`.
     * Must be at least 32 characters.
     */
    serviceKey?: string;
    email?: EmailConfig;
    // ── Convenience shortcuts ─────────────────────────────────────────
    // Each named field below is syntactic sugar that internally resolves
    // to an `OAuthProvider` via the corresponding `create*Provider`
    // factory at startup. They are equivalent to constructing the
    // provider manually and passing it in the `providers` array.
    //
    // For providers not listed here, or for full control over the
    // provider configuration, use the `providers` array directly.
    google?: { clientId: string; clientSecret?: string };
    linkedin?: { clientId: string; clientSecret: string };
    github?: { clientId: string; clientSecret: string };
    microsoft?: { clientId: string; clientSecret: string; tenantId?: string };
    apple?: { clientId: string; teamId: string; keyId: string; privateKey: string };
    facebook?: { clientId: string; clientSecret: string };
    twitter?: { clientId: string; clientSecret: string };
    discord?: { clientId: string; clientSecret: string };
    gitlab?: { clientId: string; clientSecret: string; baseUrl?: string };
    bitbucket?: { clientId: string; clientSecret: string };
    slack?: { clientId: string; clientSecret: string };
    spotify?: { clientId: string; clientSecret: string };
    defaultRole?: string;
    /**
     * Canonical array of OAuth providers.
     *
     * This is the primary extension point for **all** OAuth integrations.
     * Each entry is an `OAuthProvider<unknown>` constructed via one of
     * the `create*Provider` factories exported from `@rebasepro/server`
     * (e.g. `createGoogleProvider`, `createGitHubProvider`).
     *
     * The named convenience fields above (`google`, `github`, etc.) are
     * automatically resolved into this array at startup. You can mix both
     * approaches; named fields and explicit entries are merged (named
     * fields are appended after explicit entries).
     *
     * @example
     * ```ts
     * import { createGoogleProvider } from "@rebasepro/server";
     *
     * auth: {
     *   providers: [
     *     createGoogleProvider({ clientId: "…", clientSecret: "…" }),
     *   ],
     * }
     * ```
     */
    providers?: OAuthProvider<unknown>[];
    /**
     * Redirect URIs the OAuth sign-in routes will accept, for every provider.
     *
     * Left unset, the only check is the provider's own registered-URI match —
     * which authorises *every* URI registered on that OAuth client, including
     * the `localhost` entry someone added for development and the staging host
     * nobody removed. List the origins this backend actually serves to narrow
     * it. Compared on origin plus path; query, fragment and a trailing slash
     * are ignored.
     *
     * @example
     * ```ts
     * auth: { allowedRedirectUris: ["https://admin.example.com/"] }
     * ```
     */
    allowedRedirectUris?: string[];
    /**
     * Override specific parts of the built-in auth implementation.
     *
     * Each override replaces one piece of the default behavior while
     * keeping everything else intact. Unset overrides fall through
     * to the built-in defaults (scrypt passwords, standard validation, etc.).
     *
     * @example bcrypt passwords with a custom hash
     * ```ts
     * import bcrypt from "bcrypt";
     *
     * hooks: {
     *     hashPassword: (pw) => bcrypt.hash(pw, 12),
     *     verifyPassword: (pw, hash) => bcrypt.compare(pw, hash),
     * }
     * ```
     */
    hooks?: AuthHooks;

    /**
     * Enable magic link (passwordless email) authentication.
     * Requires email to be configured.
     */
    magicLink?: boolean;

    /**
     * Enable email one-time codes — six digits, typed in, instead of a link.
     *
     * A magic link opens the session on whichever device holds the mailbox,
     * which is the wrong device whenever those are two different machines: a
     * television, a terminal, a second browser. A code crosses that gap because
     * a person carries it.
     *
     * `POST /auth/otp` sends one; `POST /auth/otp/verify` trades it for a
     * session. Requires email to be configured, as magic link does.
     */
    emailOtp?: boolean;
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
    cookieAuth?: import("../auth").CookieAuthConfig;
    /**
     * Refuse password sign-in until the account's email address is verified,
     * and make registration confirm-first. Off by default.
     *
     * Off, `POST /auth/register` signs the new account in and mails it a
     * verification link; an address that already has an account is answered
     * `409 EMAIL_EXISTS`. On, register signs nobody in and answers the same
     * "check your inbox" whether or not the address has an account (an
     * unconfirmed one is mailed its link again), and `POST /auth/login`
     * answers `403 EMAIL_NOT_CONFIRMED` for an unverified account —
     * only once the password is right. Following the link with the password completes
     * the sign-up (`POST /auth/verify-email`).
     *
     * Needs email: the boot refuses it without, since nobody could ever
     * confirm. Set by `AUTH_REQUIRE_EMAIL_VERIFICATION=true`.
     */
    requireEmailVerification?: boolean;
    /**
     * How long a refresh token that was rotated away still mints a sibling of
     * the same session, in seconds. Default 10 (GoTrue's
     * `refresh_token_reuse_interval`): a client that lost a refresh answer —
     * a deploy, a suspended laptop, two tabs at once — is not signed out.
     */
    refreshTokenReuseIntervalSeconds?: number;
    /**
     * What a refresh token presented *after* that window does. Default
     * `"reject"`: the request is refused and logged, and the session stands,
     * because its live token is still good — which also means a thief who
     * refreshed first keeps it. `"revoke-session"` ends the whole sign-in on
     * such a replay, thief and owner alike, as GoTrue does: the owner signs
     * in again. Set by `AUTH_REFRESH_TOKEN_REUSE`; anything else fails the boot.
     */
    refreshTokenReuse?: "reject" | "revoke-session";
    /**
     * Let a magic-link or email-code request for an address with no account
     * create one — passwordless sign-up — while registration is open
     * (`allowRegistration`, not `disableSelfRegistration`). The account has no
     * password and is unverified until the link or code is used, which proves
     * the address and signs it in. Off by default, so those requests answer an
     * unknown address the same as a known one and create nothing. Set by
     * `AUTH_MAGIC_LINK_CREATES_USERS`.
     */
    magicLinkCreatesUsers?: boolean;
}

/** @see RebaseBackendOptions.baas */
export interface BaasOptions {
    /**
     * What to do with introspected tables that have row-level security
     * disabled.
     *
     * Such a table carries no authorization model. Every authenticated request
     * runs as `rebase_user`, which is granted DML on the schema, so serving one
     * hands every row to every logged-in user — the API would be an open door
     * onto whatever the database happens to contain.
     *
     * - `"exclude"` (default) — do not serve it. Each excluded table is logged
     *   with the SQL to protect it. Secure by default, consistent with the rest
     *   of the driver, which fails a boot rather than serve unenforced requests.
     * - `"serve"` — serve it anyway. Only sensible when every caller is already
     *   trusted, e.g. an internal service behind its own authorization.
     */
    unprotectedTables?: "exclude" | "serve";
}

/**
 * Which parts of the database a backend provisions, when `provision` is not
 * simply all or nothing. Each defaults to `true`; the database role and the
 * framework's own tables are provisioned whenever `provision` is not `false`.
 */
export interface ProvisionOptions {
    /**
     * The collection schema: missing tables, columns and enum types (additive
     * only, never a drop), the collections' RLS policies, and the stamp that
     * records which schema version was applied.
     */
    collections?: boolean;
    /**
     * Change capture for realtime: the trigger function, the per-table
     * triggers, and any channel-history tables a driver keeps. Whether this
     * process *consumes* change events is a separate question — the
     * `realtime` surface.
     */
    realtime?: boolean;
}

export interface RebaseBackendOptions {
    /**
     * The collections this backend serves, as values. Wins over
     * {@link collectionsDir} for what is served.
     *
     * Invariance again — see the note on `RebaseAuthConfig.collection`.
     */
    collections?: AnyCollectionConfig[];
    /**
     * The directory holding this project's collection source files.
     *
     * Two jobs, and only the first depends on {@link collections}:
     *
     * 1. Without `collections`, it is where the served collections are loaded
     *    from (`loadCollectionsFromDirectory`).
     * 2. Always, it is the source the schema editor and live schema editing
     *    rewrite. The editor changes TypeScript files, not the values in this
     *    process, so it needs to know where they are — collections passed as
     *    values carry no path back to the file they came from. A backend given
     *    `collections` and no directory serves them and reports the editor as
     *    unavailable (`SCHEMA_EDITOR_NO_COLLECTIONS_DIR`), with the reason.
     *
     * Passing both is therefore not ambiguous: the values are served, and the
     * directory is what an edit writes to.
     */
    collectionsDir?: string;

    /**
     * What creating this backend may change in the database. Required, because
     * it is a decision and not a default: boot-time DDL used to be a side
     * effect of starting a server, and the two ways it goes wrong — no tables,
     * so every data route 500s; or two processes racing the same `CREATE` —
     * both start from nobody having decided.
     *
     * - `true` — everything this backend serves needs: the collection tables
     *   and their RLS policies, change capture for realtime, the database
     *   role requests run as, and the framework's own tables (API keys, cron
     *   runs, jobs, metrics). What a single-process deployment wants.
     * - `false` — nothing. The schema must already be there: applied by a
     *   migration, or by another process created with `provision: true`. What
     *   a script, a REPL, a test reading rows, or a second process of a split
     *   deployment wants. A missing table then fails on use, not at boot.
     * - `{ collections: false, realtime: false }` — the framework's tables and
     *   the role, but not the collection schema or change capture: a process
     *   that is not the schema's owner in a split deployment.
     *
     * Applied while the backend is created rather than in a later step, on
     * purpose: the driver reads the tables as it opens (it introspects them and
     * attaches change capture to the ones that exist), and the policies need
     * the `auth.*` functions created during auth initialisation. A separate
     * `provision()` after creation would run after the driver had already
     * decided what exists.
     *
     * `REBASE_MIGRATE_ON_BOOT=none` still turns the collection schema off, for
     * any backend in the process: it is the operator's switch, read where the
     * DDL runs, so no entry point can forget to honour it.
     */
    provision: boolean | ProvisionOptions;

    /**
     * Rate limiting for the data API, per caller: an API key by its id, a
     * signed-in user by their uid, anyone else by IP.
     *
     * On by default with loose limits — a floor against a runaway client, not a
     * quota. Counts live in this process's memory unless you pass a `store`, so
     * N replicas enforce N times the limit between them; set real quotas at a
     * proxy or supply a shared store if that matters. `{ enabled: false }` for
     * a deployment whose edge already does this.
     */
    rateLimit?: DataRateLimitConfig;


    /**
     * Force the schema-editor routes on or off.
     *
     * Defaults to enabled when `collectionsDir` is set, outside production, in
     * `cms` mode. The editor rewrites collection files, so it needs a
     * `collectionsDir` to write to.
     */
    schemaEditor?: boolean;

    /**
     * Live schema editing — changing the database and committing the change.
     *
     * Distinct from `schemaEditor`, which only rewrites collection source on
     * this machine. Without a `repository`, live editing writes through that
     * editor, so it is on exactly where the editor is. With one, it is on
     * whatever `schemaEditor` and `NODE_ENV` say — that is the opt-in for a
     * built bundle, which has no source to edit locally (see
     * {@link LiveSchemaConfig.repository}). Either way it is admin-only.
     */
    liveSchema?: LiveSchemaConfig;

    /** Options that only apply when collections are derived from the database. */
    baas?: BaasOptions;

    /**
     * The pre-init handle to hand the boot-time schema hooks, when the caller
     * has one.
     *
     * Those hooks run before any driver is initialized, so there is no driver
     * result to pass — the bundle boot path can still supply a stand-in built
     * from the connection its coordinator opened, and does, because a driver
     * written before this was optional dereferences `driverResult.internals`
     * unconditionally. An application that constructed its own adapter has no
     * such handle to give (it gave the connection to the adapter instead), so it
     * leaves this unset and the adapter falls back to its own connection.
     *
     * @internal Set by `bootFromBundle`; not part of the ordinary configuration
     * surface.
     */
    provisioningDriverResult?: InitializedDriver;

    /**
     * Database bootstrappers, one per data source.
     *
     * The `id` of each is the key `collection.dataSource` routes against, so a
     * project with several databases passes several — `initializeDataSources`
     * builds them from the declared graph. The list of *declared* sources is no
     * longer an option here: it is read from the resource graph, which is the
     * one place a project declares them.
     *
     * @internal Built by `initializeDataSources` from the declared resource graph. Pass `database` instead.
     */
    bootstrappers?: BackendBootstrapper[];
    /**
     * Database adapter.
     *
     * When set, this takes precedence over `bootstrappers`.
     *
     * @example
     * ```ts
     * import { createPostgresAdapter } from "@rebasepro/server-postgres";
     * database: createPostgresAdapter({ connection: db, schema }),
     * ```
     */
    database?: DatabaseAdapter;

    logging?: {
        level?: "error" | "warn" | "info" | "debug";
    };

    /**
     * Authentication configuration.
     *
     * Accepts **either**:
     * - `RebaseAuthConfig` — built-in configuration
     * - `AuthAdapter` — pluggable adapter for external auth (Clerk, Auth0, etc.)
     *
     * When a plain config object is provided, the built-in adapter is created
     * automatically from the bootstrapper's `initializeAuth()` result.
     */
    auth?: RebaseAuthConfig | AuthAdapter;

    /**
     * Storage configuration. Accepts:
     *
     * - A `BackendStorageConfig` object (`{ type: 'local' | 's3' | 'gcs', ... }`)
     * - A `StorageController` instance (for custom providers like Azure, etc.)
     * - A `Record<string, ...>` of either, for multi-backend setups
     */
    storage?: BackendStorageConfig | StorageController | Record<string, BackendStorageConfig | StorageController>;

    /**
     * Declared storage sources. Drives the client-side StorageSourceRegistry
     * and the transport distinction (server vs direct).
     *
     * Server-backed sources are auto-derived from the `storage` map — you
     * only need explicit entries for "direct" transport sources (e.g.
     * external storage) that the backend does not proxy.
     */


    /**
     * Per-object access control for storage — the analogue of a collection's
     * security rules, and the thing `requireAuth` / `publicRead` cannot
     * express because they are global switches.
     *
     * Called after authentication on every storage route with the key, bucket,
     * operation (`read` / `write` / `delete` / `list`) and resolved user.
     * Return false to deny with a 403; throwing denies too.
     *
     * ```ts
     * storageAuthorize: async ({ key, user, operation }) => {
     *     if (!user) return false;
     *     const [ownerId] = key.split("/");
     *     return ownerId === user.uid || operation === "read";
     * }
     * ```
     *
     * Without it, any authenticated caller may read any key they can name, so
     * multi-tenant apps should treat this as required rather than optional.
     *
     * In production, storage refuses to boot unless one of `storageAuthorize`,
     * {@link storagePublicRead}, or {@link storageInsecureAllowAnyAuthenticated}
     * is set — see `assertStorageAccessControlConfigured`.
     */
    storageAuthorize?: import("../storage/types").StorageAuthorize;

    /**
     * Per-object access control, declared rather than coded.
     *
     * Storage is not under row-level security, so without this or
     * {@link storageAuthorize} any authenticated caller may read, overwrite,
     * delete or list any key they can name — the keys share one flat namespace.
     *
     * ```ts
     * storagePolicies: [
     *     { path: "public/**", operations: ["read"], allow: "public" },
     *     { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
     * ]
     * ```
     *
     * **A key matched by no policy is refused.** Every widening is an explicit
     * line, and a mistake here denies rather than grants.
     *
     * `storageAuthorize` still runs when no policy matched, so ownership that
     * lives in a row — which no path pattern can express — stays expressible.
     * Neither can narrow the other: each only says yes.
     *
     * Satisfies the production boot guard on its own.
     */
    storagePolicies?: import("../storage/policies").StoragePolicy[];

    /**
     * Allow unauthenticated read access to stored files (default: false).
     *
     * Set this only when the bucket is genuinely a public, read-only CDN.
     * Because it is a deliberate statement that reads are public, it also
     * satisfies the production storage boot guard (see {@link storageAuthorize}).
     *
     * On its own — no {@link storagePolicies}, no {@link storageAuthorize} — it
     * means public READ and nothing else: writes, deletes and listings are
     * admin-only. The sentence "writes still require authentication" used to be
     * the whole of it, and it was not enough, because the deployment this flag
     * is for is the public site, which commonly runs with `requireAuth` off —
     * so "requires authentication" required nothing. A deployment that wants
     * anonymous or per-user writes says where, with a policy or a hook.
     */
    storagePublicRead?: boolean;

    /**
     * Keep derived image renditions — the results of `?width=`, `?format=` and
     * friends — in the storage source rather than only in this process's
     * memory.
     *
     * Without it a transform is recomputed by every instance, and again by all
     * of them after every deploy: the cache is per-process and does not survive
     * a restart. With it, the first instance to compute a variant writes it
     * under a reserved prefix in the same bucket as the source, and every
     * instance reads it from there.
     *
     * ```ts
     * storageRenditionCache: { enabled: true }
     * ```
     *
     * Off by default because turning it on makes a `GET` write to your bucket:
     * it costs per object, and on read-only credentials it cannot work. When a
     * write does fail the request still succeeds — the transform is served from
     * memory and the failure is logged once.
     *
     * Renditions are keyed by the source object's version, so replacing an
     * image serves the new one immediately; the superseded rendition is left
     * behind. Set a lifecycle rule on `_rebase/renditions/` to collect them.
     */
    storageRenditionCache?: import("../storage/rendition-cache").RenditionCacheConfig;

    /**
     * How long a private file's download URL works, in seconds — the lifetime
     * of the token `GET /storage/metadata/*` mints. Default 300; at most a week.
     * `STORAGE_DOWNLOAD_TOKEN_TTL` on a bundle deployment.
     *
     * Five minutes renders a page; a private `<video>` that plays longer asks
     * for its next range with an expired token. The token travels in the URL,
     * which is the reason for the ceiling: an object that must be linked
     * indefinitely belongs under the public prefix instead.
     */
    storageDownloadTokenTtl?: number;

    /**
     * Run something when an object lands, or when one goes.
     *
     * Every other write in the product can be reacted to — a row has
     * `beforeSave` and `afterSave`, a schedule has a cron job — and an upload
     * had nothing, so the work an upload implies had to be done by the client
     * after the upload returned, which means it is not done at all when the
     * client goes away between the two calls.
     *
     * ```ts
     * storageTriggers: [
     *     {
     *         path: "uploads/:uid/**",
     *         events: ["finalize"],
     *         handler: async ({ key, params }) => { … }
     *     }
     * ]
     * ```
     *
     * Same pattern language as {@link storagePolicies}. Fires for the
     * multipart and resumable paths alike, after the object is durably
     * written, and never for internal writes such as the image-rendition cache.
     * Handlers are awaited and a throwing one is logged rather than failing the
     * request — the object is already stored, so telling the client otherwise
     * would invite it to repeat a write that succeeded. Enqueue a job for
     * anything that must happen or is slow.
     */
    storageTriggers?: import("../storage/triggers").StorageTrigger[];

    /**
     * Opt out of the storage access-control boot guard, keeping the legacy
     * behaviour where **any** authenticated user can read, overwrite, delete or
     * list **any** key (storage keys share one flat namespace and are not under
     * RLS).
     *
     * Only safe for single-tenant apps where every signed-in user is trusted
     * with every file. Multi-tenant apps must use `storageAuthorize` instead.
     * Without one of these, storage refuses to boot in production.
     */
    storageInsecureAllowAnyAuthenticated?: boolean;

    /**
     * Entity history / audit-log configuration.
     *
     * - `true` — enable history with default settings
     * - `{ retention?: number }` — enable with optional retention period (days)
     */
    history?: HistoryConfig;
    enableSwagger?: boolean;
    /**
     * Which HTTP surfaces this backend builds — and so which ones `mount()`
     * mounts and which `routes.*` groups exist. Every one, unless named.
     *
     * The point of naming a subset is to run the same bundle as several
     * cooperating processes — one answering `/api/data`, another `/api/functions`
     * — so a custom function that pins the event loop does not do it in the
     * process serving the data API. `bootFromBundle` derives this from
     * `REBASE_ROLE`; passing it directly is for tests and for embedders.
     *
     * Omitting it, or naming only some surfaces, leaves the rest mounted. That
     * default is deliberate: a surface added in a later version is served by
     * every existing deployment without anyone editing a list.
     */
    surfaces?: RuntimeSurfaceOptions;
    /**
     * Which background singletons this process runs. All of them, unless named.
     *
     * Separate from {@link surfaces} because "which URLs answer" and "which
     * timers fire" are independent: a process can serve the cron *admin* surface
     * without being the one that fires the jobs, and vice versa.
     *
     * Neither is a correctness control — the cron scheduler claims each
     * `(job, slot)` pair and the job store claims rows `FOR UPDATE SKIP LOCKED`,
     * so running several of each is already safe. It is about not handing
     * scheduled work to a process whose replica count is a scaling decision.
     */
    ownership?: RuntimeOwnershipOptions;
    /**
     * Custom functions, as values: the URL segment each one is served at, to
     * its Hono app (`defineFunction(...)`).
     *
     * ```ts
     * functions: { "send-invoice": sendInvoice }      // → /api/functions/send-invoice
     * functions: await loadFunctions("./functions")   // the same as functionsDir
     * ```
     *
     * Give this or {@link functionsDir}, not both: two sources for one set of
     * URLs has no single answer, so the boot refuses it.
     */
    functions?: import("../functions/function-loader").FunctionsRecord;
    /**
     * A directory of function files, one per URL segment: `send-invoice.ts` is
     * served at `/api/functions/send-invoice`. Read with `loadFunctions`, so it
     * is exactly {@link functions} with the directory's skipped files reported
     * on `GET /api/functions` as well.
     */
    functionsDir?: string;
    /**
     * Per-request ceiling for `/api/functions/*`, in milliseconds.
     *
     * Custom functions run code the framework did not write, and nothing else
     * in the stack bounds it. Defaults to 30000 (or
     * `REBASE_FUNCTIONS_TIMEOUT_MS`). `0` disables the ceiling — for a function
     * that legitimately runs long, or a deployment whose proxy already imposes
     * one. Timed-out requests answer 504; the handler itself cannot be
     * cancelled, so give outbound calls an `AbortSignal`.
     */
    functionsTimeoutMs?: number;
    /**
     * Serve only some of the bundle's functions.
     *
     * How one expensive function gets its own replica count and its own blast
     * radius without its code moving anywhere. `bootFromBundle` fills this from
     * `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE`.
     *
     * A name that is not in the bundle fails the boot — see `selectFunctions`.
     *
     * @internal Filled from `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE`.
     */
    functionsSelection?: import("../functions/selection").FunctionSelection;
    /**
     * Forward `/api/functions/*` to another process instead of serving it here.
     *
     * Only consulted when the `functions` surface is off — a process that serves
     * them has nothing to forward. `bootFromBundle` fills this from
     * `REBASE_FUNCTIONS_UPSTREAM` on the `api` role.
     *
     * @internal Filled from `REBASE_FUNCTIONS_UPSTREAM` on the `api` role.
     */
    functionsUpstream?: string;
    /**
     * Cron jobs, as values: the job id, to its definition (`defineCron(...)`).
     *
     * ```ts
     * crons: { "nightly-report": nightlyReport }
     * crons: await loadCrons("./crons")   // the same as cronsDir
     * ```
     *
     * Give this or {@link cronsDir}, not both — the boot refuses the pair.
     */
    crons?: import("../cron/cron-loader").CronsRecord;
    /**
     * A directory of cron files, one job per file, the filename its id. Read
     * with `loadCrons`, so it is exactly {@link crons} with the directory's
     * skipped files reported on `GET /api/admin/cron` as well.
     */
    cronsDir?: string;
    /**
     * Enable/disable database persistence for cron job execution logs.
     * When set to false, cron jobs will run but logs will not be persisted to the database.
     * Default: true.
     */
    cronPersistence?: boolean;
    /**
     * The durable job queue: background work that survives a restart.
     *
     * Off unless `enabled` is set, because a worker polls the database forever
     * and that is not a default anyone chose. Requires a driver that can run
     * SQL; on one that cannot, the queue is unavailable and callers are told
     * so at boot rather than at the first enqueue.
     *
     * ```ts
     * jobs: {
     *   enabled: true,
     *   tasks: {
     *     "send-welcome": async ({ payload }) => { await sendEmail(payload.email); }
     *   }
     * }
     * ```
     */
    jobs?: JobQueueOptions;
    /**
     * Maximum request body size in bytes for API routes (default: 10MB).
     * Set to 0 to disable the global limit entirely.
     *
     * Note: `POST /storage/upload` is not under this limit. It is capped by the
     * storage config's `maxFileSize` instead (default: 50MB), whether that is
     * larger or smaller than this. Every other route stays under this limit,
     * the rest of `/storage` included. A TUS upload is many requests, so this
     * caps each chunk (`PATCH /storage/tus/:id`), and `maxFileSize` caps the
     * whole file.
     */
    maxBodySize?: number;
    /**
     * Response compression for API routes. **Enabled by default.**
     *
     * Compresses responses with gzip/deflate, negotiated from the request's
     * `Accept-Encoding`. Bodies that are already compressed (images, video),
     * streamed (`text/event-stream`), or explicitly marked
     * `Cache-Control: no-transform` are left untouched, so this is safe to
     * leave on — a large JSON list response typically drops by ~20x.
     *
     * Set to `false` when something in front of the app already compresses
     * (nginx, Cloudflare, or another reverse proxy / load balancer), to avoid
     * paying for it twice.
     */
    compression?: boolean;
    /**
     * CSRF protection configuration. **Opt-in** — disabled by default.
     *
     * BaaS APIs are consumed by mobile apps, SPAs on different domains,
     * and CLI tools, so CSRF is intentionally not enabled unless you
     * explicitly configure it with allowed origins.
     *
     * @example
     * ```ts
     * csrf: { origin: ["https://myapp.com", "https://admin.myapp.com"] }
     * ```
     */
    csrf?: {
        /** Allowed origins for CSRF validation. */
        origin: string | string[] | ((origin: string) => boolean);
    };
    /**
     * Global lifecycle callbacks applied to every collection.
     *
     * Same type as per-collection `callbacks` — fires on **every** data path
     * (REST API, WebSocket / realtime, server-side `rebase.dataAsAdmin`).
     *
     * Execution order: global callbacks → collection callbacks → property callbacks.
     *
     * @example
     * ```ts
     * callbacks: {
     *     afterRead({ row, collection }) {
     *         console.log(`Read ${collection.slug}/${row.id}`);
     *         return row;
     *     }
     * }
     * ```
     */
    callbacks?: CollectionCallbacks;

    /**
     * Declare that this application installs its own CORS middleware.
     *
     * Suppresses the "no CORS configuration detected" warning, which exists for
     * hand-wired backends that genuinely have no origin policy.
     *
     * @internal Set by the boot path that installs CORS itself.
     */
    corsHandled?: boolean;

    /**
     * The schema version this deployment serves, as recorded when it was built.
     *
     * Published by the contract endpoint so a client generated elsewhere can
     * tell whether it is current. Leave unset and the runtime computes one from
     * the live collections — correct, but it means the value moves whenever the
     * collections do, which is exactly right for `baas` mode and slightly less
     * useful for a built bundle that already knows its own answer.
     */
    schemaVersion?: string;

    /**
     * Runtime version reported by the contract endpoint. Informational.
     *
     * @internal Read from the bundle manifest by `bootFromBundle`.
     */
    runtimeVersion?: string;

    /**
     * Periodic row-level-security audit of the database this server uses.
     *
     * Off unless `enabled` is set. `@rebasepro/rls-check` is thorough and
     * read-only, and the reason nobody runs it is that it is a command — so this
     * runs it on a timer and serves the result at `GET /api/admin/rls-audit`.
     *
     * Needs the optional peer `@rebasepro/rls-check`, which is not a hard
     * dependency because it carries a Postgres driver and this package is
     * engine-agnostic.
     */
    rlsAudit?: RlsAuditConfig;
}
