"use client";
import React from "react";
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
    /** A control beside the tile that is not part of its button — a chevron that opens a popover. */
    action?: React.ReactNode;
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
 */
export function StatTile({ icon, label, value, detail, size = "medium", onClick, action, className }: StatTileProps) {
    const large = size === "large";
    const body = (
        <>
            <span className={cls(
                "shrink-0 flex items-center justify-center rounded-lg border border-hairline bg-surface-raised text-text-secondary dark:text-text-secondary-dark",
                large ? "w-12 h-12 [&_svg]:size-5" : "w-10 h-10 [&_svg]:size-[18px]"
            )}>
                {typeof icon === "string" ? <HeaderIcon icon={icon}/> : icon}
            </span>
            <span className="min-w-0 flex flex-col">
                <Typography variant="micro" component="span" color="secondary" className="truncate">{label}</Typography>
                <Typography variant={large ? "h4" : "h5"} component="span" className="truncate tabular-nums">{value}</Typography>
                {detail !== undefined && detail !== null && detail !== "" && (
                    <Typography variant="body2" component="span" color="secondary" className="truncate">{detail}</Typography>
                )}
            </span>
        </>
    );
    return (
        <div className={cls("relative flex items-start min-w-0 rounded-lg", onClick && "hover:bg-surface-hover transition-colors", className)}>
            {onClick ? (
                <button
                    type="button"
                    onClick={onClick}
                    className="flex items-start gap-3 min-w-0 flex-1 p-2 text-left cursor-pointer rounded-lg"
                >
                    {body}
                </button>
            ) : (
                <div className="flex items-start gap-3 min-w-0 flex-1 p-2">{body}</div>
            )}
            {action && <div className="shrink-0 pr-1 pt-2">{action}</div>}
        </div>
    );
}
