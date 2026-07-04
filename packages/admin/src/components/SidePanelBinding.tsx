import type { CollectionConfig } from "@rebasepro/types";
import type { SidePanelBindingProps } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OnUpdateParams } from "../types/components/SnapshotFormProps";
import { ErrorBoundary } from "@rebasepro/ui";
import { IconButton, Maximize2Icon, XIcon } from "@rebasepro/ui";
import { EditViewBinding } from "./EditViewBinding";
import { DetailViewBinding } from "./DetailViewBinding";
import { useSideDialogContext } from "./SideDialogs";
import { useNavigate } from "react-router-dom";
import { saveSnapshotToMemoryCache, useComponentOverride } from "@rebasepro/core";
import { useCollectionRegistryController, useSidePanel } from "../index";
import { useUrlController } from "../index";
import { resolveDefaultSelectedView } from "@rebasepro/common";

/**
 * This is the component in charge of rendering the side dialog used
 * for editing snapshots. Use the {@link useSidePanel} to open
 * and control the dialogs.
 * This component needs a parent {@link Rebase}
 * {@link useSidePanel}
 * @group Components
 */
export function SidePanelBinding(props: SidePanelBindingProps) {

    const {
        allowFullScreen = true,
        path,
        snapshotId,
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
                snapshotId: params.snapshotId,
                selectedTab: params.selectedTab,
                updateUrl: collection?.openSnapshotMode !== "dialog",
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

    const parentSnapshotIds = useMemo(() => {
        return collectionRegistryController.getParentSnapshotIds(path);
    }, [collectionRegistryController, path]);

    const collection = collectionRegistryController.getCollection(path) ?? props.collection;

    const [showEditInPanel, setShowEditInPanel] = useState(selectedTab === "edit");
    const isDetailMode = collection?.defaultSnapshotAction === "view" && !showEditInPanel && Boolean(snapshotId);

    // Reset edit mode when switching snapshots
    useEffect(() => {
        setShowEditInPanel(selectedTab === "edit");
    }, [snapshotId, selectedTab]);

    // One-time correction: when the side panel opens without the correct
    // selectedTab but the resolved collection (from the registry) has a
    // defaultSelectedView, update the panel width and URL to match.
    // This handles cases where defaultSelectedView is set via the collection
    // editor / Studio and is not available on the collection object the
    // caller passed to sidePanelController.open().
    const hasCorrectedDefaultView = useRef(false);
    useEffect(() => {
        hasCorrectedDefaultView.current = false;
    }, [snapshotId]);
    useEffect(() => {
        if (hasCorrectedDefaultView.current) return;
        if (selectedTab) return; // Already has a tab — no correction needed
        if (!snapshotId || !collection?.defaultSelectedView) return;

        const effectiveDefault = resolveDefaultSelectedView(
            collection.defaultSelectedView,
            { status: "existing",
snapshotId }
        );
        if (effectiveDefault && effectiveDefault !== "edit") {
            hasCorrectedDefaultView.current = true;
            sidePanelController.replace({
                path,
                snapshotId,
                selectedTab: effectiveDefault,
                updateUrl: collection.openSnapshotMode !== "dialog",
                collection
            });
        }
    }, [selectedTab, snapshotId, collection, path, sidePanelController]);

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
                        layout={collection?.openSnapshotMode === "dialog" ? "dialog" : "side_panel"}
                        collection={collection as CollectionConfig}
                        snapshotId={snapshotId!}
                        parentCollectionSlugs={parentCollectionSlugs}
                        parentSnapshotIds={parentSnapshotIds}
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
                                        if (snapshotId) {
                                            const fullScreenUrl = urlController.buildUrlCollectionPath(`${path}/${snapshotId}`);
                                            navigate(fullScreenUrl, { state: null });
                                        }
                                    }}>
                                    <Maximize2Icon/>
                                </IconButton>}
                            </div>}
                        onTabChange={({
                            snapshotId: tabSnapshotId,
                            selectedTab,
                            collection: paramCollection
                        }) => {
                            if (collection?.openSnapshotMode === "dialog" || paramCollection?.openSnapshotMode === "dialog") {
                                return;
                            }
                            if (tabSnapshotId) {
                                sidePanelController.replace({
                                    path,
                                    snapshotId: tabSnapshotId,
                                    selectedTab,
                                    updateUrl: true,
                                    collection: paramCollection ?? collection
                                });
                            }
                        }}
                    />
                    : <EditViewBinding
                        {...props}
                        layout={collection?.openSnapshotMode === "dialog" ? "dialog" : "side_panel"}
                        collection={collection as CollectionConfig}
                        parentCollectionSlugs={parentCollectionSlugs} parentSnapshotIds={parentSnapshotIds}
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
                                        const key = (status === "new" || status === "copy") ? path + "#new" : path + "/" + snapshotId;
                                        saveSnapshotToMemoryCache(key, values);
                                        setBlocked(false);
                                        setBlockedNavigationMessage(undefined);
                                        if (snapshotId) {
                                            const fullScreenUrl = urlController.buildUrlCollectionPath(`${path}/${snapshotId}`);
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
                            snapshotId: tabSnapshotId,
                            selectedTab,
                            collection: paramCollection
                        }) => {
                            if (collection?.openSnapshotMode === "dialog" || paramCollection?.openSnapshotMode === "dialog") {
                                return;
                            }
                            if (tabSnapshotId) {
                                sidePanelController.replace({
                                    path,
                                    snapshotId: tabSnapshotId,
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
