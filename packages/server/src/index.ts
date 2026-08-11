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
    safeCompare
} from "./auth";
export type {
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

// =============================================================================
// Email
// =============================================================================
export * from "./email";

// =============================================================================
// Storage
// =============================================================================
export * from "./storage";

// =============================================================================
// Entity History
// =============================================================================
export { createHistoryRoutes } from "./history";

// =============================================================================
// Custom Functions (auto-discovered Hono routes)
// =============================================================================
export { loadFunctionsFromDirectory, createFunctionRoutes, defineFunction } from "./functions";
export type { LoadedFunction, RebaseFunctionContext } from "./functions";

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
export { logger } from "./utils/logger";
export type { Logger } from "./utils/logger";

// =============================================================================
// Environment Validation
// =============================================================================
export { loadEnv } from "./env";
export type { RebaseEnv } from "./env";

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
export type { BootedRuntime, BootOptions } from "./boot/boot";
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
    envSuffixForKey,
    assertDistinctSuffixes,
    loadDeclaredStorageSources,
    resolveDataSources,
    resolveStorageSources,
    resolveStorageBackend
} from "./boot/sources";
export type { ResolvedDataSourceConfig, EnvBag } from "./boot/sources";
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

