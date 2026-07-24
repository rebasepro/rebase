/**
 * The storage access-control contract.
 *
 * Lives here rather than in `@rebasepro/server` because a project declares its
 * `storageAuthorize` hook from its **config package**, and a config package
 * depends on `@rebasepro/types` alone. A type the contract requires but the
 * contract's author cannot import is not much of a contract.
 *
 * `@rebasepro/server` re-exports all of this, so existing imports keep working.
 */

export type StorageOperation = "read" | "write" | "delete" | "list";

/** The caller, as resolved by whichever auth middleware ran. */
export interface StorageAuthorizeUser {
    uid: string;
    email?: string;
    roles?: string[];
}

export interface StorageAuthorizeContext {
    /** Object key, bucket prefix stripped and traversal already sanitized. */
    key: string;
    bucket: string;
    operation: StorageOperation;
    /** Null when the route allows unauthenticated access. */
    user: StorageAuthorizeUser | null;
    /** Named backend the request targeted, when one was given. */
    storageId?: string;
    /**
     * Trusted, RLS-bypassing data access, so the hook can answer the question it
     * actually has to answer: *who owns this object?*
     *
     * Without it the hook can only do prefix arithmetic on the key, which
     * expresses no real multi-tenant rule — ownership lives in a row, not in a
     * string. And it cannot simply import the server to get one: a project
     * declares this hook from its **config** package, which depends on
     * `@rebasepro/types` alone and cannot resolve `@rebasepro/server` at
     * runtime. So the accessor is handed in.
     *
     * It bypasses row-level security on purpose. The hook IS the authorization
     * decision; asking it to make that decision through a reader that has
     * already been narrowed by the caller's own permissions is circular.
     */
    data?: StorageAuthorizeData;
}

/**
 * The slice of the data API a storage hook needs: read a collection, in the
 * trusted server context.
 *
 * Deliberately read-only and deliberately tiny. A hook that can write is a hook
 * that can be tricked into writing, and an authorization check has no business
 * mutating anything.
 */
export interface StorageAuthorizeData {
    collection(slug: string): {
        find(query?: Record<string, unknown>): Promise<{ data: Record<string, unknown>[] }>;
        findById(id: string): Promise<Record<string, unknown> | null>;
    };
}

/**
 * Per-object access control for storage, the analogue of an RLS policy on a
 * collection.
 *
 * Without it, storage routes authenticate but do not authorize: `requireAuth`
 * and `publicRead` are global switches, so any signed-in user could read any
 * key they could name. That is fine for a single-tenant app and useless for a
 * multi-tenant one, where the only thing separating two tenants' files would be
 * key unguessability — not an access-control model. Multi-tenant apps were
 * left to route every byte through a custom function to get an ownership check
 * in, and each of them had to invent it.
 *
 * Return false (or throw) to deny. Denials surface as 403.
 */
export type StorageAuthorize = (ctx: StorageAuthorizeContext) => boolean | Promise<boolean>;
