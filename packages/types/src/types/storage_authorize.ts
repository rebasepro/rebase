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
    claims?: Record<string, unknown>;
}

export interface StorageAuthorizeContext {
    /** Object key, bucket prefix stripped and traversal already sanitized. */
    key: string;
    /**
     * The bucket, by one name per bucket. On S3 and GCS, whose source serves a
     * single bucket, this is always `"default"` — also when the request named
     * the provider's bucket (`acme-media`), which reaches the same objects.
     */
    bucket: string;
    operation: StorageOperation;
    /** Null when the route allows unauthenticated access. */
    user: StorageAuthorizeUser | null;
    /**
     * Named backend the request targeted, when one was given — as its canonical
     * key, the one the request is served from (`" media "` arrives as
     * `"media"`). Absent for the default source, however the request named it.
     */
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
 * The slice of the data API a storage hook needs: read a table, in the
 * trusted server context.
 *
 * Deliberately read-only and deliberately tiny. A hook that can write is a hook
 * that can be tricked into writing, and an authorization check has no business
 * mutating anything.
 */
export interface StorageAuthorizeData {
    table(slug: string): {
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

/**
 * Who a {@link StorageRule} grants to — data only, so it can live in an
 * environment variable and be edited in a console:
 *
 * - `"public"` — anyone, signed in or not
 * - `"authenticated"` — any signed-in caller
 * - `"owner"` — the signed-in caller whose uid is the key's `:uid` segment
 *   (the rule's `path` must capture one)
 * - `{ roles: [...] }` — a signed-in caller holding any of these roles
 *
 * @group Storage
 */
export type StorageRuleAllow = "public" | "authenticated" | "owner" | { roles: string[] };

/**
 * One storage access rule, as data: the form `STORAGE_POLICIES` takes (a JSON
 * array of these), for a deployment that runs no code of its own — the managed
 * runtime, Rebase Cloud's console. The same deny-by-default list as
 * `storagePolicies`: a key no rule matches is refused, and a rule that matched
 * and did not grant is a denial.
 *
 * ```json
 * [
 *   { "path": "public/**", "operations": ["read"], "allow": "public" },
 *   { "path": "users/:uid/**", "allow": "owner" },
 *   { "path": "**", "allow": { "roles": ["admin"] } }
 * ]
 * ```
 *
 * @group Storage
 */
export interface StorageRule {
    /**
     * A key pattern, matched segment by segment: a literal matches itself,
     * `*` one segment, `:name` one segment and captures it, `**` the rest
     * (final segment only).
     */
    path: string;
    /** Which operations it grants. Every one of them when omitted. */
    operations?: StorageOperation[];
    allow: StorageRuleAllow;
}

/**
 * Where a project with no storage rules of its own starts — what Rebase
 * Cloud gives a new project and what its console offers as "recommended":
 * a `public/` folder anyone may read, a `users/<uid>/` folder only its user
 * may touch, and every key to admins. Rules are deny-by-default, so this is
 * also everything a caller may do.
 *
 * @group Storage
 */
export const RECOMMENDED_STORAGE_RULES: readonly StorageRule[] = Object.freeze([
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: "owner" },
    { path: "**", allow: { roles: ["admin"] } }
] satisfies StorageRule[]);
