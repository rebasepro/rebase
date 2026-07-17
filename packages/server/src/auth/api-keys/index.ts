/**
 * Service API Keys module.
 *
 * Re-exports types, store, middleware, permission guard, and routes
 * for the API key authentication system.
 *
 * @module
 */

// Types
export type {
    ApiKey,
    ApiKeyMasked,
    ApiKeyPermission,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    UpdateApiKeyRequest
} from "./api-key-types";

// Store
export { createApiKeyStore } from "./api-key-store";
export type { ApiKeyStore } from "./api-key-store";

// Middleware
export { isApiKeyToken, validateApiKey, createApiKeyPreAuth, createFunctionApiKeyGuard } from "./api-key-middleware";
export type { ApiKeyAuthOptions } from "./api-key-middleware";

// Permission guard
export {
    httpMethodToOperation,
    isOperationAllowed,
    isFunctionAllowed
} from "./api-key-permission-guard";
export type { ApiKeyOperation } from "./api-key-permission-guard";

// Routes
export { createApiKeyRoutes } from "./api-key-routes";
export type { ApiKeyRouteOptions } from "./api-key-routes";
