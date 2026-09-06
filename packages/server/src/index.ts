/**
 * @rebasepro/server
 *
 * Database-Agnostic Backend Core for Rebase.
 * This package provides the core backend services, generic driver routing,
 * and API layers. Database implementations (e.g., PostgreSQL) are provided
 * by specialized driver packages like `@rebasepro/server-postgres`.
 */

// =============================================================================
// Core Initialization
// =============================================================================
export {
    initializeRebaseBackend,
    isAuthAdapter,
    isDatabaseAdapter
} from "./init";
// The single answer to "does this server require an authenticated caller?".
// Exported because the drivers' realtime sockets are the other enforcement
// point, and while they computed it themselves they computed it differently —
// open where this is closed. See `auth/require-auth.ts`.
export { resolveRequireAuth } from "./auth/require-auth";
export type {
    RebaseBackendConfig,
    RebaseBackendInstance,
    RebaseAuthConfig,
    // The type of the `baas` option, exported for the same reason
    // RebaseAuthConfig is: a backend author cannot name the shape otherwise.
    BaasOptions
} from "./init";

// =============================================================================
// Server-side singleton (import { rebase } from "@rebasepro/server")
// =============================================================================
export { rebase, _setRebaseMock, _resetRebaseMock } from "./singleton";

// The single definition of "the collections" — the runtime, the schema and
// policy generators, and the doctor all load them through this, so what gets
// served and what gets pushed can never drift apart.
export {
    loadCollectionsFromDirectory,
    applyCollectionDefaults,
    type CollectionDefaults
} from "./collections/loader";

// The strict parse the loader runs. Exported so the doctor and the CLI can
// report the same problems without booting a server.
export {
    assertCollectionConfigs,
    CollectionConfigError,
    findCollectionConfigProblems,
    unknownKeyPolicyFromEnv,
    type ConfigProblem,
    type UnknownKeyPolicy,
    type ValidateCollectionConfigOptions
} from "./collections/validate-config";

// =============================================================================
// DB Abstractions (for database driver implementations)
// =============================================================================
export * from "./db/interfaces";

// =============================================================================
// Auth — curated public surface (NOT `export *`).
//
// `./auth` (auth/index.ts) intentionally exports its internal plumbing so
// server's own init/wiring can consume it: token generation & JWT config,
// password/token crypto, route mounters (`createAuthRoutes`, `mountMagicLink…`),
// rate limiters, and the low-level middleware factories. None of that is a
// backend-author API and none of it has external consumers, so it must not be
// republished at the package root. Below is the deliberate public list —
// driver-contract interfaces, custom-auth adapters, OAuth providers, route
// guards, password helpers, auth hooks, and API-key types. Add here on purpose.
// =============================================================================
// Driver contract: repositories + auth data types (implemented by the
// server-postgres / server-mongo drivers).
export * from "./auth/interfaces";
export {
    // Route guards for custom functions/routes
    requireAuth,
    requireAdmin,
    optionalAuth,
    queryTokenAuth,
    fileTokenAuth,
    extractUserFromToken,
    // Password helpers (custom user creation / admin password reset)
    hashPassword,
    verifyPassword,
    validatePasswordStrength,
    generateSecurePassword,
    // Auth customization hooks
    resolveAuthHooks,
    // Pluggable auth adapters
    createBuiltinAuthAdapter,
    createCustomAuthAdapter,
    // Social login providers
    createGoogleProvider,
    createLinkedinProvider,
    createGitHubProvider,
    createMicrosoftProvider,
    createAppleProvider,
    createFacebookProvider,
    createTwitterProvider,
    createDiscordProvider,
    createGitLabProvider,
    createBitbucketProvider,
    createSlackProvider,
    createSpotifyProvider,
    // Shared OAuth machinery, for custom providers passed via `auth.providers`
    oauthCodeFlowSchema,
    pkceTokenParams,
    providerVerifiedEmail,
    verifyOidcIdToken,
    tryVerifyOidcIdToken,
    // API-key permission helpers
    isApiKeyToken,
    validateApiKey,
    httpMethodToOperation,
    isOperationAllowed,
    // Constant-time compare for static secrets — drivers checking a service key
    // must not fall back to ===.
    safeCompare,
    // The public keys that verify this issuer's access tokens, and the route
    // that serves them. Exported because a custom server builds its own Hono
    // app, and would otherwise have no way to publish a JWKS.
    getJwks,
    hasAsymmetricSigningKey,
    createJwksRoutes,
    // Exported because the documented fix for the dual-package hazard requires
    // it. Under pnpm with `--preserve-symlinks`, Node can resolve two module
    // instances of this package: the one `initializeRebaseBackend` configures
    // and the one the request path reads, which surfaces as
    // "JWT secret not configured. Call configureJwt() first" on a backend that
    // plainly did configure it. `rebase-backend-postgres`'s SKILL.md tells you
    // to call `configureJwt` yourself before init — sound advice that could not
    // be followed, because the symbol was internal.
    configureJwt
} from "./auth";
export type {
    // Named by `RebaseAuthConfig.signingKeys`, so it has to be nameable.
    JwtSigningKeyConfig,
    JwtSigningAlgorithm,
    PublicJwk,
    AccessTokenPayload,
    PasswordValidationResult,
    AuthHooks,
    AuthMethod,
    ResolvedAuthHooks,
    BuiltinAuthAdapterConfig,
    GoogleProviderConfig,
    AuthMiddlewareOptions,
    AuthResult,
    ApiKey,
    ApiKeyMasked,
    ApiKeyPermission,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    UpdateApiKeyRequest,
    ApiKeyStore,
    ApiKeyOperation
} from "./auth";

// =============================================================================
// API Layer — public types + error surface only. The `RestApiGenerator`
// route builder (`./api/rest`) is internal framework wiring, not re-exported.
// =============================================================================
export * from "./api/types";
export * from "./api/errors";
// The one exception to "route builder stays internal": the sockets in the
// driver packages are the other request boundary, and this is the rule they
// have to apply to be that boundary rather than a way around it.
export { assertWriteRequestValid } from "./api/rest/write-validation";

// =============================================================================
// Email
// =============================================================================
export * from "./email";

// =============================================================================
// Storage
// =============================================================================
export * from "./storage";

// Declarative storage access control. It compiles to a plain
// `StorageAuthorize`, so a project can build one and pass it either way.
export { compileStoragePolicies, resolveStorageAccessControl, StoragePolicyError } from "./storage/policies";
export type { StoragePolicy, StoragePolicyContext, StoragePolicyPredicate } from "./storage/policies";

// The scheduled RLS audit. The scanner itself is not re-exported — it is
// supplied by the caller, so this package never depends on it.
export { createRlsAudit, summarize as summarizeRlsScan } from "./rls-audit";
export type {
    RlsAudit,
    RlsAuditConfig,
    RlsAuditStatus,
    RlsScanner,
    RlsScanResult,
    RlsScanFinding,
    RlsSeverity
} from "./rls-audit";

// =============================================================================
// Entity History
// =============================================================================
export { createHistoryRoutes } from "./history";

// =============================================================================
// Custom Functions (auto-discovered Hono routes)
//
// The authoring surface has its own entry point — `@rebasepro/server/functions`
// — which is the one a function file should import, because this barrel reaches
// the whole framework and does not resolve on a runtime without Node built-ins.
// See `functions/index.ts` for why that mattered enough to split.
//
// Everything portable is re-exported here as well, so that importing from the
// root keeps working and so a Node-only project need not think about it. Two
// names are not: `requireAuth` and `requireAdmin` already exist on this barrel
// from `./auth`, exported for the data and admin routes, where the
// token-parsing versions are the ones that must run. Inside a function the two
// are equivalent — the identity is resolved before any handler — so a function
// importing them from here behaves identically to one importing them from the
// subpath.
// =============================================================================
export { loadFunctionsFromDirectory, loadFunctionsWithDiagnostics, createFunctionRoutes } from "./functions/internal";
export type { LoadedFunction, LoadedFunctions } from "./functions/internal";
export { defineFunction } from "./functions";
export type { RebaseFunctionContext } from "./functions";
export {
    // Request context
    getUser,
    getUserId,
    getRoles,
    hasRole,
    isAdmin,
    isAuthenticated,
    getDriver,
    requireDriver,
    getApiKey,
    getRequestId,
    identityResolved,
    // Guards not already exported from ./auth above
    requireRole,
    // Configuration. `env` is deliberately NOT re-exported here: on the
    // subpath it sits beside `getEnv` and `requireEnv` and reads as one of
    // three, while on this barrel it would sit beside `loadEnv` — which reads
    // a `.env` file into the process — and the two would be indistinguishable
    // at the import line. Reach it through `@rebasepro/server/functions`.
    getEnv,
    requireEnv,
    runtimeKey,
    isNodeRuntime,
    lazyResource,
    // Background work
    waitUntil
} from "./functions";
export type { FunctionUser } from "./functions";
// Not on the portable surface: shutdown drains background work, and only the
// host has a shutdown.
export { drainBackgroundWork, pendingBackgroundWork } from "./functions/wait-until";

// =============================================================================
// Cron Jobs (auto-discovered scheduled tasks)
// =============================================================================
export { loadCronJobsFromDirectory, loadCronJobsWithDiagnostics, CronScheduler, validateCronExpression, createCronRoutes, createCronStore, defineCron } from "./cron";
export type { LoadedCronJob, CronStore } from "./cron";

// =============================================================================
// Backups (admin routes + storage-generic helpers)
// =============================================================================
export { createBackupRoutes, parseBackupDestination, parseBackupTimestamp, listBackupObjects, readBackupBytes } from "./backup";
export type { BackupRoutesConfig, BackupDestination } from "./backup";

// =============================================================================
// SQL Helpers (for RLS policies)
// =============================================================================
export { authUid, authRoles, authJwt } from "./utils/sql";

// =============================================================================
// Logger
// =============================================================================
export { logger, rawQueryLoggingEnabled } from "./utils/logger";
export type { Logger } from "./utils/logger";

// =============================================================================
// Environment Validation
// =============================================================================
export { loadEnv } from "./env";
export type { RebaseEnv } from "./env";
/**
 * The runtime's own Zod instance.
 *
 * `loadEnv({ extend })` composes the caller's schema with the framework's, so
 * the two schemas must come from the same copy of zod: a schema built against
 * a second, duplicated zod fails the framework's `instanceof` checks and the
 * extension is silently dropped. Importing `z` from here instead of from
 * `"zod"` makes that impossible to get wrong, whatever the installer resolved.
 */
export { z } from "zod";

// =============================================================================
// Server-specific types (subscription types)
// =============================================================================
export * from "./types";

// =============================================================================
// Driver Registry
// =============================================================================
export * from "./services/driver-registry";

// =============================================================================
// Webhooks
// =============================================================================
// The docs and the rebase-webhooks skill teach `WebhookDispatcher`. The package
// exports map is `{ ".": … }` only, so the deep import they used
// (`@rebasepro/server/services/webhook-service`) resolves in-repo and fails for
// every installed consumer. Exported from the root, where it is reachable.
export * from "./services/webhook-service";
// The destination guard the dispatcher runs before every attempt. Exported on
// its own because a webhook is not the only outbound call whose URL comes from
// data — anything that fetches a stored address wants the same check.
export * from "./services/outbound-url-guard";

// =============================================================================
// Jobs — the durable queue. Application code both produces (`enqueue`) and
// consumes (`tasks`, `register`), so the whole surface is public.
// =============================================================================
export { createJobQueue, createJobStore, defaultBackoff } from "./jobs";
export type {
    JobQueue,
    JobStore,
    JobContext,
    JobHandler,
    JobRecord,
    JobStatus,
    JobQueueClient,
    JobQueueOptions,
    EnqueueOptions
} from "./jobs";

// =============================================================================
// @internal — dev-server / SPA-serving plumbing for the official app template.
// Not part of the stable public API; see the JSDoc on each symbol.
// =============================================================================
export { cleanupDevPortFile, listenWithPortRetry } from "./utils/dev-port";
export { serveSPA } from "./serve-spa";

// =============================================================================
// Graceful shutdown
// =============================================================================
export { installShutdownHandlers } from "./init/shutdown";
export type { ShutdownHandlerOptions } from "./init/shutdown";

// =============================================================================
// Bundle runtime
//
// The entrypoint the official `rebasepro/server` image runs, and the same one a
// self-hosted deployment uses. `bootFromBundle` subsumes what every project
// used to hand-write in `backend/src/index.ts`.
// =============================================================================
export { bootFromBundle, runFromBundle } from "./boot/boot";
export type { BootedRuntime, BootOptions, SchemaProvisioningOptions } from "./boot/boot";

// Concurrent-DDL classification, exported for the drivers.
//
// `CREATE … IF NOT EXISTS` reads the catalog and then writes to it, so instances
// booting together do collide — measured at 8 losses in 10 with five peers. A
// driver applying a schema plan needs the same classification the server's own
// bootstraps use, and a second copy of the SQLSTATE list in each driver is
// exactly how the two drift.
export {
    createDdlBootstrapper,
    isConcurrentDdlRace,
    isDuplicateObjectRace,
    CONCURRENT_DDL_SQLSTATES
} from "./boot/ddl-bootstrap";
export type { DdlBootstrapper, SqlExec } from "./boot/ddl-bootstrap";
export {
    BundleError,
    loadBundle,
    readBundleManifest,
    loadBundleConfigExports,
    createSourceBundle,
    loadBundleSchema,
    loadUsersCollection
} from "./boot/bundle";
export type { LoadedBundle, BundleConfigExports } from "./boot/bundle";
export { loadBootEnv, resolveCorsOrigin, isLocalhostOrigin } from "./boot/env";
export type { RebaseBootEnv, CorsOriginResolver } from "./boot/env";
export { resolveAuthOptions, resolveEmailOptions } from "./boot/options";
export {
    ACCOUNT_SCOPED_STORAGE_BASES,
    envSuffixForKey,
    assertDistinctSuffixes,
    resolveDataSources,
    resolveStorageSources,
    resolveStorageBackend
} from "./boot/sources";
export type { ResolvedDataSourceConfig, EnvBag, ResolveStorageOptions } from "./boot/sources";
export {
    registerResourceResolver,
    resourceResolver,
    resourceResolvers,
    assertEveryKindBindable,
    unbindableKinds,
    implicitDeclaration
} from "./boot/resource-resolvers";
export type { ResourceResolver, ResourceResolution, ResolveContext } from "./boot/resource-resolvers";
export { initializeDataSource, initializeDataSources } from "./boot/driver";
export type { InitializedDataSource, DriverConnection, BundleSchema } from "./boot/driver";

// =============================================================================
// Metrics + project contract
// =============================================================================
export {
    MetricsRegistry,
    createMetricsMiddleware,
    createMetricsRoutes,
    classifySurface
} from "./metrics";
export type { MetricSurface, MetricsHandle } from "./metrics";
export { createContractRoutes } from "./api/contract-routes";
export type { ContractRoutesConfig } from "./api/contract-routes";


// =============================================================================
// Deployment contract
// =============================================================================
// What the chart and the control plane must agree on about the pod. Exported so
// the control plane conforms by construction; the chart is held to it by
// `tooling/scripts/check-chart.mjs`, which cannot import TypeScript.
export {
    RUNTIME_HEALTH_PATH,
    RUNTIME_LIVENESS_PATH,
    RUNTIME_PROBE_PATHS,
    TOPOLOGY_ENV_VARS,
    isTopologyEnvVar,
    RUNTIME_PRESTOP_DRAIN_SECONDS,
    RUNTIME_STARTUP_BUDGET_SECONDS,
    RUNTIME_MIN_TERMINATION_GRACE_SECONDS,
    RUNTIME_BUNDLE_MOUNT
} from "./deploy/pod-contract";
export type { TopologyEnvVar } from "./deploy/pod-contract";
