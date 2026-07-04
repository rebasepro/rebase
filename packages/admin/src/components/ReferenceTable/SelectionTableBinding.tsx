import type { CollectionConfig } from "@rebasepro/types";
import React, { MouseEventHandler, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectionSize, Snapshot, FilterValues } from "@rebasepro/types";

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
     * Snapshot collection config
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
     * snapshot ids to be displayed first.
     */
    selectedSnapshotIds?: (string | number)[];

    /**
     * If `multiselect` is set to `false`, you will get the selected snapshot
     * in this callback.
     * @param snapshot
     * @callback
     */
    onSingleSnapshotSelected?(snapshot: Snapshot<any> | null): void;

    /**
     * If `multiselect` is set to `true`, you will get the selected snapshots
     * in this callback.
     * @param snapshots
     * @callback
     */
    onMultipleSnapshotsSelected?(snapshots: Snapshot<any>[]): void;

    /**
     * Allow selection of snapshots that pass the given filter only.
     */
    fixedFilter?: FilterValues<string>;

    /**
     * Use this description to indicate the user what to do in this dialog.
     */
    description?: React.ReactNode;

    /**
     * Maximum number of snapshots that can be selected.
     */
    maxSelection?: number;

}

/**
 * This component allows to select snapshots from a given collection.
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
        onSingleSnapshotSelected,
        onMultipleSnapshotsSelected,
        multiselect,
        collection,
        path: pathInput,
        selectedSnapshotIds: selectedSnapshotIdsProp,
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

    const [snapshotsDisplayedFirst, setSnapshotsDisplayedFirst] = useState<Snapshot<any>[]>([]);

    const selectionController = useSelectionController();

    // Track whether the selection has been initialized to avoid
    // firing onMultipleSnapshotsSelected during the initial mount/fetch.
    const selectionInitializedRef = useRef(false);

    // Propagate selection changes to the parent callback.
    // This runs after the selectionController state updates, ensuring
    // we always send the correct, non-stale selection to the parent.
    useEffect(() => {
        if (!selectionInitializedRef.current) return;
        if (onMultipleSnapshotsSelected) {
            onMultipleSnapshotsSelected(selectionController.selectedSnapshots);
        }
    }, [selectionController.selectedSnapshots]);

    /**
     * Fetch initially selected ids
     */
    useEffect(() => {
        let unmounted = false;
        const selectedSnapshotIds = selectedSnapshotIdsProp?.map(id => id?.toString()).filter(Boolean);
        if (selectedSnapshotIds && selectedSnapshotIds.length > 0 && collection) {
            Promise.all(
                selectedSnapshotIds.map((snapshotId) =>
                    dataClient.collection(path).findById(snapshotId))
                )
                .then((snapshots) => {
                    if (!unmounted) {
                        const result = snapshots.filter((e): e is Snapshot<any> => !!e);
                        selectionController.setSelectedSnapshots(result);
                        setSnapshotsDisplayedFirst(result);
                        // Mark initialized after the initial fetch completes
                        selectionInitializedRef.current = true;
                    }
                });
        } else {
            selectionController.setSelectedSnapshots([]);
            setSnapshotsDisplayedFirst([]);
            selectionInitializedRef.current = true;
        }
        return () => {
            unmounted = true;
        };
    }, [dataClient, path, selectedSnapshotIdsProp, collection, selectionController.setSelectedSnapshots]);

    const onClear = () => {
        analyticsController.onAnalyticsEvent?.("reference_selection_clear", {
            path
        });
        selectionController.setSelectedSnapshots([]);
        if (!multiselect && onSingleSnapshotSelected) {
            onSingleSnapshotSelected(null);
        }
    };

    const onSnapshotClick = useCallback((snapshot: Snapshot<any>) => {
        if (!multiselect && onSingleSnapshotSelected) {
            analyticsController.onAnalyticsEvent?.("reference_selected_single", {
                path,
                snapshotId: snapshot.id
            });
            onSingleSnapshotSelected(snapshot);
            sideDialogContext.close(false);
        } else {
            // For multiselect, delegate to the selection controller's toggle.
            // The useEffect above will propagate the change to onMultipleSnapshotsSelected.
            analyticsController.onAnalyticsEvent?.("reference_selection_toggle", {
                path,
                snapshotId: snapshot.id
            });
            const selectedSnapshots = selectionController.selectedSnapshots;
            if (selectedSnapshots.map((e) => e.id).indexOf(snapshot.id) > -1) {
                selectionController.setSelectedSnapshots(
                    selectedSnapshots.filter((item: Snapshot<any>) => item.id !== snapshot.id)
                );
            } else {
                if (maxSelection && selectedSnapshots.length >= maxSelection) return;
                selectionController.setSelectedSnapshots([...selectedSnapshots, snapshot]);
            }
        }
    }, [multiselect, onSingleSnapshotSelected, analyticsController, path, sideDialogContext, selectionController, maxSelection]);

    // create a new snapshot from within the reference dialog
    const onNewClick = () => {
        analyticsController.onAnalyticsEvent?.("reference_selection_new_snapshot", {
            path
        });
        sidePanelController.open({
            path: path,
            collection,
            updateUrl: true,
            onUpdate: ({ snapshot }) => {
                setSnapshotsDisplayedFirst([snapshot, ...snapshotsDisplayedFirst]);
                onSnapshotClick(snapshot);
            },
            closeOnSave: true
        });
    };

    const tableRowActionsBuilder = ({
        snapshot,
        size,
        width,
        frozen
    }: {
        snapshot: Snapshot<any>,
        size: CollectionSize,
        width: number,
        frozen?: boolean
    }) => {
        const selectedSnapshots = selectionController.selectedSnapshots;
        const isSelected = selectedSnapshots && selectedSnapshots.map(e => e.id).indexOf(snapshot.id) > -1;
        return <CollectionRowActions
            width={width}
            frozen={frozen}
            snapshot={snapshot}
            size={size}
            isSelected={isSelected}
            selectionEnabled={multiselect}
            hideId={collection?.hideIdFromCollection}
            path={path}
            selectionController={selectionController}
            openSnapshotMode={"side_panel"}
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
        snapshotsDisplayedFirst,
        fixedFilter,
        updateUrl: false
    });

    return (

        <div className="flex flex-col h-full">

            <div className="grow">
                {snapshotsDisplayedFirst &&
                    <CollectionTableBinding
                        additionalFields={collection.additionalFields}
                        displayedColumnIds={displayedColumnIds}
                        onSnapshotClick={onSnapshotClick}
                        tableController={tableController}
                        enablePopupIcon={false}
                        tableRowActionsBuilder={tableRowActionsBuilder}
                        openSnapshotMode={"side_panel"}
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
                        actions={<SnapshotSelectionDialogActions
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

function SnapshotSelectionDialogActions({
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
