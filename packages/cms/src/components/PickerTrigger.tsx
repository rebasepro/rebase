import * as React from "react";
import { PopoverPrimitive } from "@rebasepro/ui";

/**
 * The trigger of a picker's popover, or — given an anchor — a plain child
 * beside a `Popover.Anchor` on that element.
 *
 * Both at once does not work: Radix's `Trigger` registers itself as the
 * anchor through a ref callback, and a custom anchor through an effect that
 * only reports a change. Under StrictMode the ref callback runs again after
 * the effect, the effect sees nothing new, and the popover stays anchored to
 * a trigger that the custom anchor then unmounts — it opened at the window's
 * top-left corner. The pickers open and close themselves, so they lose
 * nothing by leaving the `Trigger` out.
 */
export function PickerTrigger({
    anchorRef,
    children
}: {
    anchorRef?: React.RefObject<HTMLElement | null>;
    children: React.ReactElement;
}) {
    if (!anchorRef)
        return <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>;
    return <>
        <PopoverPrimitive.Anchor virtualRef={anchorRef}/>
        {children}
    </>;
}
