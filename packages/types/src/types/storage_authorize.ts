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
