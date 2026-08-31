import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

// ─── Layout Constants ─────────────────────────────────────────────────
export const NODE_WIDTH = 280;
/** Header with a single line of text (junction tables or tableName === collectionName). */
const HEADER_HEIGHT_SINGLE = 33;
/** Header with two lines (name + subtitle when collectionName !== tableName). */
const HEADER_HEIGHT_DOUBLE = 47;
const ROW_HEIGHT = 28; // height per column row

/**
 * Compute the correct header height for a table node.
 */
export const getHeaderHeight = (opts: {
    isJunction: boolean;
    collectionName: string;
    tableName: string;
}): number => {
    if (opts.isJunction) return HEADER_HEIGHT_SINGLE;
    return opts.collectionName !== opts.tableName
        ? HEADER_HEIGHT_DOUBLE
        : HEADER_HEIGHT_SINGLE;
};

/**
 * Estimate the pixel height of a table node based on column count.
 */
const estimateNodeHeight = (columnCount: number, headerHeight: number = HEADER_HEIGHT_DOUBLE): number =>
    headerHeight + Math.max(columnCount, 1) * ROW_HEIGHT + 4; // +4 for bottom padding

/**
 * Get the vertical center Y of a specific column row (0-indexed)
 * relative to the top of the node.
 */
export const getColumnRowY = (rowIndex: number, headerHeight: number = HEADER_HEIGHT_DOUBLE): number =>
    headerHeight + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

// ─── Auto-Layout via Dagre ────────────────────────────────────────────

/**
 * Compute node positions using the dagre graph layout engine.
 * Returns a new array of nodes with updated `position`.
 *
 * The graph always ranks top to bottom: an ERD read as a column of tables
 * fits the tall, narrow canvas the visualizer is given, and it is the only
 * layout the visualizer offers.
 */
export const getLayoutedElements = (
    nodes: Node[],
    edges: Edge[]
): { nodes: Node[]; edges: Edge[] } => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
        rankdir: "TB",
        nodesep: 100,
        ranksep: 180,
        edgesep: 60,
        marginx: 60,
        marginy: 60
    });
    g.setDefaultEdgeLabel(() => ({}));

    const nodeHeights = new Map<string, number>();

    nodes.forEach((node) => {
        const data = node.data as { columns?: unknown[]; isJunction?: boolean; collectionName?: string; tableName?: string };
        const columnCount = data.columns?.length ?? 3;
        const headerH = getHeaderHeight({
            isJunction: Boolean(data.isJunction),
            collectionName: data.collectionName ?? "",
            tableName: data.tableName ?? ""
        });
        const h = estimateNodeHeight(columnCount, headerH);
        nodeHeights.set(node.id, h);
        g.setNode(node.id, {
            width: NODE_WIDTH,
            height: h
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
            position: {
                x: nodeWithPosition.x - NODE_WIDTH / 2,
                y: nodeWithPosition.y - h / 2
            }
        };
    });

    return { nodes: layoutedNodes,
edges };
};

// ─── Column type → display label ──────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
    string: "varchar",
    number: "integer",
    boolean: "boolean",
    date: "timestamp",
    map: "jsonb",
    array: "jsonb",
    relation: "FK"
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
