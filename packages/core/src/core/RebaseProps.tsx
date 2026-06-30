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
     * If you have a custom API key, you can use it here.
     */
    apiKey?: string;

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
     */
    client?: RebaseClient;

    /**
     * Optional override for RebaseData if not using `client`
     */
    data?: RebaseData;

    /**
     * Optional override for DataDriver if not using `client`.
     *
     * This sets the **default** data driver — it handles every collection
     * that does not match an entry in {@link drivers}.
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
     * Map of direct/custom data drivers, keyed by data-source key.
     *
     * @deprecated Use {@link dataSources} instead. This is a shorthand kept for
     * backward compatibility — each entry is treated as
     * `{ key, engine: key, transport: "direct", driver }`.
     *
     * @example
     * ```tsx
     * <Rebase client={rebaseClient} drivers={{ firestore: firestoreDriver }}>
     * ```
     */
    drivers?: Record<string, DataDriver>;

    /**
     * Optional override for AuthController if not using `client`
     */
    authController?: AuthController<USER>;

    /**
     * Optional override for StorageSource if not using `client`
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

