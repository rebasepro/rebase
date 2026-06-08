// Auth module exports
export * from "./interfaces";

export { configureJwt, generateAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken, getRefreshTokenExpiry, getAccessTokenExpiry } from "./jwt";
export type { JwtConfig, AccessTokenPayload } from "./jwt";

export { hashPassword, verifyPassword, validatePasswordStrength } from "./password";
export type { PasswordValidationResult } from "./password";

export type { AuthHooks, AuthMethod, ResolvedAuthOperations } from "./auth-hooks";
export { resolveAuthHooks } from "./auth-hooks";

// OAuth Providers
export { createGoogleProvider } from "./google-oauth";
export type { GoogleProviderConfig } from "./google-oauth";
export { createLinkedinProvider } from "./linkedin-oauth";
export { createGitHubProvider } from "./github-oauth";
export { createMicrosoftProvider } from "./microsoft-oauth";
export { createAppleProvider } from "./apple-oauth";
export { createFacebookProvider } from "./facebook-oauth";
export { createTwitterProvider } from "./twitter-oauth";
export { createDiscordProvider } from "./discord-oauth";
export { createGitLabProvider } from "./gitlab-oauth";
export { createBitbucketProvider } from "./bitbucket-oauth";
export { createSlackProvider } from "./slack-oauth";
export { createSpotifyProvider } from "./spotify-oauth";

export { requireAuth, requireAdmin, optionalAuth, extractUserFromToken, createAuthMiddleware } from "./middleware";
export type { AuthMiddlewareOptions, AuthResult } from "./middleware";


export { createAuthRoutes } from "./routes";
export type { AuthModuleConfig } from "./routes";

export { createAdminRoutes } from "./admin-routes";


export { createRateLimiter, defaultAuthLimiter, strictAuthLimiter, createApiKeyRateLimiter, apiKeyKeyGenerator } from "./rate-limiter";

// API Keys
export { createApiKeyStore, createApiKeyRoutes, isApiKeyToken, validateApiKey, httpMethodToOperation, isOperationAllowed } from "./api-keys";
export type { ApiKey, ApiKeyMasked, ApiKeyPermission, ApiKeyWithSecret, CreateApiKeyRequest, UpdateApiKeyRequest, ApiKeyStore, ApiKeyOperation } from "./api-keys";

// Auth Adapters
export { createBuiltinAuthAdapter } from "./builtin-auth-adapter";
export type { BuiltinAuthAdapterConfig } from "./builtin-auth-adapter";
export { createCustomAuthAdapter } from "./custom-auth-adapter";
export { createAdapterAuthMiddleware } from "./adapter-middleware";
export type { AdapterAuthMiddlewareOptions } from "./adapter-middleware";
