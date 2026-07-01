import type { EntityCollection } from "./collections";
import type { Entity, EntityStatus, EntityValues } from "./entities";
import type { User } from "../users";
import type { RebaseCallContext } from "../rebase_context";

/**
 * Lifecycle callbacks for entity CRUD operations.
 *
 * Register per-collection on the collection's `callbacks` field, or globally
 * via `initBackend({ callbacks })`. Fires on **every** data path — REST API,
 * WebSocket / realtime subscriptions, and server-side `rebase.data`.
 *
 * When both global and per-collection callbacks are registered, execution
 * order is: **global → collection → property callbacks**.
 *
 * @group Models
 */
export type EntityCallbacks<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> = {

    /**
     * Callback used after fetching data.
     *
     * Fires on every read path. Use this for security-critical redaction
     * (PII masking, row filtering) — no read path bypasses it.
     *
     * @param props
     */
    afterRead?(props: EntityAfterReadProps<M, USER>)
        : Promise<Entity<M>> | Entity<M>;


    /**
     * Callback used before saving, you need to return the values that will get
     * saved. If you throw an error in this method the process stops, and an
     * error snackbar gets displayed.
     * This runs after schema validation.
     *
     * @param props
     */
    beforeSave?(props: EntityBeforeSaveProps<M, USER>)
        : Promise<Partial<EntityValues<M>>> | Partial<EntityValues<M>>;

    /**
     * Callback used when save is successful.
     *
     * @param props
     */
    afterSave?(props: EntityAfterSaveProps<M, USER>)
        : Promise<void> | void;

    /**
     * Callback used when saving fails
     * @param props
     */
    afterSaveError?(props: EntityAfterSaveErrorProps<M, USER>)
        : Promise<void> | void;

    /**
     * Callback used before the entity is deleted.
     * If you throw an error in this method the process stops, and an
     * error snackbar gets displayed.
     *
     * @param props
     */
    beforeDelete?(props: EntityBeforeDeleteProps<M, USER>): Promise<boolean | void> | boolean | void;

    /**
     * Callback used after the entity is deleted.
     *
     * @param props
     */
    afterDelete?(props: EntityAfterDeleteProps<M, USER>): Promise<void> | void;

}

/**
 * Parameters passed to hooks when an entity is fetched
 * @group Models
 */
export interface EntityAfterReadProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * Collection of the entity
     */
    collection: EntityCollection<M>;

    /**
     * Full path of the CMS where this collection is being fetched.
     * Might contain unresolved aliases.
     */
    path: string;

    /**
     * Fetched entity
     */
    entity: Entity<M>

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER>;
}

/**
 * Parameters passed to hooks before an entity is saved
 * @group Models
 */
export type EntityBeforeSaveProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<EntityAfterSaveProps<M, USER>, "entityId">
    & {
        entityId?: string | number;
    }
/**
 * Parameters passed to hooks before an entity is saved
 * @group Models
 */
export type EntityAfterSaveErrorProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<EntityAfterSaveProps<M, USER>, "entityId">
    & {
        entityId?: string | number;
    }

/**
 * Parameters passed to hooks when an entity is saved
 * @group Models
 */
export interface EntityAfterSaveProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * Resolved collection of the entity
     */
    collection: EntityCollection<M>;

    /**
     * Full path of the CMS where this entity is being saved.
     * Might contain unresolved aliases.
     */
    path: string;

    /**
     * ID of the entity
     */
    entityId: string | number;

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
 * Parameters passed to hooks when an entity is deleted
 * @group Models
 */
export interface EntityBeforeDeleteProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * collection of the entity being deleted
     */
    collection: EntityCollection<M>;

    /**
     * Path of the parent collection
     */
    path: string;

    /**
     * Deleted entity id
     */
    entityId: string | number;

    /**
     * Deleted entity
     */
    entity: Entity<M>;

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER>;
}

/**
 * Parameters passed to hooks after an entity is deleted
 * @group Models
 */
export interface EntityAfterDeleteProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {

    /**
     * collection of the entity being deleted
     */
    collection: EntityCollection<M>;

    /**
     * Path of the parent collection
     */
    path: string;

    /**
     * Deleted entity id
     */
    entityId: string | number;

    /**
     * Deleted entity
     */
    entity: Entity<M>;

    /**
     * Context of the app status
     */
    context: RebaseCallContext<USER>;
}
