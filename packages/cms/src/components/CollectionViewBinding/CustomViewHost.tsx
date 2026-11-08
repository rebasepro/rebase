import React, { useCallback, useMemo, useRef } from "react";
import type { Entity } from "@rebasepro/types";
import type {
    AdminCollection,
    CollectionCustomViewParams,
    CollectionSize,
    EntitySelectionController,
    EntityTableController,
    ViewMode
} from "@rebasepro/cms-types";
import { entityOfRow, idOfRow, selectionControllerOf, tableControllerOf } from "@rebasepro/app";

const NO_IDS: string[] = [];

/** What the view holds, in its own view model, for a custom view to be drawn from. */
export interface CustomViewHostProps<M extends Record<string, unknown>> {
    Builder: React.ComponentType<CollectionCustomViewParams<M>>;
    collection: AdminCollection<M>;
    tableController: EntityTableController<M>;
    path: string;
    parentCollectionSlugs?: string[];
    parentEntityIds?: string[];
    onEntityClick?: (entity: Entity<M>) => void;
    onNewClick?: () => void;
    canCreate?: boolean;
    selectionController?: EntitySelectionController<M>;
    selectionEnabled?: boolean;
    highlightedEntities?: Entity<M>[];
    deletedEntities?: Entity<M>[];
    emptyComponent?: React.ReactNode;
    size?: CollectionSize;
    viewMode?: ViewMode;
}

/**
 * A custom view's `Builder`, handed what the view holds as an app's code
 * reads it: the rows as the server sends them, ids for what is highlighted
 * and deleted, and a click that takes a row.
 */
export function CustomViewHost<M extends Record<string, unknown>>({
    Builder,
    collection,
    tableController,
    path,
    parentCollectionSlugs,
    parentEntityIds,
    onEntityClick,
    onNewClick,
    canCreate,
    selectionController,
    selectionEnabled,
    highlightedEntities,
    deletedEntities,
    emptyComponent,
    size,
    viewMode
}: CustomViewHostProps<M>) {
    const rowTableController = tableControllerOf(tableController, collection);
    const rowSelectionController = selectionController
        ? selectionControllerOf(selectionController, collection, path)
        : undefined;
    const highlightedIds = useMemo(
        () => highlightedEntities?.length ? highlightedEntities.map((entity) => String(entity.id)) : NO_IDS,
        [highlightedEntities]);
    const deletedIds = useMemo(
        () => deletedEntities?.length ? deletedEntities.map((entity) => String(entity.id)) : NO_IDS,
        [deletedEntities]);

    // Through a ref, so the view is not redrawn when the handler is.
    const latest = useRef({ onEntityClick, collection, path });
    latest.current = { onEntityClick, collection, path };
    const hasClick = onEntityClick !== undefined;
    const onRowClick = useCallback((row: Record<string, unknown>) => {
        const { onEntityClick, collection, path } = latest.current;
        const id = idOfRow(row, collection);
        if (id === undefined) return;
        onEntityClick?.(entityOfRow(row, id, path, collection) as Entity<M>);
    }, []);

    return (
        <Builder
            collection={collection}
            tableController={rowTableController}
            path={path}
            parentCollectionSlugs={parentCollectionSlugs}
            parentEntityIds={parentEntityIds}
            onRowClick={hasClick ? onRowClick : undefined}
            onNewClick={onNewClick}
            canCreate={canCreate}
            selectionController={rowSelectionController}
            selectionEnabled={selectionEnabled}
            highlightedIds={highlightedIds}
            deletedIds={deletedIds}
            emptyComponent={emptyComponent}
            size={size}
            viewMode={viewMode}
        />
    );
}
