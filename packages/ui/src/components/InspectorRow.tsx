import React from "react";
import { cls } from "../util";
import { Tooltip } from "./Tooltip";
import { Typography } from "./Typography";

export interface InspectorRowProps {
    /** Quiet 12px property label rendered in the left column. */
    label: React.ReactNode;
    /** Marks the field as required with a subtle asterisk beside the label. */
    required?: boolean;
    /** Optional helper text tucked into a tooltip on the label so the rail stays compact. */
    description?: string;
    /** Optional trailing element inside the label cell (e.g. a Studio-only key hint). */
    labelAdornment?: React.ReactNode;
    /**
     * Vertical alignment between label and value. Use `"center"` (default) for
     * single-line controls (select, date, switch, single relation) and `"start"`
     * for multi-line controls (wrapping tag pills).
     */
    align?: "center" | "start";
    /** Interactive control or read-only value rendered in the right column. */
    children: React.ReactNode;
    className?: string;
    id?: string;
    "data-form-field"?: string;
}

/**
 * Compact 2-column property row for side rails and inspectors.
 *
 * Keeps labels uniform (`w-24` / 96px muted 12px column on the left) and pairs
 * them with compact controls or read-only values on the right. For `align="start"`,
 * the label cell keeps a fixed `h-[30px]` flex-center box so row 1 aligns on the
 * exact same baseline as `align="center"` rows.
 */
export function InspectorRow({
    label,
    required = false,
    description,
    labelAdornment,
    align = "center",
    children,
    className,
    id,
    "data-form-field": dataFormField
}: InspectorRowProps) {
    const labelNode = (
        <div
            className={cls(
                "group/label w-24 shrink-0 flex items-center gap-1 min-w-0",
                align === "start" ? "h-[30px]" : ""
            )}
        >
            <Typography variant="caption" color="secondary" className="font-medium truncate">
                {label}
            </Typography>
            {required && <span className="text-red-500 text-xs shrink-0">*</span>}
            {labelAdornment}
        </div>
    );

    return (
        <div
            id={id}
            data-form-field={dataFormField}
            className={cls(
                "relative flex gap-2.5 min-w-0 min-h-[30px]",
                align === "start" ? "items-start" : "items-center",
                className
            )}
        >
            {description
                ? <Tooltip title={description} side="left" familiarity="low">{labelNode}</Tooltip>
                : labelNode}
            <div className="flex-1 min-w-0" data-field-control="">
                {children}
            </div>
        </div>
    );
}
