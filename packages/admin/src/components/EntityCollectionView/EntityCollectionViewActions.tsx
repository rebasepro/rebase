
import type { EntityCollection } from "@rebasepro/types";
import React, { lazy, Suspense } from "react";

import { useLargeLayout, useTranslation, useSlot } from "@rebasepro/core";
import { CollectionActionsProps, EntityTableController, SelectionController } from "@rebasepro/types";
import { Button, IconButton, Tooltip, Popover, iconSize } from "@rebasepro/ui";
import { PlusIcon, Trash2Icon, MoreVerticalIcon } from "lucide-react";
import { ErrorBoundary } from "@rebasepro/ui";
import { usePermissions } from "@rebasepro/core";
import { toArray } from "@rebasepro/utils";
// Lazy-load import/export — pulls in xlsx (~800KB) only on demand
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
    children
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
                variant="filled"
                color="primary">
                Add {collection.singularName ?? collection.name}
            </Button>
            : <Button
                id={`add_entity_${path}`}
                onClick={onNewClick}
                variant={compact ? "filled" : "filled"}
                color={compact ? "neutral" : "primary"}
                size={compact ? "small" : "medium"}
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
        parentCollectionSlugs, parentEntityIds,
        collection,
        selectionController,
        context,
        tableController,
        collectionEntitiesCount
    };

    const actions = toArray(collection.Actions)
        .map((Action, i) => (
            <ErrorBoundary key={`actions_${i}`}>
                <Action {...actionProps}/>
            </ErrorBoundary>
        ));

    const pluginActions = useSlot("collection.actions", actionProps as any);

    const secondaryActions = (
        <>
            {children}
            <ErrorBoundary>
                {actions}
                {pluginActions}
            </ErrorBoundary>
            <ErrorBoundary>
                <Suspense fallback={null}>
                    <ImportCollectionAction {...(actionProps as any)}/>
                </Suspense>
            </ErrorBoundary>
            <ErrorBoundary>
                <Suspense fallback={null}>
                    <ExportCollectionAction {...(actionProps as any)}/>
                </Suspense>
            </ErrorBoundary>
            {hasCollectionEditor && (
                <ErrorBoundary>
                    <EditorCollectionAction {...(actionProps as any)}/>
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
