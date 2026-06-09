import type { User } from "../users";

/**
 * Result of creating a new user via admin flow.
 * Contains the created user plus information about how credentials were delivered.
 */
export interface UserCreationResult<USER extends User = User> {
    /** The created user */
    user: USER;
    /** Whether an invitation email was sent to the user */
    invitationSent: boolean;
    /**
     * Temporary password (only present when email service is not configured).
     * This is returned one-time and should be shown to the admin to share manually.
     */
    temporaryPassword?: string;
}


/**
 * Delegate to manage auth-specific user operations.
 *
 * This interface allows the CMS to be agnostic of the underlying
 * authentication provider or backend. User/role CRUD is now handled
 * by the collection system; this delegate only exposes auth-specific
 * operations (password hashing, invitations, bootstrap).
 *
 * @group Models
 */
export interface UserManagementDelegate<USER extends User = User> {

    /**
     * Are auth-related operations currently loading?
     */
    loading: boolean;

    /**
     * In-memory list of users (used for client-side filtering fallback).
     */
    users?: USER[];

    /**
     * Error from fetching the users list, if any.
     */
    usersError?: Error;

    /**
     * Look up a single user by UID from the in-memory cache.
     */
    getUser?: (uid: string) => USER | null;

    /**
     * Server-side user search with pagination.
     */
    searchUsers?: (params: { search?: string; limit?: number; offset?: number }) => Promise<{ users: USER[]; total: number }>;

    /**
     * Create a new user with invitation/password generation support.
     * Returns additional info about how the credentials were delivered.
     */
    createUser?: (user: USER) => Promise<UserCreationResult<USER>>;

    /**
     * Reset the password for an existing user.
     * Returns a temporary password if no email service is configured,
     * or a flag indicating an email invitation was sent.
     */
    resetPassword?: (user: USER) => Promise<UserCreationResult<USER>>;

    /**
     * Is the currently logged in user an admin?
     */
    isAdmin?: boolean;

    /**
     * Optionally define roles for a given user. This is useful when the roles
     * are coming from a separate provider than the one issuing the tokens.
     */
    defineRolesFor?: (user: USER) => Promise<string[] | undefined> | string[] | undefined;

    /**
     * Whether any admin users exist. Used by the bootstrap banner to decide
     * whether to prompt.  Populated via a lightweight check (e.g. `limit=1`
     * query) instead of loading all users.
     */
    hasAdminUsers?: boolean;

    /**
     * Optional function to bootstrap an admin user.
     * Often used when the database is empty.
     */
    bootstrapAdmin?: () => Promise<void>;

}
