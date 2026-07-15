/**
 * @rebasepro/app
 *
 * React authentication controller for Rebase frontends.
 * Provides the `useRebaseAuthController` hook and API utilities
 * for communicating with a Rebase backend's JWT auth endpoints.
 *
 * For the generic LoginView and RebaseAuth components, see @rebasepro/app.
 */

// Types
export type {
    RebaseAuthController,
    RebaseAuthControllerProps,
    AuthTokens,
    DeviceSession,
    UserInfo,
    AuthResponse,
    RefreshResponse
} from "./types";

export { useRebaseAuthController } from "./useRebaseAuthController";
// API utilities
export { fetchAuthConfig, clearAuthConfigCache, createAuthConfigCache, AuthApiError } from "./api";
export type { AuthConfigResponse, AuthConfigCache } from "./api";
