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
 * A second factor an account can finish signing in with, as a sign-in refused
 * with `MFA_REQUIRED` lists it in `details.factors`.
 * @group Hooks and utilities
 */
export interface MfaFactorSummary {
    id: string;
    /** `"totp"` for an authenticator app. */
    factorType: string;
    /** The name the user gave the factor when enrolling it, if any. */
    friendlyName?: string;
}

/**
 * A second factor on the signed-in account, as its settings list it.
 * @group Hooks and utilities
 */
export interface MfaFactorInfo {
    id: string;
    /** `"totp"` for an authenticator app. */
    factorType: string;
    friendlyName?: string;
    /** `false` until a code from the authenticator confirmed the enrolment. */
    verified: boolean;
    createdAt: string;
}

/**
 * An authenticator being added: the key to put in the app, and — with the
 * account's first factor — recovery codes, shown once.
 * @group Hooks and utilities
 */
export interface MfaEnrollment {
    factorId: string;
    /** The TOTP secret, base32, for typing into an authenticator. */
    secret: string;
    /** The `otpauth://` URI an authenticator app opens. */
    uri: string;
    recoveryCodes: string[] | null;
}

/**
 * The signed-in account's own second factors. Changing them needs a session
 * that presented one (`aal2`) once the account has a verified factor; such a
 * call is refused with `AAL2_REQUIRED`, and {@link stepUp} is the answer.
 * @group Hooks and utilities
 */
export interface MfaSettingsController {
    listFactors(): Promise<MfaFactorInfo[]>;
    enroll(friendlyName?: string): Promise<MfaEnrollment>;
    /** Confirm an enrolment with a code from the authenticator. */
    verifyEnrollment(factorId: string, code: string): Promise<void>;
    removeFactor(factorId: string): Promise<void>;
    /** Replace the recovery codes with new ones, shown once. */
    regenerateRecoveryCodes(): Promise<string[]>;
    /**
     * Present a code from a verified factor (or a recovery code), which turns
     * this session into an `aal2` one.
     */
    stepUp(factorId: string, code: string): Promise<void>;
}

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
    /**
     * `confirmationRequired` when the backend registers confirm-first: the
     * account exists but nobody is signed in until the mailed link is followed.
     */
    register?(email: string, password: string, displayName?: string): Promise<{ confirmationRequired?: boolean } | void>;
    /** Skip login (for anonymous access if enabled) */
    skipLogin?(): void;
    /** Request password reset email */
    forgotPassword?(email: string): Promise<void>;
    /** Reset password using a token */
    resetPassword?(token: string, password: string): Promise<void>;
    /** Confirm an email address using the token from a verification email */
    /**
     * Confirm an address with the token from its link. Refused with
     * `PROOF_REQUIRED` when the account holds a password the call does not
     * prove: pass `password` to keep it (and sign in), or `removeUnproven` to
     * verify without it.
     */
    verifyEmail?(token: string, options?: { password?: string; removeUnproven?: boolean }): Promise<{ passwordRemoved?: boolean; signedIn?: boolean } | void>;
    /**
     * Sign in with the token from a magic link
     * (`<frontend>/auth/magic-link?token=…`). A refusal — `MFA_REQUIRED`
     * among them — is recorded in `authProviderError`, as every sign-in's is.
     */
    magicLinkLogin?(token: string): Promise<void>;
    /** Change password for the authenticated user */
    changePassword?(oldPassword: string, newPassword: string): Promise<void>;
    /**
     * Ask to move the signed-in account to `newEmail`: a link is mailed to
     * it, and nothing changes until the link is followed.
     */
    changeEmail?(newEmail: string): Promise<{ pendingEmail: string; expiresAt: string }>;
    /**
     * Follow an address-change link with its token. Needs no session.
     * `removedProviders` names the sign-in providers detached because they
     * vouched for the old address.
     */
    confirmEmailChange?(token: string): Promise<{ email: string; removedProviders: string[] }>;
    /** Update user profile */
    updateProfile?(displayName?: string, photoURL?: string): Promise<USER>;
    /**
     * Open a challenge against one of the factors a sign-in refused with
     * `MFA_REQUIRED` listed, using that refusal's `details.mfaToken`. Resolves
     * to the challenge id `verifyMfaChallenge` answers.
     */
    startMfaChallenge?(mfaToken: string, factorId: string): Promise<string>;
    /**
     * Answer a challenge with a code from the authenticator app or a recovery
     * code. On success the user is signed in, as by any other sign-in.
     */
    verifyMfaChallenge?(mfaToken: string, challengeId: string, code: string): Promise<void>;
    /** The signed-in account's own second factors. Absent when the client has no MFA support. */
    mfaSettings?: MfaSettingsController;
    /**
     * The scopes the signed-in user holds (`GET /auth/scopes`), so a screen
     * can offer an action only to those its route admits. `undefined` until
     * known, and while signed out.
     */
    heldScopes?: string[];
}
