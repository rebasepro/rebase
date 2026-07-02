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
// Auth
// =============================================================================
export * from "./auth";

// =============================================================================
// API Layer
// =============================================================================
export * from "./api";

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
// Internal plumbing exported for the official app/backend
// =============================================================================
export { cleanupDevPortFile, listenWithPortRetry } from "./utils/dev-port";
export { serveSPA } from "./serve-spa";

// =============================================================================
// Graceful shutdown
// =============================================================================
export { installShutdownHandlers } from "./init/shutdown";
export type { ShutdownHandlerOptions } from "./init/shutdown";

