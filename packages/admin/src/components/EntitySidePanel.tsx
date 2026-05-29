import type { EntityCollection } from "@rebasepro/types";
import type { EntitySidePanelProps } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { OnUpdateParams } from "../types/components/EntityFormProps";
import { ErrorBoundary } from "@rebasepro/ui";
import { IconButton, Maximize2Icon, XIcon } from "@rebasepro/ui";
import { EntityEditView } from "./EntityEditView";
import { EntityDetailView } from "./EntityDetailView";
import { useSideDialogContext } from "./SideDialogs";
import { useLocation, useNavigate } from "react-router-dom";
import { removeInitialAndTrailingSlashes } from "@rebasepro/common";
import { saveEntityToMemoryCache } from "@rebasepro/core";
import { useCollectionRegistryController, useSideEntityController } from "../index";
import { useUrlController } from "../index";

/**
 * This is the component in charge of rendering the side dialog used
 * for editing entities. Use the {@link useSideEntityController} to open
 * and control the dialogs.
 * This component needs a parent {@link Rebase}
 * {@link useSideEntityController}
 * @group Components
 */
export function EntitySidePanel(props: EntitySidePanelProps) {

    const {
        allowFullScreen = true,
        path,
        entityId,
        selectedTab,
        formProps
    } = props;

    const {
        blocked,
        setBlocked,
        setBlockedNavigationMessage,
        close
    } = useSideDialogContext();

    const navigate = useNavigate();
    const location = useLocation();

    const sideEntityController = useSideEntityController();
    const collectionRegistryController = useCollectionRegistryController();
    const sideDialogsController = useSideDialogContext();
    const urlController = useUrlController();

    const onClose = () => {
        if (props.onClose) {
            props.onClose();
        }

        setBlocked(false);
        close(true);
    }

    const onUpdate = (params: OnUpdateParams) => {
        if (props.onUpdate) {
            props.onUpdate(params);
        }
        setShowEditInPanel(false);
        if (params.status !== "existing") {
            sideEntityController.replace({
                path: params.path,
                entityId: params.entityId,
                selectedTab: params.selectedTab,
                updateUrl: collection?.openEntityMode !== "dialog",
                collection: params.collection
            });
        }

        if (sideDialogsController.pendingClose) {
            sideDialogsController.setPendingClose(false);
            onClose();
        }

    }

    const parentCollectionSlugs = useMemo(() => {
        return collectionRegistryController.getParentCollectionSlugs(path);
    }, [collectionRegistryController, path]);

    const parentEntityIds = useMemo(() => {
        return collectionRegistryController.getParentEntityIds(path);
    }, [collectionRegistryController, path]);

    const collection = collectionRegistryController.getCollection(path) ?? props.collection;

    const [showEditInPanel, setShowEditInPanel] = useState(selectedTab === "edit");
    const isDetailMode = collection?.defaultEntityAction === "view" && !showEditInPanel && Boolean(entityId);

    // Reset edit mode when switching entities
    useEffect(() => {
        setShowEditInPanel(selectedTab === "edit");
    }, [entityId, selectedTab]);

    // Note: beforeunload is handled by useUnsavedChangesDialog in SideDialogView,
    // which listens to the same `blocked` state via SideDialogContext.

    const onValuesModified = useCallback((modified: boolean) => {
        setBlockedNavigationMessage(modified
            ? <> You have unsaved changes in this <b>{collection?.singularName ?? collection?.name}</b>.</>
            : undefined)
        setBlocked(modified);
    }, [collection?.name, setBlocked, setBlockedNavigationMessage]);

    if (!props || !collection) {
        return <div className={"w-full"}/>;
    }

    return (
        <>
            <ErrorBoundary>
                {isDetailMode
                    ? <EntityDetailView
                        path={path}
                        layout={collection?.openEntityMode === "dialog" ? "dialog" : "side_panel"}
                        collection={collection as EntityCollection}
                        entityId={entityId!}
                        parentCollectionSlugs={parentCollectionSlugs}
                        parentEntityIds={parentEntityIds}
                        onEditClick={() => setShowEditInPanel(true)}
                        barActions={({
                            status,
                            values
                        }) => <div className="flex gap-1">
                                <IconButton
                                    className="self-center"
                                    size={"small"}
                                    onClick={onClose}>
                                    <XIcon/>
                                </IconButton>
                                {allowFullScreen && <IconButton
                                    className="self-center"
                                    size={"small"}
                                    onClick={() => {
                                        if (entityId) {
                                            const fullScreenUrl = urlController.buildUrlCollectionPath(`${path}/${entityId}`);
                                            navigate(fullScreenUrl, { state: null });
                                        }
                                    }}>
                                    <Maximize2Icon/>
                                </IconButton>}
                            </div>}
                        onTabChange={({
                            entityId: tabEntityId,
                            selectedTab,
                            collection: paramCollection
                        }) => {
                            if (collection?.openEntityMode === "dialog" || paramCollection?.openEntityMode === "dialog") {
                                return;
                            }
                            if (tabEntityId) {
                                const collectionPath = removeInitialAndTrailingSlashes(path);
                                const tabSuffix = selectedTab ? "/" + selectedTab : "";
                                const fullUrl = urlController.buildUrlCollectionPath(`${collectionPath}/${tabEntityId}${tabSuffix}#side`);
                                navigate(fullUrl, { replace: true, state: location.state });
                            }
                        }}
                    />
                    : <EntityEditView
                        {...props}
                        layout={collection?.openEntityMode === "dialog" ? "dialog" : "side_panel"}
                        collection={collection as EntityCollection}
                        parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                        onValuesModified={onValuesModified}
                        onSaved={onUpdate}
                        navigateBack={() => setShowEditInPanel(false)}
                        barActions={({
                            status,
                            values
                        }) => <div className="flex gap-1">
                                <IconButton
                                    className="self-center"
                                    size={"small"}
                                    onClick={onClose}>
                                    <XIcon/>
                                </IconButton>
                                {allowFullScreen && <IconButton
                                    className="self-center"
                                    size={"small"}
                                    onClick={() => {
                                        const key = (status === "new" || status === "copy") ? path + "#new" : path + "/" + entityId;
                                        saveEntityToMemoryCache(key, values);
                                        setBlocked(false);
                                        setBlockedNavigationMessage(undefined);
                                        if (entityId) {
                                            const fullScreenUrl = urlController.buildUrlCollectionPath(`${path}/${entityId}`);
                                            navigate(fullScreenUrl, { state: null });
                                        } else {
                                            const fullScreenUrl = urlController.buildUrlCollectionPath(path);
                                            navigate(fullScreenUrl + "#new", { state: null });
                                        }
                                    }}>
                                    <Maximize2Icon/>
                                </IconButton>}
                            </div>}
                        onTabChange={({
                            entityId,
                            selectedTab,
                            collection: paramCollection
                        }) => {
                            if (collection?.openEntityMode === "dialog" || paramCollection?.openEntityMode === "dialog") {
                                return;
                            }
                            if (entityId) {
                                const collectionPath = removeInitialAndTrailingSlashes(path);
                                const tabSuffix = selectedTab ? "/" + selectedTab : "";
                                const fullUrl = urlController.buildUrlCollectionPath(`${collectionPath}/${entityId}${tabSuffix}#side`);
                                navigate(fullUrl, { replace: true, state: location.state });
                            }
                        }}
                        formProps={formProps}
                    />
                }
            </ErrorBoundary>

        </>
    );
}
