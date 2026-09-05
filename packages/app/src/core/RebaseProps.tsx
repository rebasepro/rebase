import React from "react";
import { User, DataDriver, DataSourceDefinition, StorageSource, StorageSourceDefinition, CollectionRegistryController, DatabaseAdmin, RebaseClient } from "@rebasepro/types";
import { Locale, AuthController, AnalyticsEvent, UserConfigurationPersistence, UrlController, NavigationStateController, RebaseContext, EntityLinkBuilder, RebasePlugin, AnySlotContribution, PropertyConfig, EntityCustomView, CollectionCustomView, EntityAction, RebaseTranslations, ComponentOverrideMap } from "@rebasepro/cms-types";

/**
 * A data source registered on `<Rebase>`. Extends the shared
 * {@link DataSourceDefinition} with the frontend {@link DataDriver} used for
 * `direct`/`custom` transports. Server-mediated sources omit `driver` — they
 * are reached through the `client`.
 *
 * @group Models
 */
export type RebaseDataSource = DataSourceDefinition & {
    /**
     * The client-side driver for this source. Required for `direct`/`custom`
     * transports; omit for `server` transport (handled by the `client`).
     *
     * When `transport` is not stated it is inferred from this field:
     * driver present → `"direct"`, absent → `"server"`.
     */
    driver?: DataDriver;
};

/**
 * A storage source registered on `<Rebase>`. Extends the shared
 * {@link StorageSourceDefinition} with an optional frontend
 * {@link StorageSource} for `direct` transports. Server-mediated sources
 * omit `source` — they are reached through the `client`.
 *
 * @group Models
 */
export type RebaseStorageSource = StorageSourceDefinition & {
    /**
     * The client-side StorageSource for this backend. Required for `direct`
     * transport (e.g. Firebase Storage via `@firebase/storage`); omit for
     * `server` transport (proxied by the Rebase backend).
     */
    source?: StorageSource;
};

/** DeepPartial helper — allows partial overrides at any nesting level */
type DeepPartial<T> = T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * Controller to simulate different roles when dev mode is active.
 * @group Models
 */
export type { EffectiveRoleController } from "@rebasepro/types";
import type { EffectiveRoleController } from "@rebasepro/types";


/**
 * Props for the main {@link Rebase} component.
 *
 * ## Data
 *
 * Everything is a data source, and there is one list: {@link dataSources}.
 * The **default** source (serving every collection without a `dataSource`
 * key) resolves with three rules:
 *
 * 1. A `dataSources` entry keyed `"(default)"` (`DEFAULT_DATA_SOURCE_KEY`)
 *    *with a driver* is the default source.
 * 2. Otherwise `client.data` is the default.
 * 3. Otherwise, if exactly one source is registered, it is the default.
 *    Zero sources, or several without a `"(default)"` key, **throw**.
 *
 * A `"(default)"` entry *without* a driver never provides data — it only
 * declares the default source's `engine`/`label` (capabilities) when the
 * client is the default.
 *
 * All other `dataSources` entries are routed non-default sources:
 * collections opt in via `collection.dataSource`.
 *
 * ### Auth
 *
 * - `authController` prop → completely disables the `client.auth`
 *   subscription (an override, not a merge). The recommended pattern is to
 *   pass both `client` and an `authController` built from that client via
 *   `useRebaseAuthController({ client })`.
 * - Otherwise, `client.auth` is subscribed to via `useAuthSubscription`.
 *
 * ### Storage (default source)
 *
 * Default: `storageSource` prop ?? `client.storage`.
 *
 * Named sources are merged in priority order (later entries with the same
 * key overwrite earlier ones):
 * 1. Backend-discovered remote definitions (`client.fetchStorageSources()`,
 *    fetched after auth/login-skip).
 * 2. Client `storageRegistry` entries.
 * 3. `storageSources` prop entries (live `direct` instances; `server`-
 *    transport keys are materialized via `client.createStorageSource`).
 * 4. Default storage (keyed `DEFAULT_STORAGE_SOURCE_KEY`) as fallback.
 *
 * ## Decision Ladder
 *
 * | Scenario | Props to use |
 * |---|---|
 * | Standard app | `client` (+ `authController` built from it) |
 * | Multi-backend data | add `dataSources` |
 * | Multi-backend storage | add `storageSources` |
 * | Fully headless / custom | `dataSources` with a `"(default)"`-keyed driver entry + `storageSource` |
 *
 * @group Models
 */
export type RebaseProps<USER extends User, DB = unknown> = {

    /**
     * The root components of your application. Use RebaseCMS, RebaseStudio, and RebaseShell.
     * Alternatively, pass a render function that receives { context, loading }.
     */
    children: React.ReactNode | ((props: { context: RebaseContext; loading: boolean }) => React.ReactNode);

    /**
     * Base URL for the backend API (e.g. "http://localhost:3001").
     * When provided, this is available via `useApiConfig()` to any hook
     * in the tree, reducing repetitive `apiUrl` threading.
     */
    apiUrl?: string;


    /**
     * Format of the dates in the admin.
     * Defaults to 'MMMM dd, yyyy, HH:mm:ss'
     */
    dateTimeFormat?: string;

    /**
     * Locale of the admin, currently only affecting dates
     */
    locale?: Locale;

    /**
     * Unified RebaseClient for data, auth, and storage.
     *
     * `client.data` is the default data source unless a {@link dataSources}
     * entry keyed `"(default)"` carries a driver.
     * `client.auth` is subscribed unless `authController` is provided.
     * `client.storage` is used unless `storageSource` is provided.
     *
     * `DB` is inferred from whatever is passed, and defaults to `unknown` for
     * an untyped client. It has to be a parameter rather than a fixed
     * `RebaseClient`: `RebaseClient<unknown>` is not a supertype of
     * `RebaseClient<Database>` — the dynamic branch of `RebaseSdkData` is an
     * index signature that no concrete instantiation satisfies — so pinning it
     * here rejected the client of every project that generates a `Database`
     * type, which is the whole typed-SDK path.
     */
    client?: RebaseClient<DB>;

    /**
     * The data sources of the app. Each entry pairs a
     * {@link DataSourceDefinition} (key, engine, transport) with an optional
     * client-side {@link DataDriver}.
     *
     * Register the **direct** (e.g. Firestore, talking straight to its backend)
     * and **custom** sources here. Server-mediated sources (Postgres, MongoDB,
     * …) do *not* need an entry — they ride the `client` and are routed by the
     * Rebase backend.
     *
     * An entry keyed `"(default)"` with a driver **replaces** `client.data`
     * as the default data source (this is how a fully client-side app, e.g.
     * Firestore-only, is wired). Without a driver, a `"(default)"` entry just
     * declares the default source's engine/capabilities.
     *
     * Collections are routed automatically by their `dataSource` key (resolved
     * by collection path against the registry), so routing works transparently
     * for list/entity views, references, the board view, import/export, and
     * programmatic `context.data` access — no per-collection wiring.
     *
     * @example
     * ```tsx
     * // Postgres via the Rebase client (default) + a direct Firestore source.
     * <Rebase
     *     client={rebaseClient}
     *     dataSources={[
     *         { key: "analytics", engine: "firestore", driver: firestoreDriver }
     *     ]}
     * >
     * // Collections opt in with `{ ..., dataSource: "analytics" }`.
     * ```
     */
    dataSources?: RebaseDataSource[];

    /**
     * Custom auth controller. When provided, the `client.auth` subscription
     * is **completely disabled** (not merged).
     *
     * The recommended pattern is to pass both `client` and an
     * `authController` built from that client:
     * ```tsx
     * const authController = useRebaseAuthController({ client });
     * <Rebase client={client} authController={authController} />
     * ```
     * This lets the `authController` own the auth lifecycle while `client`
     * still provides data and storage.
     */
    authController?: AuthController<USER>;

    /**
     * Default storage source. Overrides `client.storage` when provided.
     * Named sources in {@link storageSources} are unaffected.
     */
    storageSource?: StorageSource;

    /**
     * Additional storage sources beyond the default `client.storage`.
     *
     * Register **direct** (e.g. Firebase Storage, talking straight to the
     * cloud) sources here. Server-mediated sources (S3, GCS proxied by the
     * Rebase backend) do *not* need an entry — they are routed by
     * `storageId` query parameter on the REST API.
     *
     * Collection properties opt in via `storage.storageSource: "key"`.
     *
     * @example
     * ```tsx
     * <Rebase
     *     client={rebaseClient}
     *     storageSources={[
     *         { key: "firebase", engine: "firebase", transport: "direct", source: firebaseStorageSource }
     *     ]}
     * >
     * ```
     */
    storageSources?: RebaseStorageSource[];

    /**
     * Administrative database operations (SQL, schema discovery).
     * Only needed when the studio/admin features are enabled.
     */
    databaseAdmin?: DatabaseAdmin;

    /**
     * Use this controller to access the configuration that is stored locally,
     * and not defined in code
     */
    userConfigPersistence?: UserConfigurationPersistence;

    /**
     * Callback used to get analytics events from the admin
     */
    onAnalyticsEvent?: (event: AnalyticsEvent, data?: object) => void;

    /**
     * Optional link builder you can add to generate a button in your entity forms.
     * The function must return a URL that gets opened when the button is clicked
     */
    entityLinkBuilder?: EntityLinkBuilder;


    /**
     * Plugins loaded in the admin
     */
    plugins?: RebasePlugin[];

    /**
     * Extra slots for the admin
     */
    slots?: AnySlotContribution[];

    /**
     * Property configs (widgets)
     */
    propertyConfigs?: Record<string, PropertyConfig>;

    /**
     * Entity Views
     */
    entityViews?: EntityCustomView[];

    /**
     * Custom collection view modes, available to every collection by `key`.
     * A collection opts into one by naming that key in `admin.customViews`.
     */
    collectionViews?: CollectionCustomView[];

    /**
     * Entity Actions
     */
    entityActions?: EntityAction[];

    /**
     * Controller to simulate different roles when dev mode is active.
     */
    effectiveRoleController?: EffectiveRoleController;

    /**
     * Override or extend any Rebase UI string, keyed by locale.
     */
    translations?: {
        [locale: string]: DeepPartial<RebaseTranslations>;
    };

    /**
     * Override built-in UI components with custom implementations.
     *
     * Keys are component names from {@link OverridableComponentName}.
     * Values specify the replacement component and an optional `wrap`
     * flag for the wrapping pattern.
     *
     * @example
     * ```tsx
     * <Rebase
     *     client={client}
     *     components={{
     *         "Shell.AppBar": { Component: MyCustomAppBar },
     *         "EditView.FormActions": {
     *             Component: MyFormActions,
     *             wrap: true
     *         }
     *     }}
     * >
     * ```
     */
    components?: ComponentOverrideMap;

};

