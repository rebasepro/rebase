import { useSelectionDialog } from "../../../hooks/useSelectionDialog";

import { getCollectionDataPath } from "@rebasepro/types";
import React, { useCallback, useEffect } from "react";
import { deepEqual as equal } from "fast-equals";

import { getRelationFrom, normalizeToEntityRelation } from "@rebasepro/common";

import { RelationPreview } from "../../../preview";
import { Entity, EntityRelation, FilterValues, Relation } from "@rebasepro/types";
import { AdminCollection } from "@rebasepro/cms-types";
import { } from "@rebasepro/app";
import { ErrorView } from "@rebasepro/app";
import { CompactEntityCellField } from "./CompactEntityCellField";

type TableMultipleRelationFieldProps = {
    name: string;
    disabled: boolean;
    internalValue: EntityRelation[] | undefined | null;
    updateValue: (newValue: EntityRelation[] | null) => void;
    previewProperties?: string[];
    relation: Relation;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeEntityLink?: boolean;
    /** The cell is selected. */
    selected?: boolean;
    /** See `TableRelationField`. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
};

export function TableMultipleRelationField(props: TableMultipleRelationFieldProps) {
    const collection = props.relation.target();
    return <TableMultipleRelationFieldInternal {...props} collection={collection}/>;
}

export const TableMultipleRelationFieldInternal = React.memo(
    function TableMultipleRelationFieldInternal(props: TableMultipleRelationFieldProps & {
        collection: AdminCollection;
    }) {
        const {
            name,
            internalValue,
            updateValue,
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

        const value = Array.isArray(internalValue) ? internalValue : [];

        const onMultipleEntitiesSelected = useCallback((entities: Entity<any>[]) => {
            updateValue(entities.map(e => getRelationFrom(e)));
        }, [updateValue]);

        const selectedEntityIds = value.map((ref) => ref.id);

        const relationDialogController = useSelectionDialog({
            multiselect: true,
            path: getCollectionDataPath(collection),
            collection,
            onMultipleEntitiesSelected,
            selectedEntityIds,
            fixedFilter
        }
        );

        const handleOpen = () => {
            if (disabled)
                return;
            relationDialogController.open();
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

        // One line at every row size: see CompactEntityCellField.
        return <CompactEntityCellField empty={valueNotSet}
            disabled={disabled}
            selected={selected}
            onClear={() => updateValue([])}>
            {value.map((item, index) => {
                const relationItem = normalizeToEntityRelation(item);
                if (!relationItem) return null;
                return <RelationPreview key={`compact_rel_${name}_${index}`}
                    size={"small"}
                    relation={relationItem}
                    hover={false}
                    previewProperties={previewProperties}
                    includeId={includeId}
                    includeEntityLink={includeEntityLink}/>;
            })}
        </CompactEntityCellField>;
    }, equal);
