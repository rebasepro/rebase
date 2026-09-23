import { useSelectionDialog } from "../../../hooks/useSelectionDialog";

import { getCollectionDataPath } from "@rebasepro/types";
import React, { useCallback, useEffect } from "react";
import { deepEqual as equal } from "fast-equals"

import { RelationPreview } from "../../../preview";
import { Entity, EntityRelation, FilterValues, Relation } from "@rebasepro/types";
import { CollectionSize, AdminCollection } from "@rebasepro/cms-types";

import { getPreviewSizeFrom } from "../../../preview/util";
import { } from "@rebasepro/app";
import { ErrorView } from "@rebasepro/app";
import { getRelationFrom, normalizeToEntityRelation } from "@rebasepro/common";
import { TableMultipleRelationField } from "./TableMultipleRelationField";
import { CompactEntityCellField } from "./CompactEntityCellField";

/** Whether an authored relation yields many rows. Derived from its kind. */
function relationCardinality(relation: { kind?: string; cardinality?: string } | undefined): "one" | "many" | undefined {
    if (!relation) return undefined;
    if (relation.kind === "via") return relation.cardinality as "one" | "many" | undefined;
    if (relation.kind === "hasMany" || relation.kind === "manyToMany") return "many";
    if (relation.kind === "belongsTo" || relation.kind === "hasOne") return "one";
    return relation.cardinality as "one" | "many" | undefined;
}


type TableRelationFieldProps = {
    name: string;
    disabled: boolean;
    internalValue: EntityRelation | EntityRelation[] | undefined | null;
    updateValue: (newValue: (EntityRelation | EntityRelation[] | null)) => void;
    size: CollectionSize;
    multiselect: boolean;
    previewProperties?: string[];
    relation: Relation;
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

export function TableRelationField(props: TableRelationFieldProps) {
    const collection = props.relation.target();

    // Check if this is a many-to-many relation
    const manyRelation = relationCardinality(props.relation) === "many";

    if (manyRelation) {
        return <TableMultipleRelationField
            name={props.name}
            disabled={props.disabled}
            internalValue={Array.isArray(props.internalValue) ? props.internalValue : []}
            updateValue={(newValue) => props.updateValue(newValue)}
            previewProperties={props.previewProperties}
            relation={props.relation}
            fixedFilter={props.fixedFilter}
            includeId={props.includeId}
            includeEntityLink={props.includeEntityLink}
            selected={props.selected}
            open={props.open}
            onOpenChange={props.onOpenChange}
        />;
    }

    return <TableRelationFieldInternal {...props} collection={collection}/>;
}

export const TableRelationFieldInternal = React.memo(
    function TableRelationFieldInternal(props: TableRelationFieldProps & {
        collection: AdminCollection;
    }) {
        const {
            name,
            internalValue,
            updateValue,
            multiselect,
            relation,
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
            updateValue(entity ? getRelationFrom(entity) : null);
        }, [updateValue]);

        const onMultipleEntitiesSelected = useCallback((entities: Entity<any>[]) => {
            updateValue(entities.map((e) => getRelationFrom(e)));
        }, [updateValue]);

        const selectedEntityIds = internalValue
            ? (Array.isArray(internalValue)
                ? internalValue.map((ref) => ref.id)
                : internalValue.id ? [internalValue.id] : [])
            : [];

        const relationDialogController = useSelectionDialog({
            multiselect,
            path: getCollectionDataPath(collection),
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

        // One line at every row size: see CompactEntityCellField. A single
        // record takes the row's preview size — a line of text in a text row,
        // a row with its image in a taller one — and a list stays lines.
        const items = !internalValue ? [] : (Array.isArray(internalValue) ? internalValue : [internalValue]);
        return <CompactEntityCellField empty={valueNotSet}
            disabled={disabled}
            selected={selected}
            onClear={() => updateValue(multiselect ? [] : null)}>
            {items.map((item, index) => {
                const relationItem = normalizeToEntityRelation(item);
                if (!relationItem) return null;
                return <RelationPreview key={`compact_rel_${name}_${index}`}
                    size={multiselect ? "small" : getPreviewSizeFrom(size)}
                    relation={relationItem}
                    hover={false}
                    previewProperties={previewProperties}
                    includeId={includeId}
                    includeEntityLink={includeEntityLink}/>;
            })}
        </CompactEntityCellField>;
    }, equal);
