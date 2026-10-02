/**
 * API keys module.
 *
 * Re-exports types, store, middleware and routes for API key authentication.
 *
 * @module
 */

// Types
export type {
    ApiKey,
    ApiKeyKind,
    ApiKeyMasked,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    CreatePersonalKeyRequest,
    UpdateApiKeyRequest
} from "./api-key-types";

// Store
export { createApiKeyStore } from "./api-key-store";
export type { ApiKeyStore, ApiKeyFilter, NewApiKey } from "./api-key-store";

// Middleware
export {
    isApiKeyToken,
    resolveApiKey,
    validateApiKey,
    createApiKeyPreAuth,
    createFunctionScopeGuard,
    createTusScopeGuard
} from "./api-key-middleware";
export type { ApiKeyAuthOptions, ApiKeyIdentity, ApiKeyRefusal } from "./api-key-middleware";

// Operations
export { httpMethodToOperation } from "./http-operation";
export type { DataOperation } from "./http-operation";

// Routes
export { createApiKeyRoutes, createPersonalKeyRoutes } from "./api-key-routes";
export type { ApiKeyRouteOptions, PersonalKeyRouteOptions } from "./api-key-routes";
export type { KeyTargets } from "./key-grant";
