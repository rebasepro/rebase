import type { AdminUser, AdminRole } from "../controllers/client";

/**
 * Context passed to every backend hook.
 * Provides information about the request that triggered the hook.
 * @group Backend Hooks
 */
export interface BackendHookContext {
    /** The currently authenticated user making the request (if any) */
    requestUser?: { userId: string; roles: string[] };
    /** The HTTP method of the request */
    method: "GET" | "POST" | "PUT" | "DELETE";
}

/**
 * Hooks for intercepting Admin User data at the API boundary.
 *
 * These hooks run on the server after the database operation completes
 * but before the response is sent to the client.
 *
 * @group Backend Hooks
 */
export interface UserHooks {
    /**
     * Transform a user record after it's read from the database,
     * before it's returned to the client.
     *
     * Return the modified user, or `null` to filter it out entirely
     * (the user won't appear in listings or individual fetches).
     */
    afterRead?(user: AdminUser, context: BackendHookContext): AdminUser | null | Promise<AdminUser | null>;

    /**
     * Transform user data before it's written to the database.
     * Runs on POST (create) and PUT (update).
     *
     * Return the (possibly modified) data to proceed with the save.
     * Throw an error to abort the operation.
     */
    beforeSave?(data: { email?: string; displayName?: string; roles?: string[] }, context: BackendHookContext): { email?: string; displayName?: string; roles?: string[] } | Promise<{ email?: string; displayName?: string; roles?: string[] }>;

    /**
     * Called after a user is successfully created or updated.
     * Useful for side-effects like sending notifications.
     */
    afterSave?(user: AdminUser, context: BackendHookContext): void | Promise<void>;

    /**
     * Called before a user is deleted. Throw to prevent deletion.
     */
    beforeDelete?(userId: string, context: BackendHookContext): void | Promise<void>;

    /**
     * Called after a user is successfully deleted.
     */
    afterDelete?(userId: string, context: BackendHookContext): void | Promise<void>;
}

/**
 * Hooks for intercepting Admin Role data at the API boundary.
 * @group Backend Hooks
 */
export interface RoleHooks {
    /**
     * Transform a role record after it's read from the database,
     * before it's returned to the client.
     *
     * Return the modified role, or `null` to filter it out entirely.
     */
    afterRead?(role: AdminRole, context: BackendHookContext): AdminRole | null | Promise<AdminRole | null>;
}

/**
 * Backend-level hooks for intercepting admin data (users, roles)
 * at the API boundary.
 *
 * These hooks run server-side after database reads and before API
 * responses are sent. They complement the per-collection `EntityCallbacks`
 * system which handles collection CRUD operations.
 *
 * @example
 * ```typescript
 * const hooks: BackendHooks = {
 *     users: {
 *         afterRead(user, ctx) {
 *             // Hide system users from the UI
 *             if (user.email.endsWith("@system.internal")) {
 *                 return null;
 *             }
 *             return user;
 *         },
 *         afterSave(user) {
 *             console.log(`User saved: ${user.email}`);
 *         }
 *     }
 * };
 * ```
 *
 * @group Backend Hooks
 */
export interface BackendHooks {
    /** Hooks for intercepting user management data */
    users?: UserHooks;
    /** Hooks for intercepting role management data */
    roles?: RoleHooks;
}
