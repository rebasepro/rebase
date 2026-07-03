import { useSnapshotSelectionDialog } from "../hooks/useSnapshotSelectionDialog";
import type { SnapshotCollection } from "@rebasepro/types";
import React, { useCallback, useMemo } from "react";

import { Snapshot, SnapshotReference, FilterValues } from "@rebasepro/types";
import type { PreviewSize } from "../types/components/PropertyPreviewProps";
import { getReferenceFrom } from "@rebasepro/common";
import { ReferencePreview } from "../preview";
import { Button, cls } from "@rebasepro/ui";
import { useCollectionRegistryController } from "../index";

export type ReferenceWidgetProps<M extends Record<string, unknown>> = {
    name?: string,
    multiselect?: boolean,
    value: SnapshotReference | SnapshotReference[] | null,
    onReferenceSelected?: (params: {
        reference: SnapshotReference | null,
        snapshot: Snapshot<M> | null
    }) => void,
    onMultipleReferenceSelected?: (params: {
        references: SnapshotReference[] | null,
        snapshots: Snapshot<M>[] | null
    }) => void,
    path: string,
    disabled?: boolean,
    previewProperties?: string[];
    /**
     * Allow selection of snapshots that pass the given filter only.
     */
    fixedFilter?: FilterValues<string>;
    size: PreviewSize;
    className?: string;
    includeId?: boolean;
    includeSnapshotLink?: boolean;
};

/**
 * This field allows selecting reference/s.
 */
export function ReferenceWidget<M extends Record<string, unknown>>({
    name,
    multiselect = false,
    path,
    disabled,
    value,
    onReferenceSelected,
    onMultipleReferenceSelected,
    previewProperties,
    fixedFilter,
    size,
    className,
    includeId,
    includeSnapshotLink
}: ReferenceWidgetProps<M>) {

    const collectionRegistryController = useCollectionRegistryController();

    const collection: SnapshotCollection | undefined = useMemo(() => {
        return collectionRegistryController.getCollection(path);
    }, [path, collectionRegistryController.getCollection]);

    const onSingleSnapshotSelected = useCallback((snapshot: Snapshot<M> | null) => {
        if (disabled)
            return;
        if (onReferenceSelected) {
            const reference = snapshot ? getReferenceFrom(snapshot) : null;
            onReferenceSelected?.({
                reference,
                snapshot
            });
        }
    }, [disabled, onReferenceSelected]);

    const onMultipleSnapshotsSelected = useCallback((snapshots: Snapshot<M>[]) => {
        if (disabled)
            return;
        if (onMultipleReferenceSelected) {
            const references = snapshots ? snapshots.map(e => getReferenceFrom(e)) : null;
            onMultipleReferenceSelected({
                references,
                snapshots
            });
        }
    }, [disabled, onReferenceSelected]);

    const referenceDialogController = useSnapshotSelectionDialog({
        multiselect,
        path,
        collection,
        onSingleSnapshotSelected,
        onMultipleSnapshotsSelected,
        fixedFilter
    }
    );

    const clearValue = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (multiselect) {
            onMultipleSnapshotsSelected([]);
        } else {
            onSingleSnapshotSelected(null);
        }
    }, [onReferenceSelected]);

    let child: React.ReactNode;

    const onEntryClick = () => {
        if (disabled)
            return;
        referenceDialogController.open();
    };

    if (Array.isArray(value)) {
        child = <div className={"flex flex-col gap-4"}>
            {value.map((ref, index) => {
                return <ReferencePreview
                    key={`reference_preview_${index}`}
                    onClick={onEntryClick}
                    reference={ref}
                    disabled={disabled}
                    previewProperties={previewProperties}
                    size={size}
                    includeId={includeId}
                    includeSnapshotLink={includeSnapshotLink}/>
            })}
        </div>
    } else if (value?.isSnapshotReference && value?.isSnapshotReference()) {
        child = <ReferencePreview
            reference={value}
            onClick={onEntryClick}
            disabled={disabled}
            previewProperties={previewProperties}
            size={size}
            includeId={includeId}
            includeSnapshotLink={includeSnapshotLink}/>

    }
    return <div className={cls("text-sm font-medium",
        "min-w-80 flex flex-col gap-4",
        "relative transition-colors duration-200 ease-in rounded-xs font-medium",
        disabled ? "bg-opacity-50" : "hover:bg-opacity-75",
        "dark:text-white/50 text-text-primary/50 dark:text-text-primary-dark/50 dark:text-white/50",
        className
    )}>

        {child}
        {!value && <div className="justify-center text-left">
            <Button disabled={disabled}
                onClick={onEntryClick}>
                Edit {name}
            </Button>
        </div>}

    </div>;
}
