import type { Property } from "@rebasepro/types";
import type { PropertySpan } from "@rebasepro/admin-types";
import React from "react";
import { cls, ErrorBoundary, iconSize, InfoIcon, Tooltip, Typography } from "@rebasepro/ui";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";

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
        case "array":
            // A plain array of primitives renders as an inline control (chips,
            // a multi-select) rather than a panel, so the form labels it.
            if (property.oneOf) return true;
            if (Array.isArray(property.of) || !property.of) return true;
            return property.of.type === "map";
        default:
            return false;
    }
}

export interface FieldBlockProps {
    propertyKey: string;
    property?: Property;
    /** Columns this field occupies. Only used to decide the description layout. */
    span: PropertySpan;
    /** Rendered by the form rather than by the field, unless self-labelling. */
    showLabel: boolean;
    children: React.ReactNode;
}

/**
 * One field's worth of the form grid: label, description, control.
 *
 * The description sits directly under the label rather than under the control,
 * so a caption reads as belonging to the field above it instead of floating
 * between two. At a single-column span there is no room for prose next to a
 * narrow input — three-line wraps crowded the label badly — so it collapses to
 * an info affordance on the label itself.
 */
export function FieldBlock({
    propertyKey,
    property,
    span,
    showLabel,
    children
}: FieldBlockProps) {

    const description = property?.description?.trim();
    const required = Boolean(property?.validation?.required);
    const inlineDescription = Boolean(description) && span >= 2;
    const tooltipDescription = Boolean(description) && span < 2;

    return (
        <div
            id={`form_field_${propertyKey}`}
            className={"relative flex flex-col min-w-0"}>

            {showLabel && (
                <PropertyIdCopyTooltip propertyKey={propertyKey}>
                    <div className={cls(
                        "text-sm font-medium leading-tight mb-1.5",
                        "text-text-secondary dark:text-text-secondary-dark"
                    )}>
                        {property?.name ?? propertyKey}
                        {required && <span className={"text-red-500 dark:text-red-500 ml-0.5"}>*</span>}
                        {tooltipDescription && (
                            // `className` lands on Tooltip's own wrapper, which
                            // is a block `div` by default — inline-flex is what
                            // keeps the icon on the label's last line instead of
                            // dropping it onto a line of its own.
                            <Tooltip title={description} className={"inline-flex align-middle ml-1"}>
                                <InfoIcon
                                    size={14}
                                    className={"text-text-disabled dark:text-text-disabled-dark cursor-help"}/>
                            </Tooltip>
                        )}
                    </div>
                </PropertyIdCopyTooltip>
            )}

            {showLabel && inlineDescription && (
                <Typography variant={"caption"}
                    color={"disabled"}
                    className={"mb-1.5 leading-snug"}>
                    {description}
                </Typography>
            )}

            {/* Pushed to the bottom so controls share a baseline across a row
                even when one field's description wrapped and another's did not. */}
            <div className={"mt-auto min-w-0"}>
                <ErrorBoundary>
                    {children}
                </ErrorBoundary>
            </div>
        </div>
    );
}
