import type { DataDriver } from "./controllers/data_driver";
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
     * Use it to call backend functions, access storage, send email, etc.
     *
     * ⚠️ **Not the same trust level as {@link data}.** Server-side this is the
     * app singleton, so `client.dataAsAdmin` is **always** the admin-scoped
     * plane — scoped as `{ uid: "service", roles: ["admin"] }`, so policies are
     * evaluated against that identity rather than skipped — while {@link data},
     * one property over, follows whoever triggered the callback. On a user
     * request, reaching for `context.client.dataAsAdmin` silently escalates a
     * user-scoped operation to admin. For queries in a callback use
     * {@link data}; come here for functions, storage and email.
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
     * **Inherits the privilege of whatever triggered the callback.** This is not
     * a fixed trust level, and it is the one thing to know about this accessor:
     *
     * - Triggered by a **user request** (REST, realtime, an admin-panel edit):
     *   user-scoped. The callback runs on the RLS-bound transaction opened for
     *   that request, so policies apply to reads *and* writes — a callback
     *   cannot see a row its caller could not.
     * - Triggered by **`rebase.dataAsAdmin` or a cron** (the same singleton):
     *   admin-scoped, not unscoped. That driver is scoped as
     *   `{ uid: "service", roles: ["admin"] }`, so the callback still runs on an
     *   RLS-bound transaction — policies are evaluated against that identity.
     * - Triggered by **the base driver** (auth flows, migrations): unscoped, on
     *   the owner connection, bypassing RLS.
     *
     * So a callback that reads a sibling row will find it when an admin task
     * saves and may find nothing when an end user saves — without an error,
     * because RLS filters rather than raises. Write callbacks that tolerate
     * that, or reach for {@link client}`.dataAsAdmin` deliberately when the
     * callback genuinely has to see what an admin may see. Note what that does
     * *not* buy you: `policy.serverContext()` (`rebase.uid() IS NULL`) is false
     * for the service identity, so a collection whose only rule is
     * `serverContext()` stays closed to it.
     *
     * Verified end-to-end against Postgres rather than asserted — see
     * `"scopes context.data to the caller when a callback runs on a user
     * request"` in `server-postgres`' `rls-enforcement` e2e suite. The
     * documentation previously claimed the opposite (that callbacks always have
     * full access), which is the unsafe direction to be wrong in.
     *
     * Returns flat rows (`{ id, ...columns }`), identical in *shape* to the
     * frontend SDK client — so `context.data` in a backend callback and
     * `client.data` in the frontend are accessed the same way (`row.title`,
     * never `row.values.title`). Shape only: privilege differs as above.
     */
    data: RebaseSdkData;

    /**
     * The driver executing the operation this callback is attached to.
     *
     * Present server-side only. Declared here because it is already public in
     * practice — the backend has always passed it, and the callbacks guide
     * documented `context.driver.withAuth(user)` in all six locales. The
     * contract simply did not name it, so `buildCallContext` was cast through
     * `as unknown as RebaseCallContext` and nothing about the object was
     * type-checked at all.
     *
     * The guide no longer recommends `withAuth` — {@link data} is already
     * user-scoped on a user request, so the manual re-scoping it described was
     * answering a problem that did not exist. The field stays declared rather
     * than removed: it is on the runtime object, dropping it would break anyone
     * who found it, and a named optional is better than a silent extra.
     *
     * `withAuth` is not on {@link DataDriver} because not every engine supports
     * RLS scoping; it is narrowed here, and left optional so a driver without it
     * is a compile-time absence rather than a runtime surprise.
     */
    driver?: DataDriver & {
        withAuth?(user: { uid: string; roles?: string[] }): Promise<DataDriver>;
    };

    /**
     * Used storage implementation
     */
    storageSource: StorageSource;

    /**
     * Set by the backend when callbacks are executed on the server.
     */
    user?: USER;
}
