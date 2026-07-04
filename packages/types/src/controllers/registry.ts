import { ReactNode } from "react";
import type { CollectionConfig } from "../types/collections";
import type { CollectionConfigsBuilder, AppViewsBuilder } from "../types/builders";
import type { SnapshotCustomView } from "../types/snapshot_views";
import type { SnapshotAction } from "../types/snapshot_actions";
import type { AppView, NavigationGroupMapping } from "./navigation";

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

export interface RebaseCMSConfig<EC extends CollectionConfig = CollectionConfig> {
    collections?: EC[] | CollectionConfigsBuilder<EC>;

    /**
     * Custom top-level views added to the main navigation.
     * Accepts a static array of views or an async builder function
     * that receives the current user/auth context for role-based views.
     */
    views?: AppView[] | AppViewsBuilder;

    homePage?: ReactNode;
    snapshotViews?: SnapshotCustomView[];
    snapshotActions?: SnapshotAction[];

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
    tools?: ("sql" | "js" | "rls" | "schema" | "storage" | "cron" | "schema-visualizer" | "branches" | "api" | "logs" | "api-keys")[];
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
