import React from "react";
import { LucideIconByName } from "../../icons/LucideIconByName";

/** Gridlines and axes: a hairline, recessive. */
export const GRID_CLASSES = "stroke-hairline-strong";

/** Axis tick text: the secondary text tier, never a series colour. */
export const TICK_CLASSES = "fill-text-secondary dark:fill-text-secondary-dark text-[11px] tabular-nums";

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
