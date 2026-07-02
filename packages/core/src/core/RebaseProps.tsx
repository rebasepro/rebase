import React from "react";
import { Locale, User, AuthController, AnalyticsEvent, DataDriver, DataSourceDefinition, StorageSource, StorageSourceDefinition, UserConfigurationPersistence, CollectionRegistryController, DatabaseAdmin, UrlController, NavigationStateController, RebaseData, RebaseClient, RebaseContext, EntityLinkBuilder, RebasePlugin, SlotContribution, PropertyConfig, EntityCustomView, EntityAction, RebaseTranslations, ComponentOverrideMap } from "@rebasepro/types";

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
export interface EffectiveRoleController {
    effectiveRole: string | null;
    setEffectiveRole: (role: string | null) => void;
}


/**
 * Props for the main {@link Rebase} component.
 *
 * ## Resolution & Precedence
 *
 * Several prop families overlap intentionally. The rules below describe
 * which value wins when more than one is supplied.
 *
 * ### Data (default source)
 *
 * First match wins:
 * 1. `data` prop (used as-is)
 * 2. `driver` prop (wrapped via `buildRebaseData`)
 * 3. `client.data`
 * 4. `dataSources` entry keyed `DEFAULT_DATA_SOURCE_KEY` (`"(default)"`),
 *    else the **first** registered source (`Object.values(...)[0]` —
 *    ⚠️ object-order-dependent; prefer an explicit `"(default)"` key).
 * 5. **Throw** — at least one data source is required.
 *
 * Named `dataSources` entries with a `driver` are additionally registered
 * as routed non-default sources, independent of the default resolution.
 *
 * ### Auth
 *
 * - `authController` prop → completely disables the `client.auth`
 *   subscription (not a merge). The recommended pattern is to pass both
 *   `client` and an `authController` built from that client via
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
 * | Fully headless / custom | `data` or `driver` + `storageSource` |
 *
 * @group Models
 */
export type RebaseProps<USER extends User> = {

    /**
     * The root components of your application. Use RebaseCMS, RebaseStudio, and RebaseShell.
     * Alternatively, pass a render function that receives { context, loading }.
     */
    children: React.ReactNode | ((props: { context: RebaseContext; loading: boolean }) => React.ReactNode);

    /**
     * Optional base path for the entire Rebase app.
     * Defaults to "/"
     */
    basePath?: string;

    /**
     * Optional base path for the CMS collections.
     * Defaults to "/c"
     */
    baseCollectionPath?: string;

    /**
     * Base URL for the backend API (e.g. "http://localhost:3001").
     * When provided, this is available via `useApiConfig()` to any hook
     * in the tree, reducing repetitive `apiUrl` threading.
     */
    apiUrl?: string;


    /**
     * Format of the dates in the CMS.
     * Defaults to 'MMMM dd, yyyy, HH:mm:ss'
     */
    dateTimeFormat?: string;

    /**
     * Locale of the CMS, currently only affecting dates
     */
    locale?: Locale;

    /**
     * Unified RebaseClient for data, auth, and storage.
     *
     * `client.data` is used as the default data source unless overridden by
     * `data`, `driver`, or a `dataSources` entry keyed `"(default)"`.
     * `client.auth` is subscribed unless `authController` is provided.
     * `client.storage` is used unless `storageSource` is provided.
     */
    client?: RebaseClient;

    /**
     * Explicit default data source. Takes the **highest** priority in the
     * data resolution ladder — when set, `driver`, `client.data`, and
     * `dataSources` defaults are all ignored for the default source.
     */
    data?: RebaseData;

    /**
     * Convenience prop — the driver is wrapped via `buildRebaseData`
     * internally and used as the default data source.
     *
     * **Ignored** when {@link data} is provided. Overrides `client.data`
     * as the default data source. Collections routed to a named
     * {@link dataSources} entry are unaffected.
     */
    driver?: DataDriver;

    /**
     * Additional data sources beyond the default `client`/`driver`/`data`.
     *
     * Register the **direct** (e.g. Firestore, talking straight to its backend)
     * and **custom** sources here. Server-mediated sources (Postgres, MongoDB,
     * …) do *not* need an entry — they ride the `client` and are routed by the
     * Rebase backend.
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
     *         { key: "analytics", engine: "firestore", transport: "direct", driver: firestoreDriver }
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
     * Callback used to get analytics events from the CMS
     */
    onAnalyticsEvent?: (event: AnalyticsEvent, data?: object) => void;

    /**
     * Optional link builder you can add to generate a button in your entity forms.
     * The function must return a URL that gets opened when the button is clicked
     */
    entityLinkBuilder?: EntityLinkBuilder;


    /**
     * Plugins loaded in the CMS
     */
    plugins?: RebasePlugin[];

    /**
     * Extra slots for the CMS
     */
    slots?: SlotContribution[];

    /**
     * Property configs (widgets)
     */
    propertyConfigs?: Record<string, PropertyConfig>;

    /**
     * Entity Views
     */
    entityViews?: EntityCustomView[];

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
     *         "Entity.FormActions": {
     *             Component: MyFormActions,
     *             wrap: true
     *         }
     *     }}
     * >
     * ```
     */
    components?: ComponentOverrideMap;

};

