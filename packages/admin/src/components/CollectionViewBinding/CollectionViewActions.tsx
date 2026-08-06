

import React, { lazy, Suspense } from "react";

import { useLargeLayout, useTranslation, useSlot, resolveComponentRef } from "@rebasepro/app";
import { CollectionActionsProps, EntityTableController, SelectionController, AdminCollection } from "@rebasepro/admin-types";
import { Button, IconButton, Tooltip, Popover, iconSize } from "@rebasepro/ui";
import { ErrorBoundary, Link2Icon, MoreVerticalIcon, PlusIcon, Trash2Icon } from "@rebasepro/ui";
import { usePermissions } from "@rebasepro/app";
import { toArray } from "@rebasepro/utils";
// Lazy-load import/export — pulls in exceljs only on demand
const ImportCollectionAction = lazy(() => import("../../data_import/import").then(m => ({ default: m.ImportCollectionAction })));
const ExportCollectionAction = lazy(() => import("../../data_export/export").then(m => ({ default: m.ExportCollectionAction })));
import { EditorCollectionAction } from "../../collection_editor/ui/EditorCollectionAction";
import { useCollectionEditorController } from "../../collection_editor/useCollectionEditorController";
import { useAdminContext } from "../../hooks/useAdminContext";

export type CollectionViewActionsProps<M extends Record<string, unknown>> = {
    collection: AdminCollection<M>;
    path: string;
    relativePath: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    selectionEnabled: boolean;
    onNewClick: () => void;
    /**
     * Attach a row that already exists to this parent. Only supplied for a
     * junction-backed tab, where the parent owns the link rather than the row.
     */
    onAddExistingClick?: () => void;
    onMultipleDeleteClick: () => void;
    selectionController: SelectionController<M>;
    tableController: EntityTableController<M>;
    collectionEntitiesCount?: number;
    compact?: boolean;
    children?: React.ReactNode;
    openNewDocument: (defaultValues?: Record<string, unknown>) => void;
}

export function CollectionViewActions<M extends Record<string, unknown>>({
    collection,
    relativePath,
    parentCollectionSlugs, parentEntityIds,
    onNewClick,
    onAddExistingClick,
    onMultipleDeleteClick,
    selectionEnabled,
    path,
    selectionController,
    tableController,
    collectionEntitiesCount,
    compact,
    children,
    openNewDocument
}: CollectionViewActionsProps<M>) {
    const context = useAdminContext();

    const { canCreate, canDelete } = usePermissions();

    const largeLayout = useLargeLayout();
    const { t } = useTranslation();

    // Check if the collection editor context is available (ConfigControllerProvider present)
    const collectionEditorController = useCollectionEditorController();
    const hasCollectionEditor = Boolean(collectionEditorController?.editCollection);

    const selectedEntities = selectionController.selectedEntities;

    const addButton = canCreate(collection, path) &&
        onNewClick && (largeLayout && !compact
            ? <Button
                id={`add_entity_${path}`}
                onClick={onNewClick}
                startIcon={<PlusIcon size={iconSize.small}/>}
                size="small"
                variant="filled"
                color="primary">
                {t("add_specific", { name: collection.singularName ?? collection.name })}
            </Button>
            : <Button
                id={`add_entity_${path}`}
                onClick={onNewClick}
                variant="filled"
                color={compact ? "neutral" : "primary"}
                size="small"
            >
                <PlusIcon size={iconSize.small}/>
            </Button>);

    // On a junction-backed tab, creating a row is only half of what "add" means:
    // the far more common act is attaching one that already exists. There was no
    // way to do that at all — the junction row was only ever written alongside an
    // insert — so a shared vocabulary could only ever grow.
    const linkButton = onAddExistingClick && (largeLayout && !compact
        ? <Button
            id={`link_entity_${path}`}
            onClick={onAddExistingClick}
            startIcon={<Link2Icon size={iconSize.small}/>}
            size="small"
            variant="outlined"
            color="primary">
            {t("add_existing") ?? "Add existing"}
        </Button>
        : <Tooltip title={t("add_existing") ?? "Add existing"}>
            <Button
                id={`link_entity_${path}`}
                onClick={onAddExistingClick}
                variant="outlined"
                color={compact ? "neutral" : "primary"}
                size="small">
                <Link2Icon size={iconSize.small}/>
            </Button>
        </Tooltip>);

    const multipleDeleteEnabled = canDelete(collection, path, null);

    // Only once something is selected. A permanently-disabled bin sat in every
    // collection toolbar — and in the split view, where the toolbar is a narrow
    // strip above the list, it was a third of the visible controls doing
    // nothing. It appears the moment you tick a row, which is when you want it.
    const hasSelection = Boolean(selectedEntities?.length);

    let multipleDeleteButton: React.ReactNode | undefined;
    if (hasSelection) {
        const button = largeLayout && !compact
            ? <Button
                variant={"text"}
                disabled={!(selectedEntities?.length) || !multipleDeleteEnabled}
                startIcon={<Trash2Icon size={iconSize.small}/>}
                onClick={onMultipleDeleteClick}
                color={"primary"}
                className="lg:w-20"
            >
                ({selectedEntities?.length})
            </Button>
            : <IconButton
                size={"small"}
                color={"primary"}
                disabled={!(selectedEntities?.length) || !multipleDeleteEnabled}
                onClick={onMultipleDeleteClick}>
                <Trash2Icon size={iconSize.small}/>
            </IconButton>;
        multipleDeleteButton =
            <Tooltip
                title={multipleDeleteEnabled ? t("delete") : t("delete_not_allowed")}>
                {button}
            </Tooltip>
    }

    const actionProps: CollectionActionsProps<M> = {
        path,
        relativePath,
        parentCollectionSlugs,
parentEntityIds,
        collection,
        selectionController,
        context,
        tableController,
        collectionEntitiesCount,
        openNewDocument
    };

    const actions = toArray(collection.Actions)
        .map((actionRef, i) => {
            const Action = resolveComponentRef(actionRef);
            if (!Action) return null;
            return (
                <ErrorBoundary key={`actions_${i}`}>
                    <Suspense fallback={null}>
                        <Action {...actionProps}/>
                    </Suspense>
                </ErrorBoundary>
            );
        });

    const pluginActions = useSlot("collection.actions", actionProps as CollectionActionsProps);

    const secondaryActions = (
        <>
            {children}
            <ErrorBoundary>
                {actions}
                {pluginActions}
            </ErrorBoundary>
            <ErrorBoundary>
                <Suspense fallback={null}>
                    <ImportCollectionAction {...(actionProps as CollectionActionsProps)}/>
                </Suspense>
            </ErrorBoundary>
            <ErrorBoundary>
                <Suspense fallback={null}>
                    <ExportCollectionAction {...(actionProps as CollectionActionsProps)}/>
                </Suspense>
            </ErrorBoundary>
            {hasCollectionEditor && (
                <ErrorBoundary>
                    <EditorCollectionAction {...(actionProps as CollectionActionsProps)}/>
                </ErrorBoundary>
            )}
        </>
    );

    const [overflowOpen, setOverflowOpen] = React.useState(false);

    return (
        <div className="flex items-center gap-1">
            {!compact ? (
                secondaryActions
            ) : (
                <Popover
                    open={overflowOpen}
                    onOpenChange={setOverflowOpen}
                    trigger={
                        <IconButton size="small">
                            <MoreVerticalIcon size={iconSize.smallest}/>
                        </IconButton>
                    }>
                    <div className="flex flex-row items-center gap-1 p-2">
                        {secondaryActions}
                    </div>
                </Popover>
            )}
            {multipleDeleteButton}
            {linkButton}
            {addButton}
        </div>
    );
}
