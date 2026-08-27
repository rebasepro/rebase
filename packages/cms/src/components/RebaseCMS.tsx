import React, { useLayoutEffect } from "react";
import { useRebaseRegistryDispatch } from "@rebasepro/app";
import type { RebaseCMSConfig } from "@rebasepro/cms-types";

/**
 * Declarative component to configure the admin in Rebase.
 * Renders nothing — purely registers config into the RebaseRegistry.
 *
 * When `collectionEditor` is provided, the built-in visual schema editor
 * is auto-wired as a native feature (slots, provider, Studio view) without
 * needing any external plugin.
 */
export function RebaseCMS({ collections, views, homePage, entityViews, collectionViews, entityActions, collectionEditor, navigationGroupMappings, basePath }: RebaseCMSConfig) {
    const dispatch = useRebaseRegistryDispatch();

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
