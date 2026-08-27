
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
    useLargeLayout,
    usePermissions,
    useTranslation
} from "@rebasepro/app";
import { ErrorView } from "@rebasepro/app";
import { Button, DialogActions, PlusIcon, Typography } from "@rebasepro/ui";
import { IconForView } from "@rebasepro/app";
import { useSelectionController } from "../CollectionViewBinding/useSelectionController";

import { useColumnIds } from "@rebasepro/app";
import { useSideDialogContext } from "../SideDialogs";
import { useAnalyticsController } from "@rebasepro/app";
import { useUrlController } from "../../hooks/navigation/contexts/UrlContext";
import { useSidePanel } from "../../hooks/useSidePanel";

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
    collection?: AdminCollection<M>;

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
     * If `multiselect` is set to `true`, you will get the selected entities
     * in this callback.
     * @param entities
     * @callback
     */
    onMultipleEntitiesSelected?(entities: Entity<any>[]): void;

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
 * This component allows to select entities from a given collection.
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
        onMultipleEntitiesSelected,
        multiselect,
        collection,
        path: pathInput,
        selectedEntityIds: selectedEntityIdsProp,
        description,
        fixedFilter,
        maxSelection
    }: SelectionProps<M> & { collection: AdminCollection<M> }) {

    const sideDialogContext = useSideDialogContext();
    const sidePanelController = useSidePanel();
    const urlController = useUrlController();
    const analyticsController = useAnalyticsController();

    const path = urlController.resolveDatabasePathsFrom(pathInput);

    const dataClient = useData();

    const [entitiesDisplayedFirst, setEntitiesDisplayedFirst] = useState<Entity<any>[]>([]);

    // Explicitly `<M>`: the hook defaults to `Record<string, unknown>`, and the
    // controller is handed to a table typed `SelectionController<M>`. `Entity<M>`
    // sits on both sides of that interface (`selectedEntities` out,
    // `toggleEntitySelection` in), so the default was never actually assignable
    // here — it only looked fine while the surrounding props gave TypeScript no
    // reason to bind `M` to this component's own parameter.
    const selectionController = useSelectionController<M>();

    // Track whether the selection has been initialized to avoid
    // firing onMultipleEntitiesSelected during the initial mount/fetch.
    const selectionInitializedRef = useRef(false);

    // Propagate selection changes to the parent callback.
    // This runs after the selectionController state updates, ensuring
    // we always send the correct, non-stale selection to the parent.
    useEffect(() => {
        if (!selectionInitializedRef.current) return;
        if (onMultipleEntitiesSelected) {
            onMultipleEntitiesSelected(selectionController.selectedEntities);
        }
    }, [selectionController.selectedEntities]);

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
                .then((entities) => {
                    if (!unmounted) {
                        const result = entities.filter((e): e is Entity<any> => !!e);
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
            const selectedEntities = selectionController.selectedEntities;
            if (selectedEntities.map((e) => e.id).indexOf(entity.id) > -1) {
                selectionController.setSelectedEntities(
                    selectedEntities.filter((item: Entity<any>) => item.id !== entity.id)
                );
            } else {
                if (maxSelection && selectedEntities.length >= maxSelection) return;
                selectionController.setSelectedEntities([...selectedEntities, entity]);
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
            onUpdate: ({ entity }) => {
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
        const selectedEntities = selectionController.selectedEntities;
        const isSelected = selectedEntities && selectedEntities.map(e => e.id).indexOf(entity.id) > -1;
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
        entitiesDisplayedFirst,
        fixedFilter,
        updateUrl: false
    });

    return (

        <CollectionScopeProvider collection={collection}>
        <div className="flex flex-col h-full">

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

    const largeLayout = useLargeLayout();
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
                Clear
            </Button>
            {addButton}
        </>
    );
}
