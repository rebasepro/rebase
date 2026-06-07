import { ReactNode } from "react";
import type { EntityCollection } from "../types/collections";
import type { EntityCollectionsBuilder } from "../types/builders";
import type { EntityCustomView } from "../types/entity_views";
import type { EntityAction } from "../types/entity_actions";
import type { AppView, NavigationGroupMapping } from "./navigation";
import type { RebasePlugin } from "../types/plugins";

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

export interface RebaseCMSConfig<EC extends EntityCollection = EntityCollection> {
    collections?: EC[] | EntityCollectionsBuilder<EC>;
    homePage?: ReactNode;
    entityViews?: EntityCustomView[];
    entityActions?: EntityAction[];
    plugins?: RebasePlugin[];

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
}

export interface RebaseStudioConfig {
    tools?: ("sql" | "js" | "rls" | "schema" | "storage" | "cron" | "schema-visualizer" | "branches" | "api" | "logs")[];
    homePage?: ReactNode;
    devViews?: AppView[];
}

export interface RebaseAuthConfig {
    loginView?: ReactNode;
}

export interface RebaseRegistryController {
    // Current state
    cmsConfig: RebaseCMSConfig | null;
    studioConfig: RebaseStudioConfig | null;
    authConfig: RebaseAuthConfig | null;

    // Registration functions
    registerCMS: (config: RebaseCMSConfig) => void;
    unregisterCMS: () => void;

    registerStudio: (config: RebaseStudioConfig) => void;
    unregisterStudio: () => void;

    registerAuth: (config: RebaseAuthConfig) => void;
    unregisterAuth: () => void;
}
