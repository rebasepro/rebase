"use client";
import React, { useId } from "react";
import { cls } from "../../util";
import { Typography } from "../Typography";
import { HeaderIcon } from "./chart_parts";

export interface StatTileProps {
    /** A Lucide icon name (`"Cpu"`) or an icon element, drawn in the tile's well. */
    icon: string | React.ReactNode;
    /** The uppercase micro label above the value: STATUS, COMPUTE, LAST DEPLOY. */
    label: string;
    /** The fact. A string, or an element (a status dot and its word). */
    value: React.ReactNode;
    /** One line under the value: "1/1 instances", "Last deploy succeeded". */
    detail?: React.ReactNode;
    /** `medium`: a 40px well and an `h5` value. `large`: a 48px well and an `h4` value. */
    size?: "medium" | "large";
    /** Makes the tile a button to the page that owns its fact. */
    onClick?: () => void;
    /** A control beside the tile that is not part of its button, at the tile's right edge. */
    action?: React.ReactNode;
    /**
     * A control drawn 6px after the value, on the value's line, that is not
     * part of the tile's button — a chevron that opens a popover about the
     * value. Prefer it to `action` when the control is about the value.
     */
    valueAction?: React.ReactNode;
    className?: string;
}

/**
 * One fact about a thing, as a tile: an icon well, a micro label, the value,
 * and an optional detail line. Given `onClick`, the whole tile is a button to
 * the page that owns the fact.
 *
 * A sibling of `KpiTile`, not a variant of it. A `KpiTile` is a card with a
 * measured figure, its change and a sparkline; a `StatTile` names a fact —
 * a status, a size, a time — and has no card of its own, so a grid of them
 * sits on a hero or a card without becoming boxes inside boxes. They share the
 * label voice (micro, secondary ink) and the figure face (headings,
 * tabular), so a page carrying both reads as one system.
 *
 * Content is TOP-aligned: the well's top edge meets the label line, the label
 * is the first line, the value the second and the detail the third. Tiles in a
 * row therefore share a label baseline and a value baseline whether or not
 * they carry a detail line; centred, a tile with a detail line sat higher than
 * its neighbour without one.
 *
 * Nothing in a tile truncates: the label, the value and the detail wrap to
 * another line rather than end in an ellipsis, because a fact cut short is a
 * different fact ("No manual back…").
 *
 * The button is stretched over the tile rather than wrapped around its
 * content, so a `valueAction` can sit inside the content, right after the
 * value, without nesting a control inside the button. The button is named by
 * the label, value and detail it covers.
 */
export function StatTile({ icon, label, value, detail, size = "medium", onClick, action, valueAction, className }: StatTileProps) {
    const large = size === "large";
    const id = useId();
    const hasDetail = detail !== undefined && detail !== null && detail !== "";
    const content = (
        <div className={cls("flex items-start gap-3 min-w-0 flex-1 p-2", onClick && "pointer-events-none")}>
            <span className={cls(
                "shrink-0 flex items-center justify-center rounded-lg border border-hairline bg-surface-raised text-text-secondary dark:text-text-secondary-dark",
                large ? "w-12 h-12 [&_svg]:size-5" : "w-10 h-10 [&_svg]:size-[18px]"
            )}>
                {typeof icon === "string" ? <HeaderIcon icon={icon}/> : icon}
            </span>
            <span className="min-w-0 flex flex-col">
                <Typography id={`${id}-label`} variant="micro" component="span" color="secondary" className="break-words">{label}</Typography>
                <span className="flex items-center gap-1.5 min-w-0">
                    <Typography id={`${id}-value`} variant={large ? "h4" : "h5"} component="span" className="break-words min-w-0 tabular-nums">{value}</Typography>
                    {valueAction && <span className="shrink-0 pointer-events-auto relative z-10">{valueAction}</span>}
                </span>
                {hasDetail && (
                    <Typography id={`${id}-detail`} variant="body2" component="span" color="secondary" className="break-words">{detail}</Typography>
                )}
            </span>
        </div>
    );
    return (
        <div className={cls("relative flex items-start min-w-0 rounded-lg", onClick && "hover:bg-surface-hover transition-colors", className)}>
            {onClick && (
                <button
                    type="button"
                    onClick={onClick}
                    aria-labelledby={[`${id}-label`, `${id}-value`, hasDetail ? `${id}-detail` : null].filter(Boolean).join(" ")}
                    className="absolute inset-0 w-full h-full cursor-pointer rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
            )}
            {content}
            {action && <div className="shrink-0 pr-1 pt-2 relative z-10">{action}</div>}
        </div>
    );
}
