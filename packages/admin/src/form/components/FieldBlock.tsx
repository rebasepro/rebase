import type { Property } from "@rebasepro/types";
import type { PropertySpan } from "@rebasepro/admin-types";
import React from "react";
import { cls, ErrorBoundary, Typography } from "@rebasepro/ui";
import { getIconForProperty } from "../../util/property_utils";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";

/**
 * Grid placement for a span.
 *
 * Written out as literal class strings rather than composed, because Tailwind
 * scans source text: a template literal would produce classes that exist at
 * runtime and were never generated into the stylesheet.
 *
 * Below the column breakpoint every field takes the single available column, so
 * the side panel, the dialog and mobile all get a plain stack.
 *
 * Lives here rather than in the form, because the read-only rendering of a
 * record places its fields on the same grid — a record that changes shape when
 * you press Edit is the bug this whole layout exists to avoid.
 */
export function spanClass(span: PropertySpan): string {
    switch (span) {
        case 1: return "@2xl/col:col-span-1";
        case 2: return "@2xl/col:col-span-2";
        case 3: return "@2xl/col:col-span-3";
        case 4: return "@2xl/col:col-span-4";
    }
}

/**
 * Does this property's editor supply its own heading?
 *
 * Arrays, maps, `oneOf` blocks and key-value editors render as a collapsible
 * panel whose header *is* the label — hiding it would leave a panel you cannot
 * identify or, worse, cannot expand. Those keep their own; everything else gets
 * its label from {@link FieldBlock}, which is what makes a text field and a
 * select finally agree on where a label goes.
 *
 * Exported because the layout resolver's span rules and this rule have to stay
 * in step: the self-labelling types are exactly the ones that take a full row.
 */
export function isSelfLabellingProperty(property: Property | undefined): boolean {
    if (!property) return false;
    switch (property.type) {
        case "map":
            // `spreadChildren` inlines the children into the parent grid, so
            // there is no panel and therefore no header to reuse as the label.
            return !property.admin?.spreadChildren;
        case "array": {
            // Most arrays render as an expandable panel whose header is the
            // label — `repeat`, `block`, `custom_array`, `multi_references`.
            // The exceptions are the ones that resolve to an inline control:
            // an enum array is a multi-select and a storage array is a
            // dropzone, and both take their label from the form.
            //
            // This mirrors `getFieldConfig`'s array branch. Getting it backwards
            // is visible: an array of plain strings is a `repeat` panel, and
            // treating it as inline printed "Available Locales" twice, once
            // from the form and once from the panel's own header.
            if (property.oneOf) return true;
            if (Array.isArray(property.of) || !property.of) return true;
            const of = property.of;
            if (of.type === "string" && (of.enum || of.storage)) return false;
            if (of.type === "number" && of.enum) return false;
            return true;
        }
        default:
            return false;
    }
}

/**
 * The type icon in a field label, in px.
 *
 * Matched to the label's 13px rather than taken from `iconSize.smallest` (16),
 * which is sized for buttons. Exported so the surfaces that draw a label
 * themselves — the additional-field cards, the rail — can stay in step.
 */
export const LABEL_ICON_SIZE = 14;

export interface FieldBlockProps {
    propertyKey: string;
    property?: Property;
    /** Rendered by the form rather than by the field, unless self-labelling. */
    showLabel: boolean;
    /**
     * Which of the two renderings this block frames.
     *
     * The **label is identical in both** — same size, same weight, same colour,
     * same type icon, same required marker. A field is the same field whether or
     * not you are editing it, and a record whose labels restyle themselves under
     * Edit reads as two different screens.
     *
     * What `"read"` drops is the *description*, which is not part of the label:
     * it is input help. "Sum of all line items before tax and shipping" under a
     * number that is visibly a sum tells a reader nothing, and a line of it
     * under every field is what a record has instead of room.
     */
    mode?: "edit" | "read";
    children: React.ReactNode;
}

/**
 * One field's worth of the form grid: label, control, description.
 *
 * The same block frames the read-only rendering of a record, so a field sits in
 * the same place, at the same width, under the same label whether or not you are
 * editing it — see {@link EntityViewBinding}.
 *
 * The label is one size down from the control it names (13px against the body's
 * 14) with its icon matched to it at 14px. Labels are scaffolding: you read them
 * to find the value, then read the value. Setting them at body size made a
 * column of records scan as a column of field names with data attached.
 */
export function FieldBlock({
    propertyKey,
    property,
    showLabel,
    mode = "edit",
    children
}: FieldBlockProps) {

    const reading = mode === "read";
    const description = property?.description?.trim();
    const required = Boolean(property?.validation?.required);

    return (
        // Top-aligned: with the description below the control, every label is a
        // single line, so the controls line up on their own. (Bottom-aligning
        // was only needed while the description sat between label and control.)
        <div
            id={`form_field_${propertyKey}`}
            className={"relative flex flex-col min-w-0"}>

            {showLabel && (
                <PropertyIdCopyTooltip propertyKey={propertyKey}>
                    <div className={cls(
                        "flex items-center gap-1.5 font-medium leading-tight mb-1.5",
                        "text-[13px] text-text-secondary dark:text-text-secondary-dark"
                    )}>
                        {/* Small and quiet: enough to tell a number from a
                            relation at a glance, not enough to compete with the
                            field name. Matched to the label's 13px rather than
                            left at the 16px `smallest` token, which put the
                            heaviest mark on the row on the least important
                            thing in it. */}
                        {property && (
                            <span className={"shrink-0 text-text-disabled dark:text-text-disabled-dark"}>
                                {getIconForProperty(property, LABEL_ICON_SIZE)}
                            </span>
                        )}
                        <span className={"truncate"}>{property?.name ?? propertyKey}</span>
                        {required && <span className={"text-red-500 dark:text-red-500 -ml-1"}>*</span>}
                    </div>
                </PropertyIdCopyTooltip>
            )}

            <div className={"min-w-0"}>
                <ErrorBoundary>
                    {children}
                </ErrorBoundary>
            </div>

            {/* Under the control, where it reads as a note about the thing you
                just filled in rather than a subtitle of the next label. */}
            {showLabel && description && !reading && (
                <Typography variant={"caption"}
                    color={"disabled"}
                    className={"mt-1.5 ml-0.5 leading-snug"}>
                    {description}
                </Typography>
            )}
        </div>
    );
}
