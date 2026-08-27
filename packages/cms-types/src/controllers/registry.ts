import { ReactNode } from "react";

import type { CollectionConfigsBuilder, AppViewsBuilder } from "../types/builders";
import type { EntityCustomView } from "../types/entity_views";
import type { CollectionCustomView } from "../types/collection_views";
import type { EntityAction } from "../types/entity_actions";
import type { AppView, NavigationGroupMapping } from "./navigation";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Options to enable the built-in collection editor.
 * When provided to `<RebaseCMS>`, the editor is auto-wired as a native feature.
 */
export interface CollectionEditorOptions {
    /**
     * Function that returns an auth token for schema-editor API calls.
     * Falls back to `authController.getAuthToken` when omitted.
     */
    getAuthToken?: () => Promise<string | null>;
    /** Mark the editor as read-only (disable mutations). */
    readOnly?: boolean;
    /** Suggested base paths shown when creating new collections. */
    pathSuggestions?: string[];
}

export interface RebaseCMSConfig<EC extends AdminCollection = AdminCollection> {
    collections?: EC[] | CollectionConfigsBuilder<EC>;

    /**
     * Custom top-level views added to the main navigation.
     * Accepts a static array of views or an async builder function
     * that receives the current user/auth context for role-based views.
     */
    views?: AppView[] | AppViewsBuilder;

    homePage?: ReactNode;
    entityViews?: EntityCustomView[];

    /**
     * Custom collection view modes available to every collection by `key`.
     * A collection opts into one by naming that key in `admin.customViews`,
     * the same way `entityViews` works.
     */
    collectionViews?: CollectionCustomView[];

    entityActions?: EntityAction[];

    /**
     * Centralized configuration for how collections and views are grouped
     * in the navigation sidebar and home page.
     * Each mapping defines a named group and the collection/view slugs
     * that belong to it. The array order determines group display order.
     * Entry order within each group determines card order.
     */
    navigationGroupMappings?: NavigationGroupMapping[];

    /**
     * Enable the built-in visual collection/schema editor.
     * Pass `true` for zero-config, or an options object for fine-grained control.
     * When enabled, the editor slots, provider, and Studio schema view
     * are all auto-wired — no plugin or manual view injection needed.
     */
    collectionEditor?: boolean | CollectionEditorOptions;

    /**
     * URL path prefix the admin is mounted under, when it does not live at the
     * site root. Set this when the admin is rendered inside a path-prefixed
     * route (e.g. `<Route path="/admin/*">`) so URL⇄collection resolution
     * accounts for the prefix — otherwise the current path won't be recognized
     * as a collection path and views hang on a spinner with no data fetch.
     *
     * Do NOT set this when mounting via a react-router `basename` — react-router
     * already strips the prefix from the location, so the default (`/`) is correct.
     *
     * @default "/"
     */
    basePath?: string;
}

export interface RebaseStudioConfig {
    tools?: ("sql" | "js" | "rls" | "schema" | "storage" | "cron" | "schema-visualizer" | "branches" | "backups" | "api" | "logs" | "api-keys")[];
    homePage?: ReactNode;
    devViews?: AppView[];
}

/**
 * Props of the `<RebaseAuth>` front-end route — what the sign-in screen renders.
 *
 * Named `RebaseAuthConfig` until it collided head-on with `RebaseAuthConfig` in
 * `@rebasepro/server`, which is the *backend* auth configuration: JWT secrets,
 * OAuth providers, password hooks, the users collection. Two unrelated shapes
 * under one name, one of them exported from a package whose whole job is to be
 * imported alongside the other.
 */
export interface RebaseAuthViewConfig {
    loginView?: ReactNode;
}

export interface RebaseRegistryController {
    // Current state
    cmsConfig: RebaseCMSConfig | null;
    studioConfig: RebaseStudioConfig | null;
    authConfig: RebaseAuthViewConfig | null;

    // Registration functions
    registerAdmin: (config: RebaseCMSConfig) => void;
    unregisterAdmin: () => void;

    registerStudio: (config: RebaseStudioConfig) => void;
    unregisterStudio: () => void;

    registerAuth: (config: RebaseAuthViewConfig) => void;
    unregisterAuth: () => void;
}
