import React, { useEffect, useRef } from "react";
import { UserSelector } from "../../../components/UserSelector";

export function VirtualTableUserSelect(props: {
    name: string;
    error: Error | undefined;
    multiple: boolean;
    disabled: boolean;
    small: boolean;
    internalValue: string | string[] | undefined;
    updateValue: (newValue: (string | string[] | null)) => void;
    focused: boolean;
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
    onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}) {

    const {
        internalValue,
        disabled,
        focused,
        updateValue,
        open,
        onOpenChange,
        preview,
        anchorRef
    } = props;

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

    // For now we only support single-select in the table context via the new UserSelector
    const singleValue = Array.isArray(internalValue) ? internalValue[0] ?? null : internalValue ?? null;

    return (
        <UserSelector
            ref={ref}
            value={singleValue}
            onValueChange={(userId) => {
                updateValue(userId);
            }}
            disabled={disabled}
            size={"small"}
            clearable={true}
            invisible={true}
            open={open}
            onOpenChange={handleOpenChange}
            triggerContent={preview}
            anchorRef={anchorRef}
        />
    );
}
