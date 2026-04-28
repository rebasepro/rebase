import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

// ─── Layout Constants ─────────────────────────────────────────────────
export const NODE_WIDTH = 280;
const NODE_HEADER_HEIGHT = 52; // header area
const ROW_HEIGHT = 28; // height per column row

/**
 * Estimate the pixel height of a table node based on column count.
 */
export const estimateNodeHeight = (columnCount: number): number =>
    NODE_HEADER_HEIGHT + Math.max(columnCount, 1) * ROW_HEIGHT + 4; // +4 for bottom padding

/**
 * Get the vertical center Y of a specific column row (0-indexed)
 * relative to the top of the node.
 */
export const getColumnRowY = (rowIndex: number): number =>
    NODE_HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

// ─── Auto-Layout via Dagre ────────────────────────────────────────────

export type LayoutDirection = "TB" | "LR";

/**
 * Compute node positions using the dagre graph layout engine.
 * Returns a new array of nodes with updated `position`.
 */
export const getLayoutedElements = (
    nodes: Node[],
    edges: Edge[],
    direction: LayoutDirection = "LR"
): { nodes: Node[]; edges: Edge[] } => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
        rankdir: direction,
        nodesep: 100,
        ranksep: 180,
        edgesep: 60,
        marginx: 60,
        marginy: 60,
    });
    g.setDefaultEdgeLabel(() => ({}));

    const nodeHeights = new Map<string, number>();

    nodes.forEach((node) => {
        const columnCount = (node.data as { columns?: unknown[] }).columns?.length ?? 3;
        const h = estimateNodeHeight(columnCount);
        nodeHeights.set(node.id, h);
        g.setNode(node.id, {
            width: NODE_WIDTH,
            height: h,
        });
    });

    edges.forEach((edge) => {
        g.setEdge(edge.source, edge.target);
    });

    dagre.layout(g);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = g.node(node.id);
        const h = nodeHeights.get(node.id) ?? estimateNodeHeight(3);
        return {
            ...node,
            data: {
                ...node.data,
                layoutDirection: direction,
            },
            position: {
                x: nodeWithPosition.x - NODE_WIDTH / 2,
                y: nodeWithPosition.y - h / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
};

// ─── Column type → display label ──────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
    string: "varchar",
    number: "integer",
    boolean: "boolean",
    date: "timestamp",
    map: "jsonb",
    array: "jsonb",
    relation: "FK",
};

export const getTypeLabel = (type: string): string =>
    TYPE_LABELS[type] ?? type;

// ─── Edge styling by relation type ────────────────────────────────────

export interface RelationEdgeData {
    cardinality: "one" | "many";
    direction: "owning" | "inverse";
    relationName: string;
    hasJunction: boolean;
    hasJoinPath: boolean;
    label: string;
}

export const getCardinalityLabel = (
    cardinality: "one" | "many",
    direction: "owning" | "inverse"
): string => {
    if (cardinality === "many") return "M:N";
    if (direction === "inverse") return "1:1 ←";
    return "N:1";
};
