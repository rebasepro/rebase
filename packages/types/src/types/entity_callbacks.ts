import type { CollectionConfig } from "./collections";
import type { EntityStatus, EntityValues } from "./entities";
import type { User } from "../users";
import type { RebaseCallContext } from "../call_context";

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
    context: RebaseCallContext<USER>;
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
    context: RebaseCallContext<USER>;
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
    context: RebaseCallContext<USER>;
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
    context: RebaseCallContext<USER>;
}
