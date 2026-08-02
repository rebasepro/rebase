/**
 * Authentication controller for Rebase frontends.
 *
 * Provides the `useRebaseAuthController` hook and API utilities for
 * communicating with a Rebase backend's JWT auth endpoints.
 *
 * The generic LoginView and RebaseAuth components that render on top of this
 * controller are in `../components`. Both are re-exported from the package
 * root, which is where applications should import them from.
 */

// Types
export type {
    RebaseAuthController,
    RebaseAuthControllerProps,
    User,
    AuthTokens,
    DeviceSession,
    AuthResponse,
    RefreshResponse
} from "./types";

export { useRebaseAuthController } from "./useRebaseAuthController";
// API utilities
export { fetchAuthConfig, clearAuthConfigCache, createAuthConfigCache } from "./api";
export type { AuthConfigResponse, AuthConfigCache } from "./api";
