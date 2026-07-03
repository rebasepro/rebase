import type { SnapshotCollection } from "@rebasepro/types";
import type { CustomizationController, SnapshotSidePanelProps, SideDialogPanelProps, SideDialogsController, SideSnapshotController, UrlController, NavigationStateController, Property } from "@rebasepro/types";
import { useCallback, useEffect, useRef, useMemo } from "react";
import { AuthController, CollectionRegistryController } from "@rebasepro/types";
import { useLocation } from "react-router-dom";
import {
    getNavigationEntriesFromPath,
    NavigationViewInternal,
    removeInitialAndTrailingSlashes,
    resolveDefaultSelectedView
} from "@rebasepro/common";
import { resolvedSelectedSnapshotView } from "../util/resolutions";
import { ADDITIONAL_TAB_WIDTH, CONTAINER_FULL_WIDTH, FORM_CONTAINER_WIDTH } from "@rebasepro/core";
import { useCustomizationController, useLargeLayout, useComponentOverride, CollectionComponentOverrideProvider } from "@rebasepro/core";
import { JSON_TAB_VALUE, HISTORY_TAB_VALUE } from "../components/SnapshotEditView";
import React from "react";
import { SnapshotSidePanel } from "../components/SnapshotSidePanel";

/**
 * Thin wrapper that resolves the Snapshot.SidePanel component override.
 * Because the JSX is created inside `propsToSidePanel` (a plain function,
 * not a React component), we need this wrapper so the hook is called at the
 * top level of a React component per the Rules of Hooks.
 */
function ResolvedSnapshotSidePanelInner(props: SnapshotSidePanelProps) {
    const Resolved = useComponentOverride("Snapshot.SidePanel", SnapshotSidePanel);
    return <Resolved {...props}/>;
}

function ResolvedSnapshotSidePanel(props: SnapshotSidePanelProps) {
    if (props.collection?.components) {
        return (
            <CollectionComponentOverrideProvider overrides={props.collection.components}>
                <ResolvedSnapshotSidePanelInner {...props}/>
            </CollectionComponentOverrideProvider>
        );
    }
    return <ResolvedSnapshotSidePanelInner {...props}/>;
}

const NEW_URL_HASH = "new_side";
const SIDE_URL_HASH = "side";

export function getSnapshotViewWidth(props: SnapshotSidePanelProps<any>, small: boolean, customizationController: CustomizationController): string {
    if (small) return CONTAINER_FULL_WIDTH;

    const {
        selectedSecondaryForm
    } = resolvedSelectedSnapshotView(props.collection?.snapshotViews, customizationController, props.selectedTab);

    const shouldUseSmallLayout = !props.selectedTab || props.selectedTab === "edit" || props.selectedTab === JSON_TAB_VALUE || props.selectedTab === HISTORY_TAB_VALUE || Boolean(selectedSecondaryForm);

    let resolvedWidth: string | undefined;
    if (props.width) {
        resolvedWidth = typeof props.width === "number" ? `${props.width}px` : props.width;
    } else if (props.collection?.sideDialogWidth) {
        resolvedWidth = typeof props.collection.sideDialogWidth === "number" ? `${props.collection.sideDialogWidth}px` : props.collection.sideDialogWidth;
    }

    if (!shouldUseSmallLayout) {
        return `calc(${ADDITIONAL_TAB_WIDTH} + ${resolvedWidth ?? FORM_CONTAINER_WIDTH})`
    } else {
        if (resolvedWidth) {
            return resolvedWidth
        } else if (!props.collection) {
            return FORM_CONTAINER_WIDTH;
        } else {
            return calculateCollectionDesiredWidth(props.collection);
        }
    }
}

const collectionViewWidthCache: { [key: string]: string } = {};

function calculateCollectionDesiredWidth(collection: SnapshotCollection<any>): string {
    if (collectionViewWidthCache[collection.slug]) {
        return collectionViewWidthCache[collection.slug];
    }

    let result = FORM_CONTAINER_WIDTH
    if (collection?.properties) {
        const values = Object.values(collection.properties).map((p: Property) => getNestedPropertiesDepth(p));
        const maxDepth = Math.max(...values);
        if (maxDepth < 3) {
            result = FORM_CONTAINER_WIDTH;
        } else {
            result = 768 + 32 * (maxDepth - 2) + "px";
        }
    }
    collectionViewWidthCache[collection.slug] = result;
    return result;
}

function getNestedPropertiesDepth(property: Property, accumulator = 0): number {
    if (property.type === "map" && property.properties) {
        const values = Object.values(property.properties).flatMap((childProperty) => getNestedPropertiesDepth(childProperty as Readonly<Property>, accumulator + 1));
        return Math.max(...values);
    } else if (property.type === "array" && property.oneOf) {
        return accumulator + 3;
    } else if (property.type === "array" && property.of) {
        if (Array.isArray(property.of)) {
            return Math.max(...property.of.map((p) => getNestedPropertiesDepth(p, accumulator + 1)));
        } else {
            return getNestedPropertiesDepth(property.of, accumulator + 1);
        }
    } else {
        return accumulator + 1;
    }
}

export const useBuildSideSnapshotController = (collectionRegistryController: CollectionRegistryController,
    urlController: UrlController,
    navigationStateController: NavigationStateController,
    sideDialogsController: SideDialogsController,
    authController: AuthController
): SideSnapshotController => {

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
                const snapshotOrCollectionPath = urlController.urlPathToDataPath(location.pathname);
                const panelsFromUrl = buildSidePanelsFromUrl(snapshotOrCollectionPath, collectionRegistryController.collections ?? [], newFlag);
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
                const snapshotOrCollectionPath = urlController.urlPathToDataPath(location.pathname);
                const panelsFromUrl = buildSidePanelsFromUrl(snapshotOrCollectionPath, collectionRegistryController.collections ?? [], false);
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
    // Recreating components would unmount/remount SnapshotSidePanel, losing
    // scroll position, unsaved form state, and triggering unnecessary data fetches.
    useEffect(() => {
        const updatedSidePanels = sideDialogsController.sidePanels.map(sidePanelProps => {
            if (sidePanelProps.additional) {
                const snapshotProps = sidePanelProps.additional as SnapshotSidePanelProps;
                const newWidth = getSnapshotViewWidth(snapshotProps, smallLayout, customizationController);
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

    const open = useCallback((props: SnapshotSidePanelProps<any>) => {

        if (props.copy && !props.snapshotId) {
            throw Error("If you want to copy a snapshot you need to provide a snapshotId");
        }

        const defaultSelectedView = resolveDefaultSelectedView(
            props.collection ? props.collection.defaultSelectedView : undefined,
            {
                status: props.copy ? "copy" : (props.snapshotId ? "existing" : "new"),
                snapshotId: props.snapshotId
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

    const replace = useCallback((props: SnapshotSidePanelProps<any>) => {

        if (props.copy && !props.snapshotId) {
            throw Error("If you want to copy a snapshot you need to provide a snapshotId");
        }

        sideDialogsController.replace(propsToSidePanel(props, urlController.buildUrlCollectionPath, urlController.resolveDatabasePathsFrom, smallLayout, customizationController, authController, location.search));

    }, [urlController.buildUrlCollectionPath, urlController.resolveDatabasePathsFrom, sideDialogsController, smallLayout, authController.user, location.search]);

    return useMemo(() => ({
        close,
        open,
        replace
    }), [close, open, replace]);
};

export function buildSidePanelsFromUrl(path: string, collections: SnapshotCollection[], newFlag: boolean): SnapshotSidePanelProps<any>[] {

    const navigationViewsForPath: NavigationViewInternal<any>[] = getNavigationEntriesFromPath({
        path,
        collections
    });

    let sidePanel: SnapshotSidePanelProps<any> | undefined = undefined;
    let lastCollectionPath = "";
    let lastCollectionId: string | undefined = undefined;
    for (let i = 0; i < navigationViewsForPath.length; i++) {
        const navigationEntry = navigationViewsForPath[i];

        if (navigationEntry.type === "collection") {
            lastCollectionPath = navigationEntry.slug;
            lastCollectionId = navigationEntry.collection.slug;
        }

        const previousEntry = navigationViewsForPath[i - 1];
        if (navigationEntry.type === "snapshot") {
            sidePanel = {
                path: navigationEntry.slug,
                snapshotId: navigationEntry.snapshotId,
                copy: false,
                collection: navigationEntry.parentCollection,
                width: navigationEntry.parentCollection?.sideDialogWidth
            };
        } else if (navigationEntry.type === "custom_view") {
            if (previousEntry?.type === "snapshot") {
                if (sidePanel)
                    sidePanel.selectedTab = navigationEntry.view.key;
            }
        } else if (navigationEntry.type === "collection") {
            if (previousEntry?.type === "snapshot") {
                if (sidePanel)
                    sidePanel.selectedTab = navigationEntry.collection.slug;
            }
        }

    }

    // When the URL doesn't contain a tab segment but the collection has a
    // defaultSelectedView, resolve it so the panel opens with the correct
    // width and the URL is updated on the next replace() cycle.
    if (sidePanel && !sidePanel.selectedTab && sidePanel.collection) {
        const defaultView = resolveDefaultSelectedView(
            sidePanel.collection.defaultSelectedView,
            {
                status: sidePanel.copy ? "copy" : (sidePanel.snapshotId ? "existing" : "new"),
                snapshotId: sidePanel.snapshotId
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

const propsToSidePanel = (props: SnapshotSidePanelProps,
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
        ? (props.snapshotId
            ? buildUrlCollectionPath(`${collectionPath}/${props.snapshotId}${props.selectedTab ? "/" + props.selectedTab : ""}${locationSearch}#${SIDE_URL_HASH}`)
            : buildUrlCollectionPath(`${collectionPath}${locationSearch}#${NEW_URL_HASH}`))
        : undefined;

    const parentUrlPath = shouldUpdateUrl
        ? buildUrlCollectionPath(collectionPath)
        : undefined;

    const resolvedPanelProps: SnapshotSidePanelProps<any> = {
        ...props,
        formProps: props.formProps
    };

    const snapshotViewWidth = getSnapshotViewWidth(props, smallLayout, customizationController);
    return {
        key: `${props.path}/${props.snapshotId}`,
        component: <ResolvedSnapshotSidePanel {...resolvedPanelProps}/>,
        urlPath: urlPath,
        parentUrlPath: parentUrlPath,
        width: snapshotViewWidth,
        onClose: props.onClose,
        additional: resolvedPanelProps
    };
}
