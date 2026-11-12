

import React, { Suspense } from "react";

import { useTranslation, useSlot } from "@rebasepro/app";
import { CollectionActionsProps, EntityTableController, EntitySelectionController, AdminCollection } from "@rebasepro/cms-types";
import { Button, IconButton, Tooltip, Popover, iconSize, lazyChunk } from "@rebasepro/ui";
import { ErrorBoundary, Link2Icon, MoreVerticalIcon, Trash2Icon, Unlink2Icon } from "@rebasepro/ui";
import { usePermissions } from "@rebasepro/app";
import { toArray } from "@rebasepro/utils";
// Lazy-load import/export — pulls in exceljs only on demand
const ImportCollectionAction = lazyChunk(() => import("../../data_import/import").then(m => ({ default: m.ImportCollectionAction })));
const ExportCollectionAction = lazyChunk(() => import("../../data_export/export").then(m => ({ default: m.ExportCollectionAction })));
import { EditorCollectionAction } from "../../collection_editor/ui/EditorCollectionAction";
import { useCollectionEditorController } from "../../collection_editor/useCollectionEditorController";
import { useAdminContext } from "../../hooks/useAdminContext";
import { useToolbarLabels } from "../CollectionTableBinding/internal/CollectionTableToolbar";
import { CollectionAddButton } from "./CollectionAddButton";
import { selectionControllerOf, tableControllerOf } from "@rebasepro/app";

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
    /**
     * The rows are shared with other records through a junction, so removing
     * them unlinks them from this record and deletes nothing. The bin says so.
     */
    removeUnlinks?: boolean;
    selectionController: EntitySelectionController<M>;
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
    removeUnlinks,
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

    const { canDelete } = usePermissions();

    const toolbarLabels = useToolbarLabels();
    // Labelled controls where the toolbar has room for them — a wide view
    // and labels that fit; their icon-only forms otherwise.
    const labelled = !compact && toolbarLabels;
    const { t } = useTranslation();

    // Check if the collection editor context is available (ConfigControllerProvider present)
    const collectionEditorController = useCollectionEditorController();
    const hasCollectionEditor = Boolean(collectionEditorController?.editCollection);

    const { selectedCount, hasSelection } = selectionController;

    const addButton = onNewClick &&
        <CollectionAddButton collection={collection} path={path} onClick={onNewClick} compact={Boolean(compact)}/>;

    // On a junction-backed tab, creating a row is only half of what "add" means:
    // the far more common act is attaching one that already exists. There was no
    // way to do that at all — the junction row was only ever written alongside an
    // insert — so a shared vocabulary could only ever grow.
    const linkButton = onAddExistingClick && (labelled
        ? <Button
            id={`link_entity_${path}`}
            onClick={onAddExistingClick}
            startIcon={<Link2Icon size={iconSize.small}/>}
            size="small"
            variant="outlined"
            color="neutral">
            {t("add_existing")}
        </Button>
        : <Tooltip title={t("add_existing")}>
            <Button
                id={`link_entity_${path}`}
                onClick={onAddExistingClick}
                variant="outlined"
                color="neutral"
                size="small">
                <Link2Icon size={iconSize.small}/>
            </Button>
        </Tooltip>);

    const multipleDeleteEnabled = canDelete(collection, path, null);

    // Only once something is selected. A permanently-disabled bin sat in every
    // collection toolbar — and in the split view, where the toolbar is a narrow
    // strip above the list, it was a third of the visible controls doing
    // nothing. It appears the moment you tick a row, which is when you want it.

    // `undefined` is "every matching row, and nobody knows how many" — a full
    // selection against an accessor with no `count`. Rendering it as 0 would
    // say the opposite of what is true.
    const countLabel = selectedCount === undefined ? "…" : selectedCount.toLocaleString();

    let multipleDeleteButton: React.ReactNode | undefined;
    if (hasSelection) {
        const RemoveIcon = removeUnlinks ? Unlink2Icon : Trash2Icon;
        // What the button does, in both forms. The labelled one's only text is
        // the count, so without it a screen reader announced "(1)".
        const actionLabel = removeUnlinks ? t("remove_from_record") : t("delete_selected");
        const button = labelled
            // `min-w`, not `w`. A fixed 80px was enough for the one- and
            // two-digit counts you could reach by ticking rows; "select all
            // matching" put six digits in here, and a flex child over its width
            // compresses — so the bin itself was what gave way, shrinking to a
            // sliver beside the number. The width is a floor now, so the
            // control still holds its place in the toolbar when the count is
            // short, and `shrink-0` means the icon can never be the thing that
            // gives.
            ? <Button
                variant={"text"}
                aria-label={`${actionLabel} (${countLabel})`}
                disabled={!multipleDeleteEnabled}
                startIcon={<RemoveIcon size={iconSize.small} className={"shrink-0"}/>}
                onClick={onMultipleDeleteClick}
                color={"neutral"}
                className="@5xl/collection:min-w-20"
            >
                ({countLabel})
            </Button>
            : <IconButton aria-label={actionLabel}
                size={"small"}
                disabled={!multipleDeleteEnabled}
                onClick={onMultipleDeleteClick}>
                <RemoveIcon size={iconSize.small}/>
            </IconButton>;
        multipleDeleteButton =
            <Tooltip
                title={multipleDeleteEnabled
                    ? (removeUnlinks ? t("remove_from_record") : t("delete"))
                    : t("delete_not_allowed")}>
                {button}
            </Tooltip>
    }

    // The admin's own actions read the records; an app's are handed rows.
    const builtInActionProps = {
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
    const actionProps: CollectionActionsProps<M> = {
        ...builtInActionProps,
        selectionController: selectionControllerOf(selectionController, collection, path),
        tableController: tableControllerOf(tableController, collection)
    };

    const actions = toArray(collection.Actions)
        .map((Action, i) => {
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
            {collection.exportable !== false && (
                <ErrorBoundary>
                    <Suspense fallback={null}>
                        <ExportCollectionAction {...builtInActionProps}/>
                    </Suspense>
                </ErrorBoundary>
            )}
            {hasCollectionEditor && (
                <ErrorBoundary>
                    <EditorCollectionAction {...builtInActionProps}/>
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
                        <IconButton aria-label={t("more_actions")} size="small">
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
