import React from "react";
import { LucideIconByName } from "../../icons/LucideIconByName";

/** Gridlines and axes: a hairline, recessive. */
export const GRID_CLASSES = "stroke-hairline-strong";

/**
 * How strongly a bar is drawn at rest, in every bar chart the kit has
 * (`BarChart`, `TimeBars`): the primary at 58%, full strength under the pointer
 * or on focus. Saturated bars side by side read as a block, and two bar charts
 * at two strengths read as two systems.
 */
export const BAR_REST_OPACITY = 0.58;

/**
 * Axis tick text: the secondary text tier, never a series colour. Sized by the
 * `text-2xs` token (11px in the kit) rather than a literal, so an app that
 * raises the token for a 12px floor raises its chart ticks with it.
 */
export const TICK_CLASSES = "fill-text-secondary dark:fill-text-secondary-dark text-2xs tabular-nums";

/**
 * The 14px icon of a card header, in the secondary text tier. A string is a
 * Lucide name (`"DollarSign"`), fetched with the rest of the set on first use;
 * an element is drawn as it is.
 */
export function HeaderIcon({ icon }: { icon: string | React.ReactNode }) {
    if (icon === null || icon === undefined || icon === false || icon === "") return null;
    return (
        <span className="shrink-0 flex items-center text-text-secondary dark:text-text-secondary-dark [&>svg]:size-3.5">
            {typeof icon === "string" ? <LucideIconByName name={icon} size={14} className="select-none shrink-0"/> : icon}
        </span>
    );
}
