
/**
 * The canonical representation of an authenticated user in the Rebase ecosystem.
 *
 * Used by {@link AuthController}, collections, callbacks, and both the
 * `@rebasepro/client` and `@rebasepro/app` packages. It is the only user type
 * those packages export — the `RebaseUser` / `UserInfo` aliases are gone.
 *
 * **Backend-managed fields** (`uid`, `email`, `roles`, `metadata`, `createdAt`)
 * are populated by the server. **Client-visible fields** (`displayName`,
 * `photoURL`, `providerId`, `isAnonymous`, `emailVerified`) may be set during
 * authentication or profile updates.
 *
 * @see AdminUser — the admin-API DTO, which adds audit fields (`createdAt`,
 * `updatedAt`) and required `roles`.
 *
 * @group Models
 */
export type User = {
    /**
     * The user's unique ID, scoped to the project.
     */
    readonly uid: string;
    /**
     * The display name of the user.
     */
    readonly displayName: string | null;
    /**
     * The email of the user.
     */
    readonly email: string | null;
    /**
     * The profile photo URL of the user.
     */
    readonly photoURL: string | null;
    /**
     * The provider used to authenticate the user (e.g. `"password"`,
     * `"google"`, `"github"`).
     */
    readonly providerId: string;
    /**
     * Whether the user is anonymous (created via anonymous sign-in).
     */
    readonly isAnonymous: boolean;

    /**
     * Whether the user's email address has been verified.
     */
    readonly emailVerified?: boolean;

    /**
     * Role IDs assigned to this user (e.g. `["admin", "editor"]`).
     */
    roles?: string[];

    /**
     * The date and time when the user was created.
     */
    createdAt?: Date | string | null;

    /**
     * Additional metadata/custom claims associated with the user.
     * Accessible by the frontend, but only writable by the backend.
     */
    readonly metadata?: Record<string, any>;

    getIdToken?: (forceRefresh?: boolean) => Promise<string>;

};
