import { useSelectionDialog } from "../../../hooks/useSelectionDialog";

import React, { useCallback, useEffect } from "react";
import { deepEqual as equal } from "fast-equals"

import { ReferencePreview } from "../../../preview";
import { Entity, EntityReference, FilterValues } from "@rebasepro/types";
import { CollectionSize, AdminCollection } from "@rebasepro/cms-types";

import { getPreviewSizeFrom } from "../../../preview/util";
import { useComponentOverride, ErrorView, CollectionScopeProvider } from "@rebasepro/app";
import { getReferenceFrom } from "@rebasepro/common";
import { useCollectionRegistryController } from "../../../hooks/navigation/contexts/CollectionRegistryContext";
import { CompactEntityCellField } from "./CompactEntityCellField";

type TableReferenceFieldProps = {
    name: string;
    disabled: boolean;
    internalValue: EntityReference | EntityReference[] | undefined | null;
    updateValue: (newValue: (EntityReference | EntityReference[] | null)) => void;
    size: CollectionSize;
    multiselect: boolean;
    previewProperties?: string[];
    path: string;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeEntityLink?: boolean;
    /** The cell is selected. */
    selected?: boolean;
    /**
     * Set by the cell's opener: opens the selection dialog, and is handed
     * back as closed at once — the dialog keeps its own state from there.
     */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

const DefaultMissingReference: React.FC<{ path: string }> = () => null;

function TableReferenceFieldResolver(props: TableReferenceFieldProps & { collection: AdminCollection | undefined }) {
    const ResolvedMissingReference = useComponentOverride("Entity.MissingReference", DefaultMissingReference);
    const { path, collection } = props;

    if (!collection) {
        if (ResolvedMissingReference !== DefaultMissingReference) {
            return <ResolvedMissingReference path={path}/>;
        } else {
            return <ErrorView error={`Collection not found: ${path}`}/>;
        }
    }
    return <TableReferenceFieldInternal {...props} collection={collection}/>;
}

export function TableReferenceField(props: TableReferenceFieldProps) {
    const collectionRegistryController = useCollectionRegistryController();
    const { path } = props;
    const collection = collectionRegistryController.getCollection(path);

    const content = (
        <TableReferenceFieldResolver
            {...props}
            collection={collection}
        />
    );

    if (collection) {
        return (
            <CollectionScopeProvider collection={collection}>
                {content}
            </CollectionScopeProvider>
        );
    }
    return content;
}

export const TableReferenceFieldInternal = React.memo(
    function TableReferenceFieldInternal(props: TableReferenceFieldProps & {
        collection: AdminCollection;
    }) {
        const {
            name,
            internalValue,
            updateValue,
            multiselect,
            path,
            size,
            previewProperties,
            disabled,
            fixedFilter,
            collection,
            includeId,
            includeEntityLink,
            selected,
            open,
            onOpenChange
        } = props;

        const onSingleEntitySelected = useCallback((entity: Entity<any>) => {
            updateValue(entity ? getReferenceFrom(entity) : null);
        }, [updateValue]);

        const onMultipleEntitiesSelected = useCallback((entities: Entity<any>[]) => {
            updateValue(entities.map((e) => getReferenceFrom(e)));
        }, [updateValue]);

        const selectedEntityIds = internalValue
            ? (Array.isArray(internalValue)
                ? internalValue.map((ref) => ref.id)
                : internalValue.id ? [internalValue.id] : [])
            : [];

        const referenceDialogController = useSelectionDialog({
            multiselect,
            path,
            collection,
            onMultipleEntitiesSelected,
            onSingleEntitySelected,
            selectedEntityIds,
            fixedFilter
        }
        );

        const handleOpen = () => {
            if (disabled)
                return;
            referenceDialogController.open();
        };

        // The cell's opener asks for the dialog. It is a request, not a state:
        // the dialog closes itself, so the request is handed straight back.
        useEffect(() => {
            if (!open) return;
            onOpenChange?.(false);
            handleOpen();
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [open]);

        const valueNotSet = !internalValue || (Array.isArray(internalValue) && internalValue.length === 0);

        if (!collection)
            return <ErrorView error={"The specified collection does not exist"}/>;

        // One line at every row size: the inline previews (each title opens
        // its record), the cell's opener to pick and a cross to clear. A single
        // record takes the row's preview size; a list stays lines.
        const refs: EntityReference[] = !internalValue ? [] : (Array.isArray(internalValue) ? internalValue : [internalValue]);
        return <CompactEntityCellField empty={valueNotSet}
            disabled={disabled}
            selected={selected}
            onClear={() => updateValue(multiselect ? [] : null)}>
            {refs.map((reference, index) =>
                reference && reference.isEntityReference && reference.isEntityReference()
                    ? <ReferencePreview key={`compact_ref_${name}_${index}`}
                        size={multiselect ? "small" : getPreviewSizeFrom(size)}
                        reference={reference}
                        hover={false}
                        disabled={!path}
                        previewProperties={previewProperties}
                        includeId={includeId}
                        includeEntityLink={includeEntityLink}/>
                    : <ErrorView key={`compact_ref_${name}_${index}`} error={"Value is not a reference"}/>)}
        </CompactEntityCellField>;
    }, equal);
