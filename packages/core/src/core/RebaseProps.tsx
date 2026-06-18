import React from "react";
import { Locale, User, AuthController, AnalyticsEvent, DataDriver, StorageSource, UserConfigurationPersistence, CollectionRegistryController, DatabaseAdmin, UrlController, NavigationStateController, RebaseData, RebaseClient, RebaseContext, EntityLinkBuilder, RebasePlugin, SlotContribution, PropertyConfig, EntityCustomView, EntityAction, RebaseTranslations } from "@rebasepro/types";

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
     * Optional override for DataDriver if not using `client`
     */
    driver?: DataDriver;

    /**
     * Optional override for AuthController if not using `client`
     */
    authController?: AuthController<USER>;

    /**
     * Optional override for StorageSource if not using `client`
     */
    storageSource?: StorageSource;

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

    components?: {

        /**
         * Component to render when a reference is missing
         */
        missingReference?: React.ComponentType<{
            path: string,
        }>;

    };

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

};

