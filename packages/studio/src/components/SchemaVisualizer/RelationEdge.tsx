import React, { memo } from "react";
import { BaseEdge, getSmoothStepPath, EdgeLabelRenderer } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { cls } from "@rebasepro/ui";
import type { RelationEdgeData } from "./schema-visualizer.utils";

/**
 * Custom React Flow edge that renders relations with style variations
 * based on cardinality and direction.
 *
 * - Owning one-to-one: solid, primary color
 * - Many-to-many (junction): solid, violet
 * - Inverse: dashed, muted
 * - Join path: dotted, muted
 */
const RelationEdgeInner = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected
}: EdgeProps) => {
    const edgeData = data as RelationEdgeData | undefined;

    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 8
    });

    const isInverse = edgeData?.direction === "inverse";
    const isJoinPath = edgeData?.hasJoinPath;
    const isJunction = edgeData?.hasJunction;

    // Determine stroke style
    let strokeColor = "var(--rf-edge-stroke, #94a3b8)";
    let strokeDasharray: string | undefined;
    let strokeWidth = 1.5;

    if (selected) {
        strokeColor = "var(--rf-edge-stroke-selected, #6366f1)";
        strokeWidth = 2.5;
    } else if (isJunction) {
        strokeColor = "#8b5cf6"; // violet
    } else if (isInverse) {
        strokeDasharray = "6 3";
        strokeColor = "#94a3b8";
    } else if (isJoinPath) {
        strokeDasharray = "3 3";
        strokeColor = "#94a3b8";
    } else {
        strokeColor = "#6366f1"; // primary/indigo
    }

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                style={{
                    stroke: strokeColor,
                    strokeWidth,
                    strokeDasharray
                }}
            />
            {edgeData?.label && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: "absolute",
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                            pointerEvents: "all"
                        }}
                        className={cls(
                            "px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold leading-none",
                            "bg-white dark:bg-surface-900 border",
                            selected
                                ? "border-primary text-primary"
                                : isJunction
                                  ? "border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400"
                                  : isInverse || isJoinPath
                                    ? "border-surface-200 dark:border-surface-700 text-text-disabled dark:text-text-disabled-dark"
                                    : "border-primary/30 dark:border-primary/30 text-primary"
                        )}
                    >
                        {edgeData.label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
};

export const RelationEdge = memo(RelationEdgeInner);
