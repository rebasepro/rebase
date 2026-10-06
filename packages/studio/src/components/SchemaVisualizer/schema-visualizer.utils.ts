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
 * Positions of the graphs laid out in this page's life, by
 * {@link layoutSignature}: the most recent few.
 *
 * Dagre runs on the main thread — 4.5–5 s at 200 cross-linked tables, 90 s at
 * 500 — and the visualizer laid its graph out when it opened, again when the
 * live RLS answer arrived (a badge, not the graph), and again on every reopen.
 * The key is everything the layout reads, so a changed schema — a table, a
 * column count, a relation — is a different key and is laid out afresh; the
 * layout is deterministic, so an entry never goes stale. Holds geometry only,
 * nothing read from the database.
 */
const layoutCache = new Map<string, Map<string, { x: number; y: number }>>();
const LAYOUT_CACHE_SIZE = 8;

/** What dagre is given — each node's id and height, each edge's ends, in order. */
const layoutSignature = (nodes: Node[], nodeHeights: Map<string, number>, edges: Edge[]): string =>
    `${nodes.map(node => `${node.id}:${nodeHeights.get(node.id)}`).join("|")}#${edges.map(edge => `${edge.source}>${edge.target}`).join("|")}`;

/**
 * Compute node positions using the dagre graph layout engine.
 * Returns a new array of nodes with updated `position`.
 *
 * The graph always ranks top to bottom: an ERD read as a column of tables
 * fits the tall, narrow canvas the visualizer is given, and it is the only
 * layout the visualizer offers.
 *
 * A graph laid out before is not laid out again: see {@link layoutCache}.
 */
export const getLayoutedElements = (
    nodes: Node[],
    edges: Edge[]
): { nodes: Node[]; edges: Edge[] } => {
    const nodeHeights = new Map<string, number>();
    for (const node of nodes) {
        const data = node.data as { columns?: unknown[]; isJunction?: boolean; collectionName?: string; tableName?: string };
        const columnCount = data.columns?.length ?? 3;
        const headerH = getHeaderHeight({
            isJunction: Boolean(data.isJunction),
            collectionName: data.collectionName ?? "",
            tableName: data.tableName ?? ""
        });
        nodeHeights.set(node.id, estimateNodeHeight(columnCount, headerH));
    }

    const signature = layoutSignature(nodes, nodeHeights, edges);
    let positions = layoutCache.get(signature);
    if (!positions) {
        positions = runDagre(nodes, nodeHeights, edges);
        layoutCache.set(signature, positions);
        if (layoutCache.size > LAYOUT_CACHE_SIZE) {
            const oldest = layoutCache.keys().next().value;
            if (oldest !== undefined) layoutCache.delete(oldest);
        }
    }

    const layoutedNodes = nodes.map((node) => ({
        ...node,
        position: { ...(positions.get(node.id) ?? { x: 0, y: 0 }) }
    }));

    return { nodes: layoutedNodes,
edges };
};

/** Each node's top-left corner, as dagre places the graph. */
const runDagre = (
    nodes: Node[],
    nodeHeights: Map<string, number>,
    edges: Edge[]
): Map<string, { x: number; y: number }> => {
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

    nodes.forEach((node) => {
        g.setNode(node.id, {
            width: NODE_WIDTH,
            height: nodeHeights.get(node.id) ?? estimateNodeHeight(3)
        });
    });

    edges.forEach((edge) => {
        g.setEdge(edge.source, edge.target);
    });

    dagre.layout(g);

    const positions = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
        const nodeWithPosition = g.node(node.id);
        const h = nodeHeights.get(node.id) ?? estimateNodeHeight(3);
        positions.set(node.id, {
            x: nodeWithPosition.x - NODE_WIDTH / 2,
            y: nodeWithPosition.y - h / 2
        });
    }
    return positions;
};

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
