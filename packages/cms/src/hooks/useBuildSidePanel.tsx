
import type { Property } from "@rebasepro/types";
import type { CustomizationController, SidePanelBindingProps, SideDialogPanelProps, SideDialogsController, SidePanelController, UrlController, NavigationStateController, AdminCollection } from "@rebasepro/cms-types";
import { useCallback, useEffect, useRef, useMemo } from "react";
import { CollectionRegistryController } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import { useLocation } from "react-router";
import { NavigationViewInternal } from "@rebasepro/app";
import { getNavigationEntriesFromPath, removeInitialAndTrailingSlashes, removeTrailingSlash, resolveDefaultSelectedView } from "@rebasepro/app";
import { resolvedSelectedEntityView } from "../util/resolutions";
import { CONTAINER_FULL_WIDTH, SIDE_PANEL_DEFAULT_WIDTH } from "@rebasepro/app";
import { useCustomizationController, useLargeLayout, useComponentOverride, CollectionScopeProvider } from "@rebasepro/app";
import { JSON_TAB_VALUE, HISTORY_TAB_VALUE } from "../components/EditViewBinding";
import React from "react";
import { SidePanelBinding } from "../components/SidePanelBinding";

/**
 * Thin wrapper that resolves the Entity.SidePanel component override.
 * Because the JSX is created inside `propsToSidePanel` (a plain function,
 * not a React component), we need this wrapper so the hook is called at the
 * top level of a React component per the Rules of Hooks.
 */
function ResolvedSidePanelBindingInner(props: SidePanelBindingProps) {
    const Resolved = useComponentOverride("Entity.SidePanel", SidePanelBinding);
    return <Resolved {...props}/>;
}

function ResolvedSidePanelBinding(props: SidePanelBindingProps) {
    if (props.collection) {
        return (
            <CollectionScopeProvider collection={props.collection}>
                <ResolvedSidePanelBindingInner {...props}/>
            </CollectionScopeProvider>
        );
    }
    return <ResolvedSidePanelBindingInner {...props}/>;
}

const NEW_URL_HASH = "new_side";
const SIDE_URL_HASH = "side";

/**
 * How wide the side panel opens.
 *
 * One width for the whole panel, whatever tab is showing. It used to depend on
 * the selected tab — the form got one width and a subcollection or custom view
 * got `calc(55vw + 768px)` — so the panel physically resized under the cursor
 * every time you switched tabs. And the "form" width was derived from how
 * deeply nested the collection's *properties* were, which is not a thing anyone
 * can predict from looking at the panel.
 *
 * Now: `width` prop, then the collection's `sideDialogWidth`, then a default
 * sized for the content the panel actually has to hold — the form column plus
 * its metadata rail — capped so it never eats the whole window.
 */
export function getEntityViewWidth(props: SidePanelBindingProps<any>, small: boolean, customizationController: CustomizationController): string {
    if (small) return CONTAINER_FULL_WIDTH;

    if (props.width) {
        return typeof props.width === "number" ? `${props.width}px` : props.width;
    }
    if (props.collection?.sideDialogWidth) {
        return typeof props.collection.sideDialogWidth === "number"
            ? `${props.collection.sideDialogWidth}px`
            : props.collection.sideDialogWidth;
    }
    return SIDE_PANEL_DEFAULT_WIDTH;
}

export const useBuildSidePanel = (collectionRegistryController: CollectionRegistryController,
    urlController: UrlController,
    navigationStateController: NavigationStateController,
    sideDialogsController: SideDialogsController,
    authController: AuthController
): SidePanelController => {

    const location = useLocation();
    const initialised = useRef<boolean>(false);
    const currentPanelKeysRef = useRef<string[]>([]);
    const customizationController = useCustomizationController();

    const smallLayout = !useLargeLayout();

    useEffect(() => {

        const newFlag = location.hash === `#${NEW_URL_HASH}`;
        const sideFlag = location.hash === `#${SIDE_URL_HASH}`;

        if (!navigationStateController.loading) {
            if ((newFlag || sideFlag) && urlController.isUrlCollectionPath(location.pathname)) {
                const entityOrCollectionPath = urlController.urlPathToDataPath(location.pathname);
                const panelsFromUrl = buildSidePanelsFromUrl(entityOrCollectionPath, collectionRegistryController.collections ?? [], newFlag);
                for (let i = 0; i < panelsFromUrl.length; i++) {
                    const props = panelsFromUrl[i];
                    if (i === 0)
                        sideDialogsController.replace(propsToSidePanel(props, urlController.buildUrlCollectionPath, urlController.resolveDatabasePathsFrom, smallLayout, customizationController, authController, location.search));
                    else
                        sideDialogsController.open(propsToSidePanel(props, urlController.buildUrlCollectionPath, urlController.resolveDatabasePathsFrom, smallLayout, customizationController, authController, location.search))
                }
            }
            initialised.current = true;
        }
    }, [navigationStateController.loading]);

    // sync panels if URL changes with #side
    // Use a ref for currentPanelKeys so this effect only fires on URL changes,
    // not on panel state changes. This prevents a race condition with React Router 7
    // where close() clears panels before the URL updates, causing the effect to
    // re-open the panel from the stale #side hash.
    currentPanelKeysRef.current = sideDialogsController.sidePanels.map(p => p.key);
    useEffect(() => {
        if (initialised.current) {
            const sideFlag = location.hash === `#${SIDE_URL_HASH}`;
            if (sideFlag) {
                const currentKeys = currentPanelKeysRef.current;
                const entityOrCollectionPath = urlController.urlPathToDataPath(location.pathname);
                const panelsFromUrl = buildSidePanelsFromUrl(entityOrCollectionPath, collectionRegistryController.collections ?? [], false);
                // if we have more panels than determined by the url, we ignore the url. We might have references open
                if (panelsFromUrl.length <= currentKeys.length) {
                    return;
                }
                const lastPanel = panelsFromUrl[panelsFromUrl.length - 1];
                const panelProps = propsToSidePanel(lastPanel, urlController.buildUrlCollectionPath, urlController.resolveDatabasePathsFrom, smallLayout, customizationController, authController, location.search);
                const lastCurrentPanel = currentKeys.length > 0 ? currentKeys[currentKeys.length - 1] : undefined;
                if (!lastCurrentPanel || lastCurrentPanel !== panelProps.key) {
                    sideDialogsController.replace(panelProps);
                }
            }
        }
    }, [location.pathname, location.hash]);

    // update side panels to match browser size
    // Only update panel widths on layout change — don't recreate components.
    // Recreating components would unmount/remount SidePanelBinding, losing
    // scroll position, unsaved form state, and triggering unnecessary data fetches.
    useEffect(() => {
        const updatedSidePanels = sideDialogsController.sidePanels.map(sidePanelProps => {
            if (sidePanelProps.additional) {
                const entityProps = sidePanelProps.additional as SidePanelBindingProps;
                const newWidth = getEntityViewWidth(entityProps, smallLayout, customizationController);
                if (sidePanelProps.width !== newWidth) {
                    return { ...sidePanelProps,
width: newWidth };
                }
            }
            return sidePanelProps;
        });
        sideDialogsController.setSidePanels(updatedSidePanels);
    }, [smallLayout]);

    const close = useCallback(() => {
        sideDialogsController.close();
    }, [sideDialogsController]);

    const open = useCallback((props: SidePanelBindingProps<any>) => {

        if (props.copy && !props.entityId) {
            throw Error("If you want to copy a entity you need to provide a entityId");
        }

        const defaultSelectedView = resolveDefaultSelectedView(
            props.collection ? props.collection.defaultSelectedView : undefined,
            {
                status: props.copy ? "copy" : (props.entityId ? "existing" : "new"),
                entityId: props.entityId
            }
        );

        sideDialogsController.open(
            propsToSidePanel({
                ...props,
                selectedTab: props.selectedTab ?? defaultSelectedView
            },
                urlController.buildUrlCollectionPath,
                urlController.resolveDatabasePathsFrom,
                smallLayout,
                customizationController,
                authController,
                location.search
            ));

    }, [sideDialogsController, urlController.buildUrlCollectionPath, urlController.resolveDatabasePathsFrom, smallLayout, authController.user, location.search]);

    const replace = useCallback((props: SidePanelBindingProps<any>) => {

        if (props.copy && !props.entityId) {
            throw Error("If you want to copy a entity you need to provide a entityId");
        }

        sideDialogsController.replace(propsToSidePanel(props, urlController.buildUrlCollectionPath, urlController.resolveDatabasePathsFrom, smallLayout, customizationController, authController, location.search));

    }, [urlController.buildUrlCollectionPath, urlController.resolveDatabasePathsFrom, sideDialogsController, smallLayout, authController.user, location.search]);

    return useMemo(() => ({
        close,
        open,
        replace
    }), [close, open, replace]);
};

export function buildSidePanelsFromUrl(path: string, collections: AdminCollection[], newFlag: boolean): SidePanelBindingProps<any>[] {

    const navigationViewsForPath: NavigationViewInternal<any>[] = getNavigationEntriesFromPath({
        path,
        collections
    });

    let sidePanel: SidePanelBindingProps<any> | undefined = undefined;
    let lastCollectionPath = "";
    let lastCollectionId: string | undefined = undefined;
    for (let i = 0; i < navigationViewsForPath.length; i++) {
        const navigationEntry = navigationViewsForPath[i];

        if (navigationEntry.type === "collection") {
            lastCollectionPath = navigationEntry.slug;
            lastCollectionId = navigationEntry.collection.slug;
        }

        const previousEntry = navigationViewsForPath[i - 1];
        if (navigationEntry.type === "entity") {
            sidePanel = {
                path: navigationEntry.slug,
                entityId: navigationEntry.entityId,
                copy: false,
                collection: navigationEntry.parentCollection,
                width: navigationEntry.parentCollection?.sideDialogWidth
            };
        } else if (navigationEntry.type === "custom_view") {
            if (previousEntry?.type === "entity") {
                if (sidePanel)
                    sidePanel.selectedTab = navigationEntry.view.key;
            }
        } else if (navigationEntry.type === "collection") {
            if (previousEntry?.type === "entity") {
                if (sidePanel)
                    sidePanel.selectedTab = navigationEntry.collection.slug;
            }
        }

    }

    // `edit` is not a registered view, so the navigation parser skips it. Pick it
    // up from the raw path so that reloading an edit URL reopens the edit form
    // rather than silently dropping the user back on the detail view.
    if (sidePanel && !sidePanel.selectedTab && removeTrailingSlash(path).endsWith("/edit")) {
        sidePanel.selectedTab = "edit";
    }

    // When the URL doesn't contain a tab segment but the collection has a
    // defaultSelectedView, resolve it so the panel opens with the correct
    // width and the URL is updated on the next replace() cycle.
    if (sidePanel && !sidePanel.selectedTab && sidePanel.collection) {
        const defaultView = resolveDefaultSelectedView(
            sidePanel.collection.defaultSelectedView,
            {
                status: sidePanel.copy ? "copy" : (sidePanel.entityId ? "existing" : "new"),
                entityId: sidePanel.entityId
            }
        );
        if (defaultView) {
            sidePanel.selectedTab = defaultView;
        }
    }

    if (newFlag) {
        sidePanel = {
            path: lastCollectionPath,
            copy: false
        }
    }

    return sidePanel ? [sidePanel] : [];
}

const propsToSidePanel = (props: SidePanelBindingProps,
    buildUrlCollectionPath: (path: string) => string,
    resolveIdsFrom: (pathWithAliases: string) => string,
    smallLayout: boolean,
    customizationController: CustomizationController,
    authController: AuthController,
    locationSearch: string
): SideDialogPanelProps => {

    const collectionPath = removeInitialAndTrailingSlashes(props.path);

    // When updateUrl is explicitly false, don't generate URL paths — the dialog
    // opens as an overlay without affecting the browser URL / router.
    const shouldUpdateUrl = props.updateUrl !== false;

    const urlPath = shouldUpdateUrl
        ? (props.entityId
            ? buildUrlCollectionPath(`${collectionPath}/${props.entityId}${props.selectedTab ? "/" + props.selectedTab : ""}${locationSearch}#${SIDE_URL_HASH}`)
            : buildUrlCollectionPath(`${collectionPath}${locationSearch}#${NEW_URL_HASH}`))
        : undefined;

    const parentUrlPath = shouldUpdateUrl
        ? buildUrlCollectionPath(collectionPath)
        : undefined;

    const resolvedPanelProps: SidePanelBindingProps<any> = {
        ...props,
        formProps: props.formProps
    };

    const entityViewWidth = getEntityViewWidth(props, smallLayout, customizationController);
    return {
        key: `${props.path}/${props.entityId}`,
        component: <ResolvedSidePanelBinding {...resolvedPanelProps}/>,
        urlPath: urlPath,
        parentUrlPath: parentUrlPath,
        width: entityViewWidth,
        onClose: props.onClose,
        additional: resolvedPanelProps
    };
}
