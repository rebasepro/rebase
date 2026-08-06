
import type { SidePanelBindingProps, AdminCollection } from "@rebasepro/admin-types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OnUpdateParams } from "../types/components/EntityFormProps";
import { ErrorBoundary } from "@rebasepro/ui";
import { IconButton, Maximize2Icon, XIcon } from "@rebasepro/ui";
import { EditViewBinding } from "./EditViewBinding";
import { DetailViewBinding } from "./DetailViewBinding";
import { useSideDialogContext } from "./SideDialogs";
import { useNavigate } from "react-router";
import { useComponentOverride } from "@rebasepro/app";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useSidePanel } from "../hooks/useSidePanel";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { resolveDefaultSelectedView } from "@rebasepro/app";

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

    /**
     * The X in the identity bar.
     *
     * Unforced, so it stops at the same unsaved-changes prompt that Escape and
     * a click outside already do. It used to clear `blocked` and force the
     * close, which made the one control actually labelled "close" the only way
     * out of the panel that dropped an edit without asking.
     *
     * `props.onClose` is not called here: the panel carries the same callback
     * (see `propsToSidePanel`) and {@link SideDialogs} fires it once the panel
     * really closes — which is after the prompt, not before it.
     */
    const onClose = () => {
        close();
    }

    /**
     * Closing because the record was just saved, which is the one case that has
     * to force. `blocked` is driven by an effect on the form's dirty flag and is
     * still true for a tick after a save; prompting about unsaved changes here
     * would be asking about values that are already on the server.
     */
    const closeAfterSave = () => {
        setBlocked(false);
        close(true);
    }

    const onUpdate = (params: OnUpdateParams) => {
        if (props.onUpdate) {
            props.onUpdate(params);
        }
        setEditInDialog(false);
        if (params.status !== "existing") {
            // A newly created entity replaces the panel with its own address,
            // which already leaves the edit view behind.
            sidePanelController.replace({
                path: params.path,
                entityId: params.entityId,
                selectedTab: params.selectedTab,
                updateUrl: collection?.openEntityMode !== "dialog",
                collection: params.collection
            });
        } else {
            closeEditView();
        }

        if (sideDialogsController.pendingClose) {
            sideDialogsController.setPendingClose(false);
            closeAfterSave();
        }

    }

    const parentCollectionSlugs = useMemo(() => {
        return collectionRegistryController.getParentCollectionSlugs(path);
    }, [collectionRegistryController, path]);

    const parentEntityIds = useMemo(() => {
        return collectionRegistryController.getParentEntityIds(path);
    }, [collectionRegistryController, path]);

    const collection = collectionRegistryController.getCollection(path) ?? props.collection;

    // Dialog mode deliberately stays out of the URL, so it is the only case that
    // needs local edit state. Everywhere else `edit` is a path segment, which
    // keeps refresh and the back button working the same way they do in split.
    const isDialogMode = collection?.openEntityMode === "dialog";
    const [editInDialog, setEditInDialog] = useState(false);
    const showEditInPanel = isDialogMode ? editInDialog : selectedTab === "edit";
    const isDetailMode = collection?.defaultEntityAction === "view" && !showEditInPanel && Boolean(entityId);

    // Reset edit mode when switching entities
    useEffect(() => {
        setEditInDialog(false);
    }, [entityId]);

    const openEditView = useCallback(() => {
        if (isDialogMode || !entityId) {
            setEditInDialog(true);
            return;
        }
        sidePanelController.replace({
            path,
            entityId,
            selectedTab: "edit",
            updateUrl: true,
            collection
        });
    }, [isDialogMode, entityId, path, collection, sidePanelController]);

    const closeEditView = useCallback(() => {
        if (isDialogMode || !entityId) {
            setEditInDialog(false);
            return;
        }
        sidePanelController.replace({
            path,
            entityId,
            selectedTab: undefined,
            updateUrl: true,
            collection
        });
    }, [isDialogMode, entityId, path, collection, sidePanelController]);

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

    const closeButton = (
        <IconButton
            className="self-center"
            size={"small"}
            onClick={onClose}>
            <XIcon/>
        </IconButton>
    );

    /**
     * Where the panel's own two controls sit, which is not the same question in
     * the two layouts that have them.
     *
     * A **side panel** slides in over the list from the right, and its leading
     * edge is the seam between the two. Close belongs on that seam — it points
     * back at the thing still visible behind it — and it is where the eye
     * already is, because the breadcrumb starts there.
     *
     * A **dialog** has no seam and nothing behind it to point at. It is a box
     * centred on a dimmed screen, and every box like it on every platform is
     * dismissed from its top-right corner. Close was sitting at the far left
     * of the bar, a full dialog's width from the expand button it belongs
     * beside, in the one corner that means "back" in a layout with no back.
     *
     * So in a dialog the two travel together at the trailing edge, expand then
     * close: the window controls, after the record's actions and its overflow
     * menu, in the corner a dialog is closed from.
     */
    const barActionsStart = isDialogMode ? undefined : closeButton;

    const windowControls = (expandButton: React.ReactNode) => (
        <div className="flex gap-1 items-center">
            {expandButton}
            {isDialogMode && closeButton}
        </div>
    );

    return (
        <>
            <ErrorBoundary>
                {isDetailMode
                    ? <ResolvedDetailView
                        path={path}
                        layout={collection?.openEntityMode === "dialog" ? "dialog" : "side_panel"}
                        collection={collection as AdminCollection}
                        entityId={entityId!}
                        parentCollectionSlugs={parentCollectionSlugs}
                        parentEntityIds={parentEntityIds}
                        onEditClick={openEditView}
                        barActionsStart={barActionsStart}
                        barActions={() => windowControls(
                            allowFullScreen && <IconButton
                                className="self-center"
                                size={"small"}
                                onClick={() => {
                                    if (entityId) {
                                        const fullScreenUrl = urlController.buildUrlCollectionPath(`${path}/${entityId}`);
                                        navigate(fullScreenUrl, { state: null });
                                    }
                                }}>
                                <Maximize2Icon/>
                            </IconButton>
                        )}
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
                        collection={collection as AdminCollection}
                        parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                        onValuesModified={onValuesModified}
                        onSaved={onUpdate}
                        navigateBack={closeEditView}
                        barActionsStart={barActionsStart}
                        barActions={({ carryEdit }) => windowControls(
                            allowFullScreen && <IconButton
                                className="self-center"
                                size={"small"}
                                onClick={() => {
                                    // The form's own handoff, rather than a second
                                    // copy of the rules for it here: only an edit in
                                    // progress is worth carrying (a clean record
                                    // stashed anyway arrived announcing unsaved
                                    // changes to someone who had only looked at it),
                                    // and only the fields that were edited (carrying
                                    // the whole record marked every field touched).
                                    carryEdit?.();
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
                            </IconButton>
                        )}
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
