import type { User } from "@rebasepro/types";

/**
 * Capabilities advertised by an auth provider.
 * UI components use this to show/hide features dynamically
 * (e.g. password reset, registration, session management).
 * @group Hooks and utilities
 */
export interface AuthCapabilities {
    emailPasswordLogin?: boolean;
    googleLogin?: boolean;
    /** Self-registration is open right now — the wire's `registrationEnabled`. */
    registrationEnabled?: boolean;
    /** Self-service password reset (emailing a reset link) is available. */
    passwordReset?: boolean;
    /**
     * An admin can reset another user's password. Gates the "Reset Password"
     * entity action in the admin UI. See `AuthAdapterCapabilities`.
     */
    adminPasswordReset?: boolean;
    sessionManagement?: boolean;
    profileUpdate?: boolean;
    emailVerification?: boolean;
    /** List of enabled OAuth provider IDs (e.g. ["google", "github", "discord"]) */
    enabledProviders?: string[];
}

/**
 * Controller for retrieving the logged user or performing auth related operations.
 * Note that if you are implementing your AuthController, you probably will want
 * to do it as the result of a hook.
 * @group Hooks and utilities
 */
export type AuthController<USER extends User = User, ExtraData = unknown> = {

    /**
     * The user currently logged in
     * The values can be: the user object, null if they skipped login
     */
    user: USER | null;

    /**
     * Initial loading flag. It is used not to display the login screen
     * when the app first loads, and it has not been checked whether the user
     * is logged in or not.
     */
    initialLoading?: boolean;

    /**
     * Loading flag. It is used to display a loading screen when the user is
     * logging in or out.
     */
    authLoading: boolean;

    /**
     * Sign out
     */
    signOut: () => Promise<void>;

    /**
     * Error initializing the authentication
     */
    authError?: unknown;

    /**
     * Error dispatched by the auth provider
     */
    authProviderError?: unknown;

    /**
     * You can use this method to retrieve the auth token for the current user.
     */
    getAuthToken: () => Promise<string>;

    /**
     * Has the user skipped the login process
     */
    loginSkipped: boolean;

    extra: ExtraData;

    setExtra: (extra: ExtraData) => void;


    setUser?(user: USER | null): void;

    setUserRoles?(roles: string[]): void;

    /**
     * Capabilities advertised by the auth provider.
     * UI components use this to feature-detect what the backend supports.
     */
    capabilities?: AuthCapabilities;

};

/**
 * Extended auth controller with common optional auth methods.
 * Backend implementations (Rebase backend, Firebase, etc.)
 * extend this with their own backend-specific extras.
 * @group Hooks and utilities
 */
export interface AuthControllerExtended<USER extends User = User, ExtraData = unknown> extends AuthController<USER, ExtraData> {
    /** Login with email and password */
    emailPasswordLogin?(email: string, password: string): Promise<void>;
    /** Login with Google — accepts an ID token, access token, or authorization code payload */
    googleLogin?: (payload: { idToken: string } | { accessToken: string } | { code: string; redirectUri: string }) => Promise<void>;
    /** Generic OAuth login — works with any provider. Posts payload to /auth/{providerId}. */
    oauthLogin?: (providerId: string, payload: Record<string, unknown>) => Promise<void>;
    /** Register a new user */
    register?(email: string, password: string, displayName?: string): Promise<void>;
    /** Skip login (for anonymous access if enabled) */
    skipLogin?(): void;
    /** Request password reset email */
    forgotPassword?(email: string): Promise<void>;
    /** Reset password using a token */
    resetPassword?(token: string, password: string): Promise<void>;
    /** Change password for the authenticated user */
    changePassword?(oldPassword: string, newPassword: string): Promise<void>;
    /** Update user profile */
    updateProfile?(displayName?: string, photoURL?: string): Promise<USER>;
}
