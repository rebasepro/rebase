
import React, { MouseEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, FilterValues } from "@rebasepro/types";
import { CollectionSize, AdminCollection } from "@rebasepro/cms-types";

import {
    CollectionRowActions,
    CollectionTableBinding
} from "../CollectionTableBinding";
import {
    CollectionScopeProvider,
    useAuthController,
    useCustomizationController,
    useData,
    useDataTableController,
    usePermissions,
    useTranslation
} from "@rebasepro/app";
import { ErrorView } from "@rebasepro/app";
import { Button, DialogActions, PlusIcon, Typography, useElementWidth } from "@rebasepro/ui";
import { IconForView } from "@rebasepro/app";
import { useEntitySelectionController } from "../CollectionViewBinding/useSelectionController";
import { CollectionViewLayoutContext, LARGE_COLLECTION_WIDTH, useCollectionLargeLayout } from "../CollectionViewBinding/useCollectionLargeLayout";

import { useColumnIds } from "@rebasepro/app";
import { useSideDialogContext } from "../SideDialogs";
import { useAnalyticsController } from "@rebasepro/app";
import { useUrlController } from "../../hooks/navigation/contexts/UrlContext";
import { useSidePanel } from "../../hooks/useSidePanel";
import { findEntitiesByIds } from "../../util/find_entities_by_ids";
import { entityOfRow, rowOfEntity } from "@rebasepro/app";

/** Stable identity, so the effect that propagates the picks does not re-fire. */
const EMPTY_ENTITIES: Entity<any>[] = [];

/**
 * What {@link useSelectionDialog} and {@link SelectionTableBinding} take: a
 * collection to pick rows from, and what to do with the rows picked. The rows
 * are the server's, as `useRows` returns them, and each callback is handed
 * their ids beside them — the strings `selectedIds` and `useSidePanel().open`
 * take.
 *
 * @group Components
 */
export interface SelectionProps<M extends Record<string, unknown>> {

    /**
     * Allow multiple selection of values
     */
    multiselect?: boolean;

    /**
     * Entity collection config
     */
    collection?: AdminCollection<M>;

    /**
     * Absolute path of the collection.
     * May be not set if this hook is being used in a component and the path is
     * dynamic. If not set, the dialog won't open.
     */
    path: string;

    /**
     * The ids of the rows to show as selected, and first, when the dialog
     * opens.
     */
    selectedIds?: (string | number)[];

    /**
     * If `multiselect` is `false`: the row picked and its id, or `null` when
     * the selection is cleared.
     * @callback
     */
    onSingleRowSelected?(row: Record<string, unknown> | null, id: string | null): void;

    /**
     * If `multiselect` is `true`: the rows selected and their ids, on every tick.
     * @callback
     */
    onMultipleRowsSelected?(rows: Record<string, unknown>[], ids: string[]): void;

    /**
     * Called once, with the rows finally selected and their ids, when the
     * user presses Done.
     *
     * `onMultipleRowsSelected` reports every tick as it happens, which is
     * right when the selection *is* the value (a reference field). Use this
     * one instead when acting on the selection writes something — linking
     * rows, say — so a row ticked and then unticked, or a selection cleared,
     * is never acted on.
     * @callback
     */
    onSelectionDone?(rows: Record<string, unknown>[], ids: string[]): void;

    /**
     * Allow selection of entities that pass the given filter only.
     */
    fixedFilter?: FilterValues<string>;

    /**
     * Use this description to indicate the user what to do in this dialog.
     */
    description?: React.ReactNode;

    /**
     * Maximum number of entities that can be selected.
     */
    maxSelection?: number;

}

/**
 * The admin's own picker props: {@link SelectionProps} over its `Entity` view
 * model, for the reference and relation fields, which build their values from
 * the records picked.
 *
 * @internal
 */
export interface EntitySelectionProps<M extends Record<string, unknown>> extends Omit<SelectionProps<M>,
    "selectedIds" | "onSingleRowSelected" | "onMultipleRowsSelected" | "onSelectionDone"> {
    selectedEntityIds?: (string | number)[];
    onSingleEntitySelected?(entity: Entity<any> | null): void;
    onMultipleEntitiesSelected?(entities: Entity<any>[]): void;
    onSelectionDone?(entities: Entity<M>[]): void;
}

function idsOf(entities: Entity<any>[]): string[] {
    return entities.map((entity) => String(entity.id));
}

/**
 * Pick rows from a collection, in a table. You probably want to open it as a
 * side dialog with {@link useSelectionDialog}.
 *
 * @group Components
 */
export function SelectionTableBinding<M extends Record<string, unknown>>(props: SelectionProps<M>) {
    return <EntitySelectionTable<M> {...entitySelectionPropsOf(props)}/>;
}

/**
 * {@link SelectionProps} as the admin's own picker takes them: each callback
 * handed the rows of the records picked.
 *
 * @internal
 */
export function entitySelectionPropsOf<M extends Record<string, unknown>>({
    selectedIds,
    onSingleRowSelected,
    onMultipleRowsSelected,
    onSelectionDone,
    ...props
}: SelectionProps<M>): EntitySelectionProps<M> {
    const collection = props.collection;
    return {
        ...props,
        selectedEntityIds: selectedIds,
        onSingleEntitySelected: onSingleRowSelected
            && ((entity) => onSingleRowSelected(entity ? rowOfEntity(entity, collection) : null, entity ? String(entity.id) : null)),
        onMultipleEntitiesSelected: onMultipleRowsSelected
            && ((entities) => onMultipleRowsSelected(entities.map((entity) => rowOfEntity(entity, collection)), idsOf(entities))),
        onSelectionDone: onSelectionDone
            && ((entities) => onSelectionDone(entities.map((entity) => rowOfEntity(entity, collection)), idsOf(entities)))
    };
}

/**
 * The admin's own picker, over its `Entity` view model.
 *
 * @internal
 */
export function EntitySelectionTable<M extends Record<string, unknown>>(
    props: EntitySelectionProps<M>
) {
    if (!props.collection) {
        return <ErrorView
            error={"Could not find collection"}/>
    }
    return <SelectionTableBindingInternal {...props} collection={props.collection} />;
}

function SelectionTableBindingInternal<M extends Record<string, unknown>>(
    {
        onSingleEntitySelected,
        onMultipleEntitiesSelected,
        onSelectionDone,
        multiselect,
        collection,
        path: pathInput,
        selectedEntityIds: selectedEntityIdsProp,
        description,
        fixedFilter,
        maxSelection
    }: EntitySelectionProps<M> & { collection: AdminCollection<M> }) {

    const sideDialogContext = useSideDialogContext();
    const sidePanelController = useSidePanel();
    const urlController = useUrlController();
    const analyticsController = useAnalyticsController();
    const { t } = useTranslation();

    const path = urlController.resolveDatabasePathsFrom(pathInput);

    const dataClient = useData();

    const [entitiesDisplayedFirst, setEntitiesDisplayedFirst] = useState<Entity<any>[]>([]);

    // Explicitly `<M>`: the hook defaults to `Record<string, unknown>`, and the
    // controller is handed to a table typed `EntitySelectionController<M>`. `Entity<M>`
    // sits on both sides of that interface (`selectedEntities` out,
    // `toggleEntitySelection` in), so the default was never actually assignable
    // here — it only looked fine while the surrounding props gave TypeScript no
    // reason to bind `M` to this component's own parameter.
    const selectionController = useEntitySelectionController<M>();

    // The rows picked in this dialog.
    //
    // This surface never enters query mode: it offers no "select all matching",
    // because pointing a reference field at every row of a collection is not
    // something anyone means to do, and `maxSelection` could not be enforced
    // against a count nobody has read yet. Every write below goes through
    // `setSelectedEntities`, so the query branch is unreachable here.
    const selectedEntities = selectionController.selection.type === "entities"
        ? selectionController.selection.entities
        : EMPTY_ENTITIES;

    // Track whether the selection has been initialized to avoid
    // firing onMultipleEntitiesSelected during the initial mount/fetch.
    const selectionInitializedRef = useRef(false);

    // Propagate selection changes to the parent callback.
    // This runs after the selectionController state updates, ensuring
    // we always send the correct, non-stale selection to the parent.
    useEffect(() => {
        if (!selectionInitializedRef.current) return;
        if (onMultipleEntitiesSelected) {
            onMultipleEntitiesSelected(selectedEntities);
        }
    }, [selectedEntities]);

    /**
     * Fetch initially selected ids
     */
    useEffect(() => {
        let unmounted = false;
        const selectedEntityIds = selectedEntityIdsProp?.map(id => id?.toString()).filter(Boolean);
        if (selectedEntityIds && selectedEntityIds.length > 0 && collection) {
            // One request per 1,000 ids, not one per id (see findEntitiesByIds).
            findEntitiesByIds(dataClient.collection<M>(path), collection, selectedEntityIds)
                .then((found) => {
                    if (!unmounted) {
                        // In the order given; an id with no row is dropped.
                        const result = selectedEntityIds
                            .map(id => found.get(id))
                            .filter((e): e is Entity<any> => !!e);
                        selectionController.setSelectedEntities(result);
                        setEntitiesDisplayedFirst(result);
                        // Mark initialized after the initial fetch completes
                        selectionInitializedRef.current = true;
                    }
                });
        } else {
            selectionController.setSelectedEntities([]);
            setEntitiesDisplayedFirst([]);
            selectionInitializedRef.current = true;
        }
        return () => {
            unmounted = true;
        };
    }, [dataClient, path, selectedEntityIdsProp, collection, selectionController.setSelectedEntities]);

    const onClear = () => {
        analyticsController.onAnalyticsEvent?.("reference_selection_clear", {
            path
        });
        selectionController.setSelectedEntities([]);
        if (!multiselect && onSingleEntitySelected) {
            onSingleEntitySelected(null);
        }
    };

    const onEntityClick = useCallback((entity: Entity<any>) => {
        if (!multiselect && onSingleEntitySelected) {
            analyticsController.onAnalyticsEvent?.("reference_selected_single", {
                path,
                entityId: entity.id
            });
            onSingleEntitySelected(entity);
            sideDialogContext.close(false);
        } else {
            // For multiselect, delegate to the selection controller's toggle.
            // The useEffect above will propagate the change to onMultipleEntitiesSelected.
            analyticsController.onAnalyticsEvent?.("reference_selection_toggle", {
                path,
                entityId: entity.id
            });
            if (selectedEntities.some((e) => String(e.id) === String(entity.id))) {
                selectionController.setSelectedEntities(
                    selectedEntities.filter((item: Entity<any>) => String(item.id) !== String(entity.id))
                );
            } else {
                if (maxSelection && selectedEntities.length >= maxSelection) return;
                selectionController.setSelectedEntities([...selectedEntities, entity]);
            }
        }
    }, [multiselect, onSingleEntitySelected, analyticsController, path, sideDialogContext, selectionController, selectedEntities, maxSelection]);

    // create a new entity from within the reference dialog
    const onNewClick = () => {
        analyticsController.onAnalyticsEvent?.("reference_selection_new_entity", {
            path
        });
        sidePanelController.open({
            path: path,
            collection,
            // No URL, for the reason `RelationSelector` does the same: this
            // panel is a step inside the selection dialog, which is itself a
            // step inside whatever form opened it. `useUnsavedChangesDialog`
            // blocks on a *pathname* change, and this panel's path is a
            // different collection from the one being edited — so closing it
            // raced the panel clearing its own dirty flag and answered a
            // successful save with "There are unsaved changes", leaving the URL
            // on the target collection. A record that does not exist yet has no
            // address worth restoring anyway.
            updateUrl: false,
            onSaved: ({ row, id }) => {
                const entity = entityOfRow(row, id, path, collection);
                setEntitiesDisplayedFirst([entity, ...entitiesDisplayedFirst]);
                onEntityClick(entity);
            },
            closeOnSave: true
        });
    };

    const tableRowActionsBuilder = ({
        entity,
        size,
        width,
        frozen
    }: {
        entity: Entity<any>,
        size: CollectionSize,
        width: number,
        frozen?: boolean
    }) => {
        const isSelected = selectionController.isEntitySelected(entity);
        return <CollectionRowActions
            width={width}
            frozen={frozen}
            entity={entity}
            size={size}
            isSelected={isSelected}
            selectionEnabled={multiselect}
            hideId={collection?.hideIdFromCollection}
            path={path}
            selectionController={selectionController}
            openEntityMode={"side_panel"}
        />;

    };

    const onDone = useCallback((event: React.SyntheticEvent) => {
        event.stopPropagation();
        onSelectionDone?.(selectedEntities);
        sideDialogContext.close(false);
    }, [sideDialogContext, onSelectionDone, selectedEntities]);

    const displayedColumnIds = useColumnIds(collection, false);

    const tableController = useDataTableController<M>({
        path,
        collection,
        entitiesDisplayedFirst,
        fixedFilter,
        updateUrl: false
    });

    // The picker lays its table out by its own width, as a collection view
    // does: a dialog is narrow in a wide window.
    const [measureRef, width] = useElementWidth<HTMLDivElement>();
    const large = width > 0 ? width >= LARGE_COLLECTION_WIDTH : undefined;

    return (

        <CollectionScopeProvider collection={collection}>
        <CollectionViewLayoutContext.Provider value={large}>
        <div className="@container/collection flex flex-col h-full" ref={measureRef}>

            <div className="grow">
                {entitiesDisplayedFirst &&
                    <CollectionTableBinding
                        additionalFields={collection.additionalFields}
                        displayedColumnIds={displayedColumnIds}
                        onEntityClick={onEntityClick}
                        tableController={tableController}
                        enablePopupIcon={false}
                        tableRowActionsBuilder={tableRowActionsBuilder}
                        openEntityMode={"side_panel"}
                        title={<Typography variant={"subtitle2"} className={"flex flex-row gap-2"}>
                            <IconForView
                                size={"small"}
                                collectionOrView={collection}
                                className={"text-surface-300 dark:text-surface-600"}/>
                            {collection.singularName
                                ? t("select_specific", { name: collection.singularName })
                                : t("select_from", { name: collection.name })}
                        </Typography>}
                        defaultSize={collection.defaultSize}
                        properties={collection.properties}
                        fixedFilter={fixedFilter}
                        inlineEditing={false}
                        selectionController={selectionController}
                        actions={<EntitySelectionDialogActions
                            collection={collection}
                            path={path}
                            onNewClick={onNewClick}
                            onClear={onClear}/>
                        }
                    />}
            </div>
            <DialogActions translucent={false}>
                {description &&
                    <Typography variant={"body2"}
                        className="grow text-left">
                        {description}
                    </Typography>}
                <Button
                    onClick={onDone}
                    variant="filled">
                    {t("done")}
                </Button>
            </DialogActions>
        </div>
        </CollectionViewLayoutContext.Provider>
        </CollectionScopeProvider>

    );

}

function EntitySelectionDialogActions({
    collection,
    path,
    onClear,
    onNewClick
}: {
    collection: AdminCollection<any>,
    path: string,
    onClear: () => void,
    onNewClick: () => void
}) {

    const { canCreate } = usePermissions();

    const largeLayout = useCollectionLargeLayout();
    const { t } = useTranslation();

    const onClick: MouseEventHandler<HTMLButtonElement> | undefined = onNewClick
        ? (e) => {
            e.preventDefault();
            onNewClick();
        }
        : undefined;
    const addButton = canCreate(collection, path) &&
        onClick && (largeLayout
            ? <Button
                onClick={onClick}
                startIcon={<PlusIcon/>}>
                {t("add_specific", { name: collection.singularName ?? collection.name })}
            </Button>
            : <Button
                onClick={onClick}>
                <PlusIcon/>
            </Button>);

    return (
        <>
            <Button onClick={onClear}
                variant={"text"}>
                {t("clear")}
            </Button>
            {addButton}
        </>
    );
}
