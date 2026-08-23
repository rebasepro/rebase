// Auth module exports
export * from "./interfaces";

export { configureJwt, isJwtConfigured, generateAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken, getRefreshTokenExpiry, getAccessTokenExpiry, generateDownloadToken, verifyDownloadToken, getJwks, hasAsymmetricSigningKey } from "./jwt";
export type { JwtConfig, AccessTokenPayload, DownloadTokenPayload } from "./jwt";
export { createJwksRoutes } from "./jwks-routes";
export type { JwtSigningKeyConfig, JwtSigningAlgorithm, PublicJwk } from "./jwt-keys";

export { hashPassword, verifyPassword, validatePasswordStrength } from "./password";
// Constant-time compare for static secrets (service keys), so token checks
// outside this package cannot accidentally use ===.
export { safeCompare } from "./crypto-utils";
export type { PasswordValidationResult } from "./password";

export type { AuthHooks, AuthMethod, ResolvedAuthHooks } from "./auth-hooks";
export { resolveAuthHooks } from "./auth-hooks";

export { generateSecurePassword, generateSecureToken, hashToken, prepareAdminUserValues, finalizeAdminUserCreation } from "./admin-user-ops";
export type { AdminUserContext, AdminUserPrepareResult } from "./admin-user-ops";

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
export type { AppleCodeFlowPayload } from "./apple-oauth";

// Shared OAuth machinery — the controls every provider, including a custom one
// passed through `auth.providers`, is expected to go through.
export { oauthCodeFlowSchema, pkceTokenParams, providerVerifiedEmail } from "./oauth-code-flow";
export type { OAuthCodeFlowPayload } from "./oauth-code-flow";
export { verifyOidcIdToken, tryVerifyOidcIdToken } from "./oidc-id-token";
export type { OidcIdTokenClaims, VerifyOidcIdTokenOptions } from "./oidc-id-token";
export { decideOAuthAutoLink, isRedirectUriAllowed } from "./oauth-signin-policy";
export type { AutoLinkDecision, AutoLinkRefusal } from "./oauth-signin-policy";

export { requireAuth, requireAdmin, optionalAuth, extractUserFromToken, createAuthMiddleware, queryTokenAuth, fileTokenAuth } from "./middleware";
export type { AuthMiddlewareOptions, AuthResult } from "./middleware";


export { createAuthRoutes } from "./routes";
export type { AuthModuleConfig, CookieAuthConfig } from "./routes";
export { buildBuiltinAuthCapabilities } from "./capabilities";
export type { BuiltinAuthCapabilityInputs } from "./capabilities";

export { mountMagicLinkRoutes } from "./magic-link-routes";

// Bot protection. The verifier is injectable, so no provider SDK enters this
// package's dependency graph — the built-in one is a form post.
export {
    buildCaptchaMiddlewares,
    createCaptchaMiddleware,
    createHttpCaptchaVerifier,
    resolveCaptchaVerifier,
    DEFAULT_CAPTCHA_ROUTES
} from "./captcha";
export type {
    CaptchaConfig,
    CaptchaProvider,
    CaptchaRoute,
    CaptchaVerifier,
    CaptchaVerifyRequest,
    CaptchaVerifyResult
} from "./captcha";

export { createResetPasswordRoute } from "./reset-password-admin";
export type { ResetPasswordRouteConfig } from "./reset-password-admin";


export { createRateLimiter, defaultAuthLimiter, strictAuthLimiter, createDataRateLimiter, apiKeyKeyGenerator } from "./rate-limiter";
export type { DataRateLimitConfig } from "./rate-limiter";
export { MemoryRateLimitStore } from "./rate-limit-store";
export type { RateLimitStore, RateLimitDecision } from "./rate-limit-store";
export { createSqlRateLimitStore } from "./sql-rate-limit-store";
export type { SqlRateLimitStoreOptions } from "./sql-rate-limit-store";
export { resolveRateLimitStoreKind, RateLimitStoreConfigurationError } from "./resolve-rate-limit-store";
export type { RateLimitStoreKind, RateLimitStoreEnv } from "./resolve-rate-limit-store";

// API Keys
export { createApiKeyStore, createApiKeyRoutes, isApiKeyToken, validateApiKey, httpMethodToOperation, isOperationAllowed } from "./api-keys";
export type { ApiKey, ApiKeyMasked, ApiKeyPermission, ApiKeyWithSecret, CreateApiKeyRequest, UpdateApiKeyRequest, ApiKeyStore, ApiKeyOperation } from "./api-keys";

// Auth Adapters
export { createBuiltinAuthAdapter } from "./builtin-auth-adapter";
export type { BuiltinAuthAdapterConfig } from "./builtin-auth-adapter";
export { createCustomAuthAdapter } from "./custom-auth-adapter";
export { createAdapterAuthMiddleware } from "./adapter-middleware";
export type { AdapterAuthMiddlewareOptions } from "./adapter-middleware";
