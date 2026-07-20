import type { CollectionConfig } from "@rebasepro/types";
import type { SidePanelBindingProps } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OnUpdateParams } from "../types/components/EntityFormProps";
import { ErrorBoundary } from "@rebasepro/ui";
import { IconButton, Maximize2Icon, XIcon } from "@rebasepro/ui";
import { EditViewBinding } from "./EditViewBinding";
import { DetailViewBinding } from "./DetailViewBinding";
import { useSideDialogContext } from "./SideDialogs";
import { useNavigate } from "react-router-dom";
import { saveEntityToMemoryCache, useComponentOverride } from "@rebasepro/app";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useSidePanel } from "../hooks/useSidePanel";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { resolveDefaultSelectedView } from "@rebasepro/common";

/**
 * This is the component in charge of rendering the side dialog used
 * for editing entities. Use the {@link useSidePanel} to open
 * and control the dialogs.
 * This component needs a parent {@link Rebase}
 * {@link useSidePanel}
 * @group Components
 */
export function SidePanelBinding(props: SidePanelBindingProps) {

    const {
        allowFullScreen = true,
        path,
        entityId,
        selectedTab,
        formProps
    } = props;

    const ResolvedDetailView = useComponentOverride("DetailView", DetailViewBinding);

    const {
        blocked,
        setBlocked,
        setBlockedNavigationMessage,
        close
    } = useSideDialogContext();

    const navigate = useNavigate();

    const sidePanelController = useSidePanel();
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
            sidePanelController.replace({
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

    // One-time correction: when the side panel opens without the correct
    // selectedTab but the resolved collection (from the registry) has a
    // defaultSelectedView, update the panel width and URL to match.
    // This handles cases where defaultSelectedView is set via the collection
    // editor / Studio and is not available on the collection object the
    // caller passed to sidePanelController.open().
    const hasCorrectedDefaultView = useRef(false);
    useEffect(() => {
        hasCorrectedDefaultView.current = false;
    }, [entityId]);
    useEffect(() => {
        if (hasCorrectedDefaultView.current) return;
        if (selectedTab) return; // Already has a tab — no correction needed
        if (!entityId || !collection?.defaultSelectedView) return;

        const effectiveDefault = resolveDefaultSelectedView(
            collection.defaultSelectedView,
            { status: "existing",
entityId }
        );
        if (effectiveDefault && effectiveDefault !== "edit") {
            hasCorrectedDefaultView.current = true;
            sidePanelController.replace({
                path,
                entityId,
                selectedTab: effectiveDefault,
                updateUrl: collection.openEntityMode !== "dialog",
                collection
            });
        }
    }, [selectedTab, entityId, collection, path, sidePanelController]);

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
                    ? <ResolvedDetailView
                        path={path}
                        layout={collection?.openEntityMode === "dialog" ? "dialog" : "side_panel"}
                        collection={collection as CollectionConfig}
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
                                sidePanelController.replace({
                                    path,
                                    entityId: tabEntityId,
                                    selectedTab,
                                    updateUrl: true,
                                    collection: paramCollection ?? collection
                                });
                            }
                        }}
                    />
                    : <EditViewBinding
                        {...props}
                        layout={collection?.openEntityMode === "dialog" ? "dialog" : "side_panel"}
                        collection={collection as CollectionConfig}
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
                            entityId: tabEntityId,
                            selectedTab,
                            collection: paramCollection
                        }) => {
                            if (collection?.openEntityMode === "dialog" || paramCollection?.openEntityMode === "dialog") {
                                return;
                            }
                            if (tabEntityId) {
                                sidePanelController.replace({
                                    path,
                                    entityId: tabEntityId,
                                    selectedTab,
                                    updateUrl: true,
                                    collection: paramCollection ?? collection
                                });
                            }
                        }}
                        formProps={formProps}
                    />
                }
            </ErrorBoundary>

        </>
    );
}
