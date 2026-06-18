
import type { EntityCollection } from "@rebasepro/types";
import React, { lazy, Suspense } from "react";

import { useLargeLayout, useTranslation, useSlot, resolveComponentRef } from "@rebasepro/core";
import { CollectionActionsProps, EntityTableController, SelectionController } from "@rebasepro/types";
import { Button, IconButton, Tooltip, Popover, iconSize } from "@rebasepro/ui";
import { ErrorBoundary, MoreVerticalIcon, PlusIcon, Trash2Icon } from "@rebasepro/ui";
import { usePermissions } from "@rebasepro/core";
import { toArray } from "@rebasepro/utils";
// Lazy-load import/export — pulls in exceljs only on demand
const ImportCollectionAction = lazy(() => import("../../data_import/import").then(m => ({ default: m.ImportCollectionAction })));
const ExportCollectionAction = lazy(() => import("../../data_export/export").then(m => ({ default: m.ExportCollectionAction })));
import { EditorCollectionAction } from "../../collection_editor/ui/EditorCollectionAction";
import { useCollectionEditorController } from "../../collection_editor/useCollectionEditorController";
import { useCMSContext } from "../../index";

export type EntityCollectionViewActionsProps<M extends Record<string, unknown>> = {
    collection: EntityCollection<M>;
    path: string;
    relativePath: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    selectionEnabled: boolean;
    onNewClick: () => void;
    onMultipleDeleteClick: () => void;
    selectionController: SelectionController<M>;
    tableController: EntityTableController<M>;
    collectionEntitiesCount?: number;
    compact?: boolean;
    children?: React.ReactNode;
    openNewDocument: (defaultValues?: Record<string, unknown>) => void;
}

export function EntityCollectionViewActions<M extends Record<string, unknown>>({
    collection,
    relativePath,
    parentCollectionSlugs, parentEntityIds,
    onNewClick,
    onMultipleDeleteClick,
    selectionEnabled,
    path,
    selectionController,
    tableController,
    collectionEntitiesCount,
    compact,
    children,
    openNewDocument
}: EntityCollectionViewActionsProps<M>) {
    const context = useCMSContext();

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
                Add {collection.singularName ?? collection.name}
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

    const multipleDeleteEnabled = canDelete(collection, path, null);

    let multipleDeleteButton: React.ReactNode | undefined;
    {
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
            {addButton}
        </div>
    );
}
