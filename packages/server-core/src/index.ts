/**
 * @rebasepro/server-core
 *
 * Database-Agnostic Backend Core for Rebase.
 * This package provides the core backend services, generic driver routing,
 * and API layers. Database implementations (e.g., PostgreSQL) are provided
 * by specialized driver packages like `@rebasepro/server-postgresql`.
 */

// =============================================================================
// Abstract Interfaces (for database abstraction)
// =============================================================================
export * from "./db/interfaces";
export * from "./auth/interfaces";

// Core functionality
export * from "./init";

// Server-side singleton (import { rebase } from "@rebasepro/server-core")
export { rebase } from "./singleton";

// Services
export * from "./services/driver-registry";

// API types (HonoEnv, ApiConfig, etc.)
export * from "./api/types";

// API Generation
export * from "./api";

// Types
export * from "./types";
export * from "./types/index";

// Auth module
export * from "./auth";

// Email module
export * from "./email";

// Storage module
export * from "./storage";

export * from "./utils/logging";
export * from "./utils/logger";
export * from "./utils/request-logger";
export * from "./utils/sql";

// Entity history
export * from "./history";

// Custom Functions (auto-discovered Hono routes)
export * from "./functions";

// Cron Jobs (auto-discovered scheduled tasks)
export * from "./cron";


// SPA serving helper
export * from "./serve-spa";

// Dev-mode port resolution (retry on EADDRINUSE)
export * from "./utils/dev-port";

// Backend bootstrappers (pluggable driver initialization)

