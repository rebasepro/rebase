/**
 * @rebasepro/auth
 *
 * Custom JWT authentication adapter for the Rebase backend.
 * This package provides backend-specific auth hooks and API utilities.
 *
 * For the generic LoginView and RebaseAuth components, see @rebasepro/core.
 */

// Types
export type {
    RebaseAuthController,
    RebaseAuthControllerProps,
    AuthTokens,
    UserInfo,
    AuthResponse,
    RefreshResponse
} from "./types";

export { useRebaseAuthController } from "./hooks/useRebaseAuthController";
export { useBackendUserManagement } from "./hooks/useBackendUserManagement";
export type { BackendUserManagementConfig, UserManagement } from "./hooks/useBackendUserManagement";

// API utilities
export { setApiUrl, getApiUrl, fetchAuthConfig, clearAuthConfigCache, AuthApiError } from "./api";
export type { AuthConfigResponse } from "./api";
