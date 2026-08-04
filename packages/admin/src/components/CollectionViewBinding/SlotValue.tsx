import React from "react";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { PropertyPreview } from "../../preview";
import type { PreviewSlot } from "./usePreviewSlots";

export interface SlotValueProps {
    slot: PreviewSlot | undefined;
    size: PreviewSize;
    /**
     * Relations and references render as one line of linked text rather than as
     * a card. Defaults to true: a slot is a line in a row or a card, and a
     * relation that renders its own bordered card there — with its own id line
     * and its own side-panel button — is a card inside a card.
     *
     * Pass `false` only for a slot with room for one, which in practice is
     * none of them.
     */
    textOnly?: boolean;
    /** Images only: fill the container rather than fitting inside it. */
    fill?: boolean;
}

/**
 * One display slot, rendered.
 *
 * A slot's value arrives one of two ways and they cannot be rendered the same:
 *
 * - **From a property** — render it with that property's own preview, so an
 *   enum status keeps its colour, a date keeps its format and a storage path
 *   becomes a thumbnail. This is why a declared path beats a resolver whenever
 *   the value is actually on the record.
 * - **From a resolver** — there is no property, because the value was computed
 *   or fetched. All that can be said about it is that it is text.
 *
 * The branch lives here, once, rather than at each of the fourteen places the
 * list row, the card and the board card render a slot. That count is the reason:
 * the last time a rule like this was inlined per call site, it drifted into
 * seven versions.
 */
export function SlotValue({ slot, size, textOnly = true, fill }: SlotValueProps) {

    if (!slot || slot.value === undefined || slot.value === null) return null;

    if (!slot.property || !slot.propertyKey) {
        // Computed. Arrays (a `tags` resolver) join rather than rendering as
        // "[object Object]" via String().
        const text = Array.isArray(slot.value)
            ? slot.value.map(item => String(item)).join(", ")
            : String(slot.value);
        return <>{text}</>;
    }

    return <PropertyPreview
        propertyKey={slot.propertyKey}
        value={slot.value as never}
        property={slot.property}
        size={size}
        textOnly={textOnly}
        fill={fill}/>;
}
