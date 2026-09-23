import React, { useEffect, useRef } from "react";
import { EntityRelation, FilterValues, Relation } from "@rebasepro/types";
import { RelationSelector } from "../../RelationSelector";

interface RelationSelectorFieldProps {
    /** Field name */
    name: string;
    /** Whether the field is disabled */
    disabled?: boolean;
    /** Current value - can be single EntityRelation or array for multiple selection */
    internalValue: EntityRelation | EntityRelation[] | undefined | null;
    /** Callback when value changes */
    updateValue: (newValue: EntityRelation | EntityRelation[] | null) => void;
    /** The relation configuration */
    relation: Relation;
    /** Force filter to be applied to the relation search */
    fixedFilter?: FilterValues<string>;
    /** The cell is selected: the trigger takes the focus, so Enter opens the list. */
    focused?: boolean;
    /** Whether the list is open. Set by the cell's opener as well as the trigger. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /**
     * What the cell shows at rest. The trigger shows the same node, so a
     * selected cell looks like an unselected one.
     */
    preview?: React.ReactNode;
    /** The cell: the list opens against it rather than against the trigger. */
    anchorRef?: React.RefObject<HTMLElement | null>;
}

/** Thin wrapper around RelationSelector for table cells */
export function TableRelationSelectorField({
    disabled = false,
    internalValue,
    updateValue,
    relation,
    fixedFilter,
    focused,
    open,
    onOpenChange,
    preview,
    anchorRef
}: RelationSelectorFieldProps) {

    const ref = useRef<HTMLElement>(null);
    useEffect(() => {
        if (focused) ref.current?.focus({ preventScroll: true });
    }, [focused]);

    // Closing the list hands the focus back to the trigger, so the next Escape
    // clears the cell and Enter opens it again — unless the focus has already
    // gone somewhere of its own, like another cell that was clicked.
    const handleOpenChange = (nextOpen: boolean) => {
        onOpenChange?.(nextOpen);
        if (!nextOpen) {
            setTimeout(() => {
                if (!document.activeElement || document.activeElement === document.body)
                    ref.current?.focus({ preventScroll: true });
            }, 0);
        }
    };

    return (
        <RelationSelector
            ref={ref}
            disabled={disabled}
            value={internalValue || null}
            onValueChange={(newVal) => updateValue(newVal ?? null)}
            relation={relation}
            fixedFilter={fixedFilter}
            open={open}
            onOpenChange={handleOpenChange}
            triggerContent={preview}
            anchorRef={anchorRef}
        />
    );
}
