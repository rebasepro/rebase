import React, { memo, useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Typography, Chip, Tooltip, cls } from "@rebasepro/ui";
import { IconForView } from "@rebasepro/app";
import type { TableNodeData, ColumnInfo } from "./useSchemaGraph";
import { getColumnRowY, getHeaderHeight } from "./schema-visualizer.utils";

/**
 * Custom React Flow node that renders a database table as a card.
 *
 * Every PK and FK column renders handles on BOTH Left and Right sides.
 * The edge builder picks which side to use based on relative node position.
 */
const TableNodeInner = ({ data, selected }: NodeProps) => {
    const {
        tableName,
        collectionName,
        columns,
        isJunction,
        rlsEnabled,
        historyEnabled,
        icon
    } = data as TableNodeData;

    // Build handles: every PK/FK column gets Left + Right handles
    const handles = useMemo(() => {
        const result: { id: string; type: "source" | "target"; position: Position; top: number }[] = [];
        const cols = columns as ColumnInfo[];
        const headerH = getHeaderHeight({
            isJunction: Boolean(isJunction),
            collectionName: collectionName as string,
            tableName: tableName as string
        });
        const midY = cols.length > 0 ? getColumnRowY(Math.floor(cols.length / 2), headerH) : 30;

        cols.forEach((col, idx) => {
            const y = getColumnRowY(idx, headerH);

            if (col.isForeignKey && !col.isPrimaryKey) {
                // FK: source handles on both sides
                result.push({ id: `source-${col.name}-right`,
type: "source",
position: Position.Right,
top: y });
                result.push({ id: `source-${col.name}-left`,
type: "source",
position: Position.Left,
top: y });
            }
            if (col.isPrimaryKey) {
                // PK: target + source handles on both sides
                result.push({ id: `target-${col.name}-right`,
type: "target",
position: Position.Right,
top: y });
                result.push({ id: `target-${col.name}-left`,
type: "target",
position: Position.Left,
top: y });
                result.push({ id: `source-${col.name}-right`,
type: "source",
position: Position.Right,
top: y });
                result.push({ id: `source-${col.name}-left`,
type: "source",
position: Position.Left,
top: y });
            }
        });

        // Default handles on both sides
        result.push({ id: "target-default-right",
type: "target",
position: Position.Right,
top: midY });
        result.push({ id: "target-default-left",
type: "target",
position: Position.Left,
top: midY });
        result.push({ id: "source-default-right",
type: "source",
position: Position.Right,
top: midY });
        result.push({ id: "source-default-left",
type: "source",
position: Position.Left,
top: midY });

        return result;
    }, [columns, isJunction, collectionName, tableName]);

    return (
        <div
            className={cls(
                "relative rounded-lg border bg-white dark:bg-surface-900 shadow-sm transition-all duration-200 min-w-[240px] max-w-[320px]",
                selected
                    ? "border-primary ring-2 ring-primary/20 shadow-md"
                    : "border-surface-200/40 dark:border-surface-700/40 hover:shadow-md hover:border-surface-300 dark:hover:border-surface-600",
                isJunction && "border-dashed"
            )}
        >
            {/* ── Header ── */}
            <div
                className={cls(
                    "flex items-center gap-2 px-3 py-2 border-b rounded-t-lg",
                    isJunction
                        ? "bg-surface-50 dark:bg-surface-950/50 border-surface-200/30 dark:border-surface-700/30"
                        : "bg-surface-50 dark:bg-surface-950 border-surface-200/40 dark:border-surface-700/40"
                )}
            >
                {icon && !isJunction && (
                    <div className="text-primary shrink-0">
                        <IconForView
                            collectionOrView={{ slug: tableName,
name: collectionName,
icon }}
                            size="smallest"
                        />
                    </div>
                )}
                {isJunction && (
                    <svg
                        className="w-3.5 h-3.5 text-text-disabled dark:text-text-disabled-dark shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                        />
                    </svg>
                )}
                <div className="flex flex-col min-w-0">
                    <Typography
                        variant="caption"
                        className={cls(
                            "font-semibold truncate text-[12px]",
                            isJunction
                                ? "text-text-secondary dark:text-text-secondary-dark"
                                : "text-text-primary dark:text-text-primary-dark"
                        )}
                    >
                        {tableName}
                    </Typography>
                    {collectionName !== tableName && !isJunction && (
                        <Typography
                            variant="caption"
                            className="text-[10px] text-text-disabled dark:text-text-disabled-dark truncate"
                        >
                            {collectionName}
                        </Typography>
                    )}
                </div>

                {/* Badges */}
                <div className="ml-auto flex items-center gap-1 shrink-0">
                    {rlsEnabled && (
                        <Tooltip title="RLS enabled">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500"/>
                        </Tooltip>
                    )}
                    {historyEnabled && (
                        <Tooltip title="History enabled">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400"/>
                        </Tooltip>
                    )}
                </div>
            </div>

            {/* ── Columns ── */}
            <div className="divide-y divide-surface-100 dark:divide-surface-950/60">
                {(columns as ColumnInfo[]).map((col: ColumnInfo) => (
                    <div
                        key={col.name}
                        className={cls(
                            "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                            col.isPrimaryKey && "bg-amber-50/50 dark:bg-amber-950/10",
                            col.isForeignKey &&
                                !col.isPrimaryKey &&
                                "bg-blue-50/40 dark:bg-blue-950/10"
                        )}
                    >
                        <span className="w-3 shrink-0 text-center">
                            {col.isPrimaryKey && (
                                <Tooltip title="Primary Key">
                                    <span className="text-amber-500 text-[10px] font-semibold">🔑</span>
                                </Tooltip>
                            )}
                            {col.isForeignKey && !col.isPrimaryKey && (
                                <Tooltip title={`FK → ${col.relationName ?? "?"}`}>
                                    <span className="text-blue-400 text-[10px] font-semibold">🔗</span>
                                </Tooltip>
                            )}
                        </span>

                        <Typography
                            variant="caption"
                            className={cls(
                                "font-mono text-[11px] truncate flex-1 min-w-0",
                                col.isPrimaryKey
                                    ? "font-semibold text-amber-700 dark:text-amber-400"
                                    : col.isForeignKey
                                      ? "text-blue-600 dark:text-blue-400"
                                      : "text-text-primary dark:text-text-primary-dark"
                            )}
                        >
                            {col.name}
                        </Typography>

                        {col.isEnum ? (
                            <Chip
                                size="smallest"
                                className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-violet-200 dark:border-violet-800 text-[9px] py-0"
                            >
                                enum
                            </Chip>
                        ) : (
                            <Typography
                                variant="caption"
                                className="text-[10px] text-text-disabled dark:text-text-disabled-dark font-mono shrink-0"
                            >
                                {col.typeLabel}
                            </Typography>
                        )}

                        {col.isRequired && !col.isPrimaryKey && (
                            <Tooltip title="Required">
                                <span className="text-red-400 text-[9px]">•</span>
                            </Tooltip>
                        )}
                    </div>
                ))}
            </div>

            {/* ── Handles at node root ── */}
            {handles.map((h) => (
                <Handle
                    key={h.id}
                    id={h.id}
                    type={h.type}
                    position={h.position}
                    style={{ top: h.top }}
                    className={cls(
                        "!w-2 !h-2 !border-2 !border-white dark:!border-surface-900",
                        h.type === "source" ? "!bg-blue-400" : "!bg-amber-400"
                    )}
                />
            ))}
        </div>
    );
};

export const TableNode = memo(TableNodeInner);
