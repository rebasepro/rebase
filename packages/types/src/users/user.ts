
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

    /**
     * The **custom claims on this session's token**, as the server verified
     * them — not the user row's {@link metadata}, which is a different fact
     * with a different lifetime.
     *
     * The distinction matters for authorization. `metadata` is whatever the
     * users table holds right now; `claims` is what the caller's token asserts,
     * which is what the database sees: they reach RLS as `rebase.jwt()`, and
     * `policy.authClaim("org_id")` reads one. Multi-tenancy's `claim` form is
     * built on them.
     *
     * Identity claims are not here. `uid`, `roles`, `aal` and `isAnonymous` are
     * written *after* the custom claims when a token is minted, precisely so a
     * claims hook cannot assert them, and they have their own fields on this
     * type. Keeping them out means a rule reading `claims` can never be reading
     * something the session asserted about its own identity.
     *
     * Absent for a caller with no token — an API key, a service identity, an
     * anonymous request.
     */
    readonly claims?: Record<string, unknown>;

    getIdToken?: (forceRefresh?: boolean) => Promise<string>;

};
