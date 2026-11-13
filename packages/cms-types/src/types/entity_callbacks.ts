import type { CollectionConfig } from "./collections";
import type { QueryNarrowing, ReadOperation, ReadQuery } from "@rebasepro/types";
import type { EntityStatus, EntityValues } from "@rebasepro/types";
import type { User } from "@rebasepro/types";
import type { RebaseCallContext } from "@rebasepro/types";
import type { GeneratedDatabase } from "@rebasepro/types";

/**
 * Lifecycle callbacks for entity CRUD operations.
 *
 * Register per-collection on the collection's `callbacks` field, or globally
 * via `initializeRebaseBackend({ callbacks })`. Fires on **every** data path — REST API,
 * WebSocket / realtime subscriptions, and server-side writes through
 * `rebase.dataAsAdmin`.
 *
 * When both global and per-collection callbacks are registered, execution
 * order is: **global → collection → property callbacks**.
 *
 * @group Models
 */
export type CollectionCallbacks<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> = {

    /**
     * Callback used after fetching data.
     *
     * Fires on every read path. Use this for security-critical redaction
     * (PII masking, row filtering) — no read path bypasses it.
     *
     * @param props
     */
    afterRead?(props: AfterReadProps<M, USER>)
        : Promise<Record<string, unknown>> | Record<string, unknown>;

    /**
     * Callback used **before** a read is compiled, to narrow which rows it asks
     * for.
     *
     * {@link CollectionCallbacks.afterRead} sees rows that have already been
     * fetched, so nothing in userland could influence *which* rows a read
     * requests — a tenant scope, a visibility window, a per-role row filter all
     * had to be either pushed into every call site or written as an RLS policy.
     * This is the hook for that.
     *
     * Return conditions to **add**. They are AND-ed into the query the caller
     * sent, alongside its own `filter`, its `logical` group, the soft-delete
     * condition and the relation scope of a nested path.
     *
     * ### Additive by construction
     *
     * The return type cannot express a removal, a replacement or an `OR` with
     * the caller's own conditions: it is a filter to AND in, and `AND(q, c)` is
     * a subset of `q` for every `c`. That is deliberate and it is the reason
     * the hook is shaped this way rather than as `(query) => query`. A hook
     * handed the parsed query and asked to return one could drop a condition,
     * and on an RLS data plane a dropped condition is a widened read — the same
     * reasoning that makes `UnknownFilterFieldsMode` in
     * `@rebasepro/server-postgres` default to `"error"` rather than to dropping
     * what it cannot compile.
     *
     * For the same reason the returned filter is compiled with unknown fields
     * **always** fatal, whatever the process-wide mode is: a scoping condition
     * on a renamed column must refuse the request, never run without it.
     *
     * ### Every read path, no bypass
     *
     * It fires on the listing, the single get, the count, the aggregate, the
     * search, the vector read, the nested-path listing, the realtime refetch
     * that builds subscription frames, and on the rows loaded for a relation or
     * an `include` — where it is the **target** collection's hook that applies,
     * because those are the target's rows. A hook honoured by the listing and
     * not by the count is a page that says "1 of 4 results".
     *
     * Two reads are deliberately not narrowed, and both would be wrong to
     * narrow:
     *
     * - **`checkUniqueField`.** It asks whether a value exists *anywhere* in
     *   the table. Narrowed, it would answer "unique" for a value a row the
     *   caller cannot see already holds, and the insert would then fail on the
     *   constraint instead.
     * - **A write's own pre-read** is narrowed, not exempt: an update or delete
     *   addressed at a row this hook excludes answers "not found", which is the
     *   same answer the read gives.
     *
     * ### Postgres only
     *
     * Implemented by `@rebasepro/server-postgres`, the only server engine.
     *
     * @example
     * ```ts
     * callbacks: {
     *     beforeQuery: ({ context }) => {
     *         if (context.user?.roles?.includes("admin")) return;
     *         return { filter: { owner_id: ["==", context.user?.uid ?? null] } };
     *     }
     * }
     * ```
     *
     * @param props
     */
    beforeQuery?(props: BeforeQueryProps<M, USER>)
        : Promise<QueryNarrowing<M> | void> | QueryNarrowing<M> | void;

    /**
     * Callback used before saving, you need to return the values that will get
     * saved. If you throw an error in this method the process stops, and an
     * HTTP error response is returned to the client.
     * This runs after schema validation.
     *
     * @param props
     */
    beforeSave?(props: BeforeSaveProps<M, USER>)
        : Promise<Partial<EntityValues<M>>> | Partial<EntityValues<M>>;

    /**
     * Callback used when save is successful.
     *
     * @param props
     */
    afterSave?(props: AfterSaveProps<M, USER>)
        : Promise<void> | void;

    /**
     * Callback used when saving fails
     * @param props
     */
    afterSaveError?(props: AfterSaveErrorProps<M, USER>)
        : Promise<void> | void;

    /**
     * Callback used before the entity is deleted.
     * If you throw an error in this method the process stops, and an
     * HTTP error response is returned to the client.
     *
     * @param props
     */
    beforeDelete?(props: BeforeDeleteProps<M, USER>): Promise<boolean | void> | boolean | void;

    /**
     * Callback used after the entity is deleted.
     *
     * @param props
     */
    afterDelete?(props: AfterDeleteProps<M, USER>): Promise<void> | void;

}

/**
 * Parameters passed to hooks when a entity is fetched
 * @group Models
 */
export interface AfterReadProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * Collection of the entity
     */
    collection: CollectionConfig<M>;

    /**
     * Full path of the admin where this collection is being fetched.
     * Might contain unresolved aliases.
     */
    path: string;

    /**
     * Fetched row (flat — the table's columns)
     */
    row: Record<string, unknown>

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * Parameters passed to a {@link CollectionCallbacks.beforeQuery} hook.
 *
 * @group Models
 */
export interface BeforeQueryProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * Collection being read. For `operation: "relation"` this is the
     * **target** collection — the one the rows belong to.
     */
    collection: CollectionConfig<M>;

    /**
     * Full path being read. Might contain unresolved aliases, and for a nested
     * read it is the target collection's own path rather than the nested one —
     * the nested parent is on {@link ReadQuery.relatedTo}.
     */
    path: string;

    /** Which read this is. */
    operation: ReadOperation;

    /** The parsed read, read-only. */
    query: ReadQuery<M>;

    /**
     * Context of the app status.
     *
     * `context.data` is the caller's own plane, so a lookup made here is
     * itself RLS-scoped — and it is a read issued from inside a read, on the
     * same connection. Keep it to something cheap and cacheable, or read it
     * once per request outside the hook.
     */
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * Parameters passed to hooks before a entity is saved
 * @group Models
 */
export type BeforeSaveProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<AfterSaveProps<M, USER>, "id">
    & {
        id?: string | number;
    }
/**
 * Parameters passed to hooks when a save fails.
 *
 * `id` is optional because a failed create may never have been assigned one.
 * `error` is what the save threw — the reason the hook exists. Documented since
 * the callbacks guide first shipped, and until now not on the type or on the
 * object: a handler that read `props.error` compiled and logged `undefined`.
 *
 * @group Models
 */
export type AfterSaveErrorProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<AfterSaveProps<M, USER>, "id">
    & {
        id?: string | number;

        /**
         * Whatever the save threw: a `RebaseApiError` when a `before*` callback
         * or a validator refused it, otherwise the driver's error with the
         * SQLSTATE in its cause chain. Not narrowed, because a callback may
         * throw anything.
         */
        error: unknown;
    }

/**
 * Parameters passed to hooks when a entity is saved
 * @group Models
 */
export interface AfterSaveProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * Resolved collection of the entity
     */
    collection: CollectionConfig<M>;

    /**
     * Full path of the admin where this entity is being saved.
     * Might contain unresolved aliases.
     */
    path: string;

    /**
     * ID of the entity
     */
    id: string | number;

    /**
     * Values being saved
     */
    values: Partial<EntityValues<M>>;

    /**
     * Previous values
     */
    previousValues?: Partial<EntityValues<M>>;

    /**
     * New or existing entity
     */
    status: EntityStatus;

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * Parameters passed to hooks when a entity is deleted
 * @group Models
 */
export interface BeforeDeleteProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * collection of the entity being deleted
     */
    collection: CollectionConfig<M>;

    /**
     * Path of the parent collection
     */
    path: string;

    /**
     * Deleted entity id
     */
    id: string | number;

    /**
     * Deleted row (flat — the table's columns)
     */
    row: Record<string, unknown>;

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * Parameters passed to hooks after a entity is deleted
 * @group Models
 */
export interface AfterDeleteProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * collection of the entity being deleted
     */
    collection: CollectionConfig<M>;

    /**
     * Path of the parent collection
     */
    path: string;

    /**
     * Deleted entity id
     */
    id: string | number;

    /**
     * Deleted row (flat — the table's columns)
     */
    row: Record<string, unknown>;

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER, GeneratedDatabase>;
}
