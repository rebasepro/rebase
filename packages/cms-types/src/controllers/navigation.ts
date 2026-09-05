import React from "react";
import type { EntityReference } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Controller that handles URL path building and resolution.
 * @group Models
 */
export type UrlController = {
    /**
     * Default path under the navigation routes of the admin will be created.
     * Defaults to '/'. You may want to change this `basepath` to 'admin' for example.
     */
    basePath: string;

    /**
     * Default path under the collection routes of the admin will be created.
     * It defaults to '/c'
     */
    baseCollectionPath: string;

    /**
     * Convert a URL path to a collection or entity path
     * `/c/products` => `products`
     * `/my_cms/c/products/B34SAP8Z` => `products/B34SAP8Z`
     * `/my_cms/my_view` => `my_view`
     * @param cmsPath
     */
    urlPathToDataPath: (cmsPath: string) => string;

    /**
     * Base url path for the home screen
     */
    homeUrl: string;

    /**
     * Check if a url path belongs to a collection
     * @param path
     */
    isUrlCollectionPath: (urlPath: string) => boolean;

    /**
     * Build a URL collection path from a data path
     * `products` => `/c/products`
     * `products/B34SAP8Z` => `/c/products/B34SAP8Z`
     * @param path
     */
    buildUrlCollectionPath: (path: string) => string;

    /**
     * Build a URL path for the admin (e.g. for custom views)
     * @param path
     */
    buildAppUrlPath: (path: string) => string;

    /**
     * Turn a path with collection ids into a resolved path.
     * The ids (typically used in urls) will be replaced with relative paths (typically used in database paths)
     * @param path
     */
    resolveDatabasePathsFrom: (path: string) => string;

    /**
     * A function to navigate to a specified route or URL.
     *
     * @param {string} to - The target route or URL to navigate to.
     * @param {NavigateOptions} [options] - Optional configuration settings for navigation, such as replace behavior or state data.
     */
    navigate: (to: string, options?: NavigateOptions) => void;
};

/**
 * Controller that manages the state of the navigation menu,
 * including resolved views and top-level grouping.
 * @group Models
 */
export type NavigationStateController = {
    /**
     * Custom additional views created by the developer, added to the main
     * navigation
     */
    views?: AppView[];

    /**
     * Custom additional views created by the developer, added to the admin
     * navigation
     */
    adminViews?: AppView[];

    /**
     * Configuration for the views that should be displayed at the top
     * level of the navigation (e.g. in the home page or the navigation
     * drawer)
     */
    topLevelNavigation?: NavigationResult;

    /**
     * Is the navigation loading (the configuration persistence has not
     * loaded yet, or a specified navigation builder has not completed)
     */
    loading: boolean;

    /**
     * Was there an error while loading the navigation data
     */
    navigationLoadingError?: Error;

    /**
     * Call this method to recalculate the navigation
     */
    refreshNavigation: () => void;
};

export interface NavigateOptions {
    replace?: boolean;
    state?: unknown;
    preventScrollReset?: boolean;
    relative?: "route" | "path";
    flushSync?: boolean;
    viewTransition?: boolean;
}

/**
 * Custom additional views created by the developer, added to the main
 * navigation.
 * @group Models
 */
export interface AppView {

    /**
     * admin Path you can reach this view from.
     */
    slug: string;

    /**
     * Name of this view
     */
    name: string;

    /**
     * Optional description of this view. You can use Markdown
     */
    description?: string;

    /**
     * Icon key to use in this view.
     * You can use any of the icons in the Lucide specs:
     * https://lucide.dev/icons/
     * e.g. 'ShoppingCart' or 'User'
     */
    icon?: string | React.ReactNode;

    /**
     * Should this view be hidden from the main navigation panel.
     * It will still be accessible if you reach the specified path
     */
    hideFromNavigation?: boolean;

    /**
     * Navigation group for this view.
     * Views sharing the same group name will be visually grouped
     * together in the drawer and home page. If not set, the view
     * falls into the default "Views" group.
     *
     * Two names are special: a group called `"Admin"` or `"Settings"` sinks to
     * the bottom of the drawer, by string comparison on the name. That predates
     * {@link pinToBottom} and still works, but rename the group — translate the
     * label, say — and the ordering silently stops happening. Use
     * `pinToBottom` for anything that is not literally one of those two words.
     */
    group?: string;

    /**
     * Sink this view's group to the bottom of the drawer, below the ordinary
     * groups.
     *
     * What `group: "Settings"` has always done, said out loud. Setting it on
     * any one view in a group pins the whole group, since the drawer orders
     * groups and not individual views.
     */
    pinToBottom?: boolean;

    /**
     * Component to be rendered. This can be any React component, and can use
     * any of the provided hooks.
     *
     * Pass a `ComponentType` to enable lazy rendering — the component will
     * only be instantiated when the route is visited. This is recommended
     * for dynamic views generated from database data.
     */
    view: React.ReactNode | React.ComponentType;

    /**
     * If true, a wildcard route (slug/*) is automatically registered
     * alongside the base route, enabling nested navigation within this view.
     */
    nestedRoutes?: boolean;

    /**
     * Restrict this view to users with at least one of the listed roles.
     * When omitted or empty, the view is visible to all authenticated users.
     * Applied during view resolution — the view is filtered out entirely
     * (not just hidden from nav) if the user lacks a matching role.
     */
    roles?: string[];

}

/**
 * A composable section that can be rendered on the home page.
 * Use this to add custom content alongside the auto-generated
 * navigation groups.
 * @group Models
 */
export interface HomePageSection {
    /**
     * Unique key for this section.
     */
    key: string;

    /**
     * Title displayed as the section header.
     */
    title: string;

    /**
     * Arbitrary React content rendered inside the section.
     */
    children: React.ReactNode;
}

/**
 * Used to group navigation entries in the main navigation.
 */
export interface NavigationGroupMapping {
    /**
     * Name of the group, used to display the group header in the UI
     */
    name: string;
    /**
     * List of collection ids or view paths that belong to this group.
     */
    entries: string[];
    /**
     * Icon for the group header, as a Lucide icon name (`"Users"`, `"CreditCard"`).
     *
     * It labels the group header and nothing more — the entries below keep their own
     * icons either way. Only shown while the drawer is expanded, since a drawer
     * collapsed to a rail hides the headers entirely.
     */
    icon?: string;
    /**
     * Configure which groups start collapsed.
     * Set to `true` to collapse in both drawer and home page,
     * or use an object to control each independently.
     *
     * @defaultValue false (expanded)
     */
    collapsedByDefault?: boolean | {
        drawer?: boolean;
        home?: boolean;
    };
}

export interface NavigationEntry {
    id: string;
    url: string;
    name: string;
    slug: string;
    type: "collection" | "view" | "admin";
    collection?: AdminCollection;
    view?: AppView;
    description?: string;
    group: string;
}

export type NavigationResult = {

    allowDragAndDrop: boolean;

    navigationEntries: NavigationEntry[],

    groups: string[],

    onNavigationEntriesUpdate: (entries: NavigationGroupMapping[]) => void;
};

