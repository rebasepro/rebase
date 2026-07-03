import type { SnapshotCollection } from "./collections";
import type { SnapshotStatus, SnapshotValues } from "./snapshots";
import type { User } from "../users";
import type { RebaseCallContext } from "../rebase_context";

/**
 * Lifecycle callbacks for snapshot CRUD operations.
 *
 * Register per-collection on the collection's `callbacks` field, or globally
 * via `initializeRebaseBackend({ callbacks })`. Fires on **every** data path — REST API,
 * WebSocket / realtime subscriptions, and server-side `rebase.data`.
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
        : Promise<Partial<SnapshotValues<M>>> | Partial<SnapshotValues<M>>;

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
     * Callback used before the snapshot is deleted.
     * If you throw an error in this method the process stops, and an
     * HTTP error response is returned to the client.
     *
     * @param props
     */
    beforeDelete?(props: BeforeDeleteProps<M, USER>): Promise<boolean | void> | boolean | void;

    /**
     * Callback used after the snapshot is deleted.
     *
     * @param props
     */
    afterDelete?(props: AfterDeleteProps<M, USER>): Promise<void> | void;

}

/**
 * Parameters passed to hooks when a snapshot is fetched
 * @group Models
 */
export interface AfterReadProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * Collection of the snapshot
     */
    collection: SnapshotCollection<M>;

    /**
     * Full path of the CMS where this collection is being fetched.
     * Might contain unresolved aliases.
     */
    path: string;

    /**
     * Fetched row (flat — `{ id, ...columns }`)
     */
    row: Record<string, unknown>

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER>;
}

/**
 * Parameters passed to hooks before a snapshot is saved
 * @group Models
 */
export type BeforeSaveProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<AfterSaveProps<M, USER>, "id">
    & {
        id?: string | number;
    }
/**
 * Parameters passed to hooks before a snapshot is saved
 * @group Models
 */
export type AfterSaveErrorProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<AfterSaveProps<M, USER>, "id">
    & {
        id?: string | number;
    }

/**
 * Parameters passed to hooks when a snapshot is saved
 * @group Models
 */
export interface AfterSaveProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * Resolved collection of the snapshot
     */
    collection: SnapshotCollection<M>;

    /**
     * Full path of the CMS where this snapshot is being saved.
     * Might contain unresolved aliases.
     */
    path: string;

    /**
     * ID of the snapshot
     */
    id: string | number;

    /**
     * Values being saved
     */
    values: Partial<SnapshotValues<M>>;

    /**
     * Previous values
     */
    previousValues?: Partial<SnapshotValues<M>>;

    /**
     * New or existing snapshot
     */
    status: SnapshotStatus;

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER>;
}

/**
 * Parameters passed to hooks when a snapshot is deleted
 * @group Models
 */
export interface BeforeDeleteProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * collection of the snapshot being deleted
     */
    collection: SnapshotCollection<M>;

    /**
     * Path of the parent collection
     */
    path: string;

    /**
     * Deleted snapshot id
     */
    id: string | number;

    /**
     * Deleted row (flat — `{ id, ...columns }`)
     */
    row: Record<string, unknown>;

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER>;
}

/**
 * Parameters passed to hooks after a snapshot is deleted
 * @group Models
 */
export interface AfterDeleteProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * collection of the snapshot being deleted
     */
    collection: SnapshotCollection<M>;

    /**
     * Path of the parent collection
     */
    path: string;

    /**
     * Deleted snapshot id
     */
    id: string | number;

    /**
     * Deleted row (flat — `{ id, ...columns }`)
     */
    row: Record<string, unknown>;

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER>;
}
