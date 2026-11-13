import { useEntitySelectionDialog } from "../hooks/useSelectionDialog";

import React, { useCallback, useMemo } from "react";

import { Entity, FilterValues } from "@rebasepro/types";
import { EntityReference } from "@rebasepro/cms-types";
import type { PreviewSize } from "../types/components/PropertyPreviewProps";
import { ReferencePreview } from "../preview";
import { Button, cls } from "@rebasepro/ui";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useReferencePaths } from "../hooks/useReferencePaths";
import type { AdminCollection } from "@rebasepro/cms-types";
import { rowOfEntity } from "@rebasepro/app";

export type ReferenceWidgetProps<M extends Record<string, unknown>> = {
    name?: string,
    multiselect?: boolean,
    value: EntityReference | EntityReference[] | null,
    /** The reference picked, and its row as the server sends it; `null` when cleared. */
    onReferenceSelected?: (params: {
        reference: EntityReference | null,
        row: Record<string, unknown> | null
    }) => void,
    /** The references picked, and their rows as the server sends them. */
    onMultipleReferenceSelected?: (params: {
        references: EntityReference[] | null,
        rows: Record<string, unknown>[] | null
    }) => void,
    path: string,
    disabled?: boolean,
    previewProperties?: string[];
    /**
     * Allow selection of entities that pass the given filter only.
     */
    fixedFilter?: FilterValues<string>;
    size: PreviewSize;
    className?: string;
    includeId?: boolean;
    includeEntityLink?: boolean;
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
    includeEntityLink
}: ReferenceWidgetProps<M>) {

    const collectionRegistryController = useCollectionRegistryController();
    const { targetPath, referenceTo } = useReferencePaths();
    const collectionPath = targetPath(path);

    const collection: AdminCollection | undefined = useMemo(() => {
        return collectionRegistryController.getCollection(collectionPath);
    }, [collectionPath, collectionRegistryController.getCollection]);

    const onSingleEntitySelected = useCallback((entity: Entity<M> | null) => {
        if (disabled)
            return;
        if (onReferenceSelected) {
            const reference = entity ? referenceTo(entity) : null;
            onReferenceSelected?.({
                reference,
                row: entity ? rowOfEntity(entity, collection) : null
            });
        }
    }, [disabled, onReferenceSelected, referenceTo, collection]);

    const onMultipleEntitiesSelected = useCallback((entities: Entity<M>[]) => {
        if (disabled)
            return;
        if (onMultipleReferenceSelected) {
            const references = entities ? entities.map(e => referenceTo(e)) : null;
            onMultipleReferenceSelected({
                references,
                rows: entities ? entities.map(e => rowOfEntity(e, collection)) : null
            });
        }
    }, [disabled, onMultipleReferenceSelected, referenceTo, collection]);

    const referenceDialogController = useEntitySelectionDialog({
        multiselect,
        path: collectionPath,
        collection,
        onSingleEntitySelected,
        onMultipleEntitiesSelected,
        fixedFilter
    }
    );

    const clearValue = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (multiselect) {
            onMultipleEntitiesSelected([]);
        } else {
            onSingleEntitySelected(null);
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
                    includeEntityLink={includeEntityLink}/>
            })}
        </div>
    } else if (value?.isEntityReference && value?.isEntityReference()) {
        child = <ReferencePreview
            reference={value}
            onClick={onEntryClick}
            disabled={disabled}
            previewProperties={previewProperties}
            size={size}
            includeId={includeId}
            includeEntityLink={includeEntityLink}/>

    }
    return <div className={cls("text-sm font-medium",
        "min-w-80 flex flex-col gap-4",
        "relative transition-colors duration-200 ease-in rounded-xs font-medium",
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
