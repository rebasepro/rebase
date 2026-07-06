import type { CollectionConfig } from "@rebasepro/types";
import React, { MouseEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectionSize, Entity, FilterValues } from "@rebasepro/types";

import {
    CollectionRowActions,
    CollectionTableBinding
} from "../CollectionTableBinding";
import {
    useAuthController,
    useCustomizationController,
    useData,
    useDataTableController,
    useLargeLayout,
    usePermissions
} from "@rebasepro/core";
import { ErrorView } from "@rebasepro/core";
import { Button, DialogActions, PlusIcon, Typography } from "@rebasepro/ui";
import { IconForView } from "@rebasepro/core";
import { useSelectionController } from "../CollectionViewBinding/useSelectionController";

import { useColumnIds } from "@rebasepro/core";
import { useSideDialogContext } from "../SideDialogs";
import { useAnalyticsController } from "@rebasepro/core";
import { useUrlController, useSidePanel } from "../../index";

/**
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
    collection?: CollectionConfig<M>;

    /**
     * Absolute path of the collection.
     * May be not set if this hook is being used in a component and the path is
     * dynamic. If not set, the dialog won't open.
     */
    path: string;

    /**
     * If you are opening the dialog for the first time, you can select some
     * entity ids to be displayed first.
     */
    selectedEntityIds?: (string | number)[];

    /**
     * If `multiselect` is set to `false`, you will get the selected entity
     * in this callback.
     * @param entity
     * @callback
     */
    onSingleEntitySelected?(entity: Entity<any> | null): void;

    /**
     * If `multiselect` is set to `true`, you will get the selected entitys
     * in this callback.
     * @param entitys
     * @callback
     */
    onMultipleEntitysSelected?(entitys: Entity<any>[]): void;

    /**
     * Allow selection of entitys that pass the given filter only.
     */
    fixedFilter?: FilterValues<string>;

    /**
     * Use this description to indicate the user what to do in this dialog.
     */
    description?: React.ReactNode;

    /**
     * Maximum number of entitys that can be selected.
     */
    maxSelection?: number;

}

/**
 * This component allows to select entitys from a given collection.
 * You probably want to open this dialog as a side view using {@link useSelectionTableBinding}
 * @group Components
 */
export function SelectionTableBinding<M extends Record<string, unknown>>(
    props: SelectionProps<M>
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
        onMultipleEntitysSelected,
        multiselect,
        collection,
        path: pathInput,
        selectedEntityIds: selectedEntityIdsProp,
        description,
        fixedFilter,
        maxSelection
    }: SelectionProps<M> & { collection: CollectionConfig<M> }) {

    const sideDialogContext = useSideDialogContext();
    const sidePanelController = useSidePanel();
    const urlController = useUrlController();
    const analyticsController = useAnalyticsController();

    const path = urlController.resolveDatabasePathsFrom(pathInput);

    const dataClient = useData();

    const [entitysDisplayedFirst, setEntitysDisplayedFirst] = useState<Entity<any>[]>([]);

    const selectionController = useSelectionController();

    // Track whether the selection has been initialized to avoid
    // firing onMultipleEntitysSelected during the initial mount/fetch.
    const selectionInitializedRef = useRef(false);

    // Propagate selection changes to the parent callback.
    // This runs after the selectionController state updates, ensuring
    // we always send the correct, non-stale selection to the parent.
    useEffect(() => {
        if (!selectionInitializedRef.current) return;
        if (onMultipleEntitysSelected) {
            onMultipleEntitysSelected(selectionController.selectedEntitys);
        }
    }, [selectionController.selectedEntitys]);

    /**
     * Fetch initially selected ids
     */
    useEffect(() => {
        let unmounted = false;
        const selectedEntityIds = selectedEntityIdsProp?.map(id => id?.toString()).filter(Boolean);
        if (selectedEntityIds && selectedEntityIds.length > 0 && collection) {
            Promise.all(
                selectedEntityIds.map((entityId) =>
                    dataClient.collection(path).findById(entityId))
                )
                .then((entitys) => {
                    if (!unmounted) {
                        const result = entitys.filter((e): e is Entity<any> => !!e);
                        selectionController.setSelectedEntitys(result);
                        setEntitysDisplayedFirst(result);
                        // Mark initialized after the initial fetch completes
                        selectionInitializedRef.current = true;
                    }
                });
        } else {
            selectionController.setSelectedEntitys([]);
            setEntitysDisplayedFirst([]);
            selectionInitializedRef.current = true;
        }
        return () => {
            unmounted = true;
        };
    }, [dataClient, path, selectedEntityIdsProp, collection, selectionController.setSelectedEntitys]);

    const onClear = () => {
        analyticsController.onAnalyticsEvent?.("reference_selection_clear", {
            path
        });
        selectionController.setSelectedEntitys([]);
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
            // The useEffect above will propagate the change to onMultipleEntitysSelected.
            analyticsController.onAnalyticsEvent?.("reference_selection_toggle", {
                path,
                entityId: entity.id
            });
            const selectedEntitys = selectionController.selectedEntitys;
            if (selectedEntitys.map((e) => e.id).indexOf(entity.id) > -1) {
                selectionController.setSelectedEntitys(
                    selectedEntitys.filter((item: Entity<any>) => item.id !== entity.id)
                );
            } else {
                if (maxSelection && selectedEntitys.length >= maxSelection) return;
                selectionController.setSelectedEntitys([...selectedEntitys, entity]);
            }
        }
    }, [multiselect, onSingleEntitySelected, analyticsController, path, sideDialogContext, selectionController, maxSelection]);

    // create a new entity from within the reference dialog
    const onNewClick = () => {
        analyticsController.onAnalyticsEvent?.("reference_selection_new_entity", {
            path
        });
        sidePanelController.open({
            path: path,
            collection,
            updateUrl: true,
            onUpdate: ({ entity }) => {
                setEntitysDisplayedFirst([entity, ...entitysDisplayedFirst]);
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
        const selectedEntitys = selectionController.selectedEntitys;
        const isSelected = selectedEntitys && selectedEntitys.map(e => e.id).indexOf(entity.id) > -1;
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
        sideDialogContext.close(false);
    }, [sideDialogContext]);

    const displayedColumnIds = useColumnIds(collection, false);

    const tableController = useDataTableController<M>({
        path,
        collection,
        entitysDisplayedFirst,
        fixedFilter,
        updateUrl: false
    });

    return (

        <div className="flex flex-col h-full">

            <div className="grow">
                {entitysDisplayedFirst &&
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
                                ? `Select ${collection.singularName}`
                                : `Select from ${collection.name}`}
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
                    Done
                </Button>
            </DialogActions>
        </div>

    );

}

function EntitySelectionDialogActions({
    collection,
    path,
    onClear,
    onNewClick
}: {
    collection: CollectionConfig<any>,
    path: string,
    onClear: () => void,
    onNewClick: () => void
}) {

    const { canCreate } = usePermissions();

    const largeLayout = useLargeLayout();

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
                Add {collection.singularName ?? collection.name}
            </Button>
            : <Button
                onClick={onClick}>
                <PlusIcon/>
            </Button>);

    return (
        <>
            <Button onClick={onClear}
                variant={"text"}>
                Clear
            </Button>
            {addButton}
        </>
    );
}
