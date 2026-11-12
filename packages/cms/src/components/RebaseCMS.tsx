import React, { useLayoutEffect } from "react";
import { useRebaseEmbedHost, useRebaseRegistryDispatch } from "@rebasepro/app";
import type { RebaseCMSConfig } from "@rebasepro/cms-types";

/**
 * The admin panel's content: every table the backend serves the signed-in
 * user, with no configuration at all, plus what you add.
 *
 * Renders nothing — it registers its configuration with `<Rebase>`, and
 * `<RebaseShell>` draws the panel from it.
 *
 * - `tableCustomizations` — `customizeTable(...)` results: labels, icons, view
 *   modes, field components and actions for the served tables.
 * - `externalCollections` — collections whose rows live elsewhere
 *   (`defineFirestoreCollection`), side by side with the tables.
 * - `tables` — for embedding and tests only: the tables to render instead of
 *   the ones the server serves.
 *
 * When `collectionEditor` is provided, the built-in visual schema editor
 * is auto-wired as a native feature (slots, provider, Studio view) without
 * needing any external plugin.
 *
 * @example
 * ```tsx
 * <Rebase client={rebaseClient} dataSources={[firestoreSource]} authController={authController}>
 *     <RebaseAuth/>
 *     <RebaseCMS tableCustomizations={[postsCms]} externalCollections={[firestoreEvents]}/>
 *     <RebaseShell title="Acme Ops"/>
 * </Rebase>
 * ```
 */
export function RebaseCMS({
    tableCustomizations,
    externalCollections,
    tables,
    views,
    homePage,
    entityViews,
    collectionViews,
    entityActions,
    collectionEditor: collectionEditorProp,
    navigationGroupMappings,
    basePath
}: RebaseCMSConfig) {
    const dispatch = useRebaseRegistryDispatch();

    // In an embedding (an MCP App view, `embed_host.ts`) the schema editor,
    // which writes the project's files, is not offered. The collections are
    // narrowed there by the navigation, which composes them.
    const collectionEditor = useRebaseEmbedHost() ? undefined : collectionEditorProp;

    useLayoutEffect(() => {
        dispatch.registerAdmin({
            tableCustomizations,
            externalCollections,
            tables,
            views,
            homePage,
            entityViews,
            collectionViews,
            entityActions,
            collectionEditor,
            navigationGroupMappings,
            basePath
        });
        return () => dispatch.unregisterAdmin();
    }, [dispatch, tableCustomizations, externalCollections, tables, views, homePage, entityViews, collectionViews, entityActions, collectionEditor, navigationGroupMappings, basePath]);

    return null;
}
