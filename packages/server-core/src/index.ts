/**
 * @rebasepro/server-core
 *
 * Database-Agnostic Backend Core for Rebase.
 * This package provides the core backend services, generic driver routing,
 * and API layers. Database implementations (e.g., PostgreSQL) are provided
 * by specialized driver packages like `@rebasepro/server-postgresql`.
 */

// =============================================================================
// Core Initialization
// =============================================================================
export {
    initializeRebaseBackend,
    isAuthAdapter,
    isDatabaseAdapter
} from "./init";
export type {
    RebaseBackendConfig,
    RebaseBackendInstance,
    RebaseAuthConfig
} from "./init";

// =============================================================================
// Server-side singleton (import { rebase } from "@rebasepro/server-core")
// =============================================================================
export { rebase, _setRebaseMock, _resetRebaseMock } from "./singleton";

// =============================================================================
// DB Abstractions (for database driver implementations)
// =============================================================================
export * from "./db/interfaces";

// =============================================================================
// Auth — curated public surface (NOT `export *`).
//
// `./auth` (auth/index.ts) intentionally exports its internal plumbing so
// server-core's own init/wiring can consume it: token generation & JWT config,
// password/token crypto, route mounters (`createAuthRoutes`, `mountMagicLink…`),
// rate limiters, and the low-level middleware factories. None of that is a
// backend-author API and none of it has external consumers, so it must not be
// republished at the package root. Below is the deliberate public list —
// driver-contract interfaces, custom-auth adapters, OAuth providers, route
// guards, password helpers, auth hooks, and API-key types. Add here on purpose.
// =============================================================================
// Driver contract: repositories + auth data types (implemented by the
// server-postgresql / server-mongodb drivers).
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
    // API-key permission helpers
    isApiKeyToken,
    validateApiKey,
    httpMethodToOperation,
    isOperationAllowed
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
export { loadCronJobsFromDirectory, CronScheduler, validateCronExpression, createCronRoutes, createCronStore, defineCron } from "./cron";
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
// Server-core specific types (subscription types)
// =============================================================================
export * from "./types";

// =============================================================================
// Driver Registry
// =============================================================================
export * from "./services/driver-registry";

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

