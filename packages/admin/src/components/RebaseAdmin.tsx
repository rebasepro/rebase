import React, { useLayoutEffect } from "react";
import { useRebaseRegistryDispatch } from "@rebasepro/app";
import type { RebaseAdminConfig } from "@rebasepro/admin-types";

/**
 * Declarative component to configure the CMS in Rebase.
 * Renders nothing — purely registers config into the RebaseRegistry.
 *
 * When `collectionEditor` is provided, the built-in visual schema editor
 * is auto-wired as a native feature (slots, provider, Studio view) without
 * needing any external plugin.
 */
export function RebaseAdmin({ collections, views, homePage, entityViews, entityActions, collectionEditor, navigationGroupMappings, basePath }: RebaseAdminConfig) {
    const dispatch = useRebaseRegistryDispatch();

    useLayoutEffect(() => {
        dispatch.registerCMS({ collections,
views,
homePage,
entityViews,
entityActions,
collectionEditor,
navigationGroupMappings,
basePath });
        return () => dispatch.unregisterCMS();
    }, [dispatch, collections, views, homePage, entityViews, entityActions, collectionEditor, navigationGroupMappings, basePath]);

    return null;
}
