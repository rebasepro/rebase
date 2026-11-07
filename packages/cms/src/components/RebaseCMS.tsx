import React, { useLayoutEffect, useMemo } from "react";
import { useRebaseEmbedHost, useRebaseRegistryDispatch } from "@rebasepro/app";
import type { AdminCollection, CollectionConfigsBuilder, RebaseCMSConfig } from "@rebasepro/cms-types";

/**
 * Declarative component to configure the admin in Rebase.
 * Renders nothing — purely registers config into the RebaseRegistry.
 *
 * When `collectionEditor` is provided, the built-in visual schema editor
 * is auto-wired as a native feature (slots, provider, Studio view) without
 * needing any external plugin.
 */
export function RebaseCMS({ collections: collectionsProp, views, homePage, entityViews, collectionViews, entityActions, collectionEditor: collectionEditorProp, navigationGroupMappings, basePath }: RebaseCMSConfig) {
    const dispatch = useRebaseRegistryDispatch();

    // In an embedding (an MCP App view, `embed_host.ts`), the collections are
    // the app's own — custom fields, previews, views and actions included —
    // narrowed to what the person may see and do there; and the schema
    // editor, which writes the project's files, is not offered.
    const embed = useRebaseEmbedHost();
    const narrow = embed?.narrowCollections;
    const collections = useMemo(() => narrow && collectionsProp ? narrowed(collectionsProp, narrow) : collectionsProp,
        [collectionsProp, narrow]);
    const collectionEditor = embed ? undefined : collectionEditorProp;

    useLayoutEffect(() => {
        dispatch.registerAdmin({ collections,
views,
homePage,
entityViews,
collectionViews,
entityActions,
collectionEditor,
navigationGroupMappings,
basePath });
        return () => dispatch.unregisterAdmin();
    }, [dispatch, collections, views, homePage, entityViews, collectionViews, entityActions, collectionEditor, navigationGroupMappings, basePath]);

    return null;
}

function narrowed(
    collections: AdminCollection[] | CollectionConfigsBuilder,
    narrow: (collections: AdminCollection[]) => AdminCollection[]
): AdminCollection[] | CollectionConfigsBuilder {
    if (Array.isArray(collections)) return narrow(collections);
    return async params => narrow(await collections(params));
}
