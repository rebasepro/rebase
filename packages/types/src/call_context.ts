import type { StorageSource } from "./controllers/storage";
import type { RebaseClient } from "./controllers/client";
import type { RebaseSdkData } from "./controllers/data";
import type { User } from "./users";

/**
 * Context that is provided to entity callbacks (hooks).
 * It contains only the dependencies that are available in both the frontend and the backend.
 *
 * This is the *whole* context a collection callback gets, and it lives apart from
 * {@link RebaseContext} on purpose. `RebaseContext` widens it with nine admin-panel
 * controllers — navigation, side dialogs, snackbars — none of which exist in a
 * backend process. Keeping them in one type meant every backend module that
 * touched a callback signature transitively named the admin UI.
 *
 * @group Hooks and utilities
 */
export type RebaseCallContext<USER extends User = User> = {

    /**
     * The Rebase client instance.
     * Available in all entity callbacks (beforeSave, afterSave, afterRead,
     * beforeDelete, afterDelete) and in CollectionActionsProps via context.
     * Use it to call backend functions, access data, storage, etc.
     *
     * @example
     * // In a beforeSave callback:
     * const result = await context.client.functions.invoke('my-function', { ... });
     *
     * @example
     * // In a CollectionAction component:
     * const { client } = props.context;
     * const result = await client.functions.invoke('extract-job', { url });
     */
    client: RebaseClient;

    /**
     * Unified data access — `context.data.products.create(...)`.
     * Access any collection as a dynamic property.
     *
     * Returns flat rows (`{ id, ...columns }`), identical to the frontend SDK
     * client — so `context.data` in a backend callback and `client.data` in the
     * frontend behave the same way (`row.title`, never `row.values.title`).
     */
    data: RebaseSdkData;

    /**
     * Used storage implementation
     */
    storageSource: StorageSource;

    /**
     * Set by the backend when callbacks are executed on the server.
     */
    user?: USER;
}
