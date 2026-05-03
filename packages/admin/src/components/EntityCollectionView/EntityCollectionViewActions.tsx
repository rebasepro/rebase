import type { EntityCollection } from "@rebasepro/types";
import React from "react";

import { useAuthController, useLargeLayout, useTranslation, useSlot } from "@rebasepro/core";
import { CollectionActionsProps, EntityTableController, SelectionController, ViewMode } from "@rebasepro/types";
import {
    AddIcon,
    Button,
    DeleteIcon,
    IconButton,
    Tooltip,
    Popover,
    MoreVertIcon
} from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { usePermissions } from "@rebasepro/core";
import { toArray } from "@rebasepro/utils";
import { ImportCollectionAction } from "../../data_import/import";
import { ExportCollectionAction } from "../../data_export/export";
import { EditorCollectionAction } from "../../collection_editor/ui/EditorCollectionAction";
import { useCollectionEditorController } from "../../collection_editor/useCollectionEditorController";
import { useCMSContext } from "../../index";

export type EntityCollectionViewActionsProps<M extends Record<string, unknown>> = {
    collection: EntityCollection<M>;
    path: string;
    relativePath: string;
    parentCollectionIds: string[];
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
    parentCollectionIds,
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
                startIcon={<AddIcon size={"small"} />}
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
                <AddIcon size={"small"} />
            </Button>);

    const multipleDeleteEnabled = canDelete(collection, path, null);

    let multipleDeleteButton: React.ReactNode | undefined;
    if (selectionEnabled && !compact) {
        const button = largeLayout
            ? <Button
                variant={"text"}
                disabled={!(selectedEntities?.length) || !multipleDeleteEnabled}
                startIcon={<DeleteIcon size={"small"} />}
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
                <DeleteIcon size={"small"} />
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
        parentCollectionIds,
        collection,
        selectionController,
        context,
        tableController,
        collectionEntitiesCount
    };

    const actions = toArray(collection.Actions)
        .map((Action, i) => (
            <ErrorBoundary key={`actions_${i}`}>
                <Action {...actionProps} />
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
                <ImportCollectionAction {...(actionProps as any)} />
            </ErrorBoundary>
            <ErrorBoundary>
                <ExportCollectionAction {...(actionProps as any)} />
            </ErrorBoundary>
            {hasCollectionEditor && (
                <ErrorBoundary>
                    <EditorCollectionAction {...(actionProps as any)} />
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
                            <MoreVertIcon size="small" />
                        </IconButton>
                    }>
                    <div className="flex flex-col gap-1 p-2 min-w-[200px]" onClick={() => setOverflowOpen(false)}>
                        {secondaryActions}
                    </div>
                </Popover>
            )}
            {multipleDeleteButton}
            {addButton}
        </div>
    );
}
