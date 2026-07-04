import React from "react";
import { SnapshotRelation, FilterValues, Relation } from "@rebasepro/types";
import { RelationSelector } from "../../RelationSelector";

interface RelationSelectorFieldProps {
    /** Field name */
    name: string;
    /** Whether the field is disabled */
    disabled?: boolean;
    /** Current value - can be single SnapshotRelation or array for multiple selection */
    internalValue: SnapshotRelation | SnapshotRelation[] | undefined | null;
    /** Callback when value changes */
    updateValue: (newValue: SnapshotRelation | SnapshotRelation[] | null) => void;
    /** The relation configuration */
    relation: Relation;
    /** Force filter to be applied to the relation search */
    fixedFilter?: FilterValues<string>;
    /** Collection size for display */
    size?: "small" | "medium";
}

/** Thin wrapper around RelationSelector for table cells */
export function TableRelationSelectorField({
    disabled = false,
    internalValue,
    updateValue,
    relation,
    fixedFilter,
    size = "medium"
}: RelationSelectorFieldProps) {

    return (
        <RelationSelector
            disabled={disabled}
            size={size}
            value={internalValue || null}
            onValueChange={(newVal) => updateValue(newVal ?? null)}
            relation={relation}
            fixedFilter={fixedFilter}
        />
    );
}
