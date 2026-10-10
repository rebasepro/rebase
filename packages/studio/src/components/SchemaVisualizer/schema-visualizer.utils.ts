import type { Node, Edge } from "@xyflow/react";
import { runDagre, type LayoutInput, type LayoutPositions } from "./dagre-layout";
import { layOutOffThread } from "./layout-runner";

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

/** A graph's layout input, and the key its positions are kept under. */
export interface LayoutPlan {
    input: LayoutInput;
    signature: string;
}

/**
 * What dagre will be given for these nodes and edges: each node's id and
 * box, each edge's ends, in order. The signature is all of it, so a changed
 * schema — a table, a column count, a relation — is a different key.
 */
export const planLayout = (nodes: Node[], edges: Edge[]): LayoutPlan => {
    const input: LayoutInput = {
        nodes: nodes.map((node) => {
            const data = node.data as { columns?: unknown[]; isJunction?: boolean; collectionName?: string; tableName?: string };
            const headerH = getHeaderHeight({
                isJunction: Boolean(data.isJunction),
                collectionName: data.collectionName ?? "",
                tableName: data.tableName ?? ""
            });
            return {
                id: node.id,
                width: NODE_WIDTH,
                height: estimateNodeHeight(data.columns?.length ?? 3, headerH)
            };
        }),
        edges: edges.map((edge) => ({
            source: edge.source,
            target: edge.target
        }))
    };
    const signature = `${input.nodes.map(node => `${node.id}:${node.height}`).join("|")}#${input.edges.map(edge => `${edge.source}>${edge.target}`).join("|")}`;
    return {
        input,
        signature
    };
};

/**
 * Positions of the graphs laid out in this page's life, by
 * {@link LayoutPlan.signature}: the most recent few.
 *
 * Dagre takes 4.5–5 s at 200 cross-linked tables and 90 s at 500, so a graph
 * is laid out once: not again when the live RLS answer arrives (a badge, not
 * the graph), nor when the view is reopened. The layout is deterministic, so
 * an entry never goes stale. Holds geometry only, nothing read from the
 * database.
 */
const layoutCache = new Map<string, LayoutPositions>();
const LAYOUT_CACHE_SIZE = 16;

const rememberLayout = (signature: string, positions: LayoutPositions): LayoutPositions => {
    layoutCache.set(signature, positions);
    if (layoutCache.size > LAYOUT_CACHE_SIZE) {
        const oldest = layoutCache.keys().next().value;
        if (oldest !== undefined) layoutCache.delete(oldest);
    }
    return positions;
};

/** The positions for this plan, if it has been laid out before. */
export const cachedLayout = (plan: LayoutPlan): LayoutPositions | undefined =>
    layoutCache.get(plan.signature);

/** Lay the plan out here, on the calling thread. */
export const layOutNow = (plan: LayoutPlan): LayoutPositions =>
    cachedLayout(plan) ?? rememberLayout(plan.signature, runDagre(plan.input));

/** Layouts running in a worker, by signature, so a second ask waits for the first. */
const layoutsInFlight = new Map<string, Promise<LayoutPositions>>();

/**
 * Lay the plan out in a worker; the main thread stays free while it runs.
 * See {@link layOutOffThread}.
 */
export const layOutInBackground = (plan: LayoutPlan): Promise<LayoutPositions> => {
    const cached = cachedLayout(plan);
    if (cached) return Promise.resolve(cached);
    const running = layoutsInFlight.get(plan.signature);
    if (running) return running;
    const job = layOutOffThread(plan.input)
        .then((positions) => rememberLayout(plan.signature, positions))
        .finally(() => layoutsInFlight.delete(plan.signature));
    layoutsInFlight.set(plan.signature, job);
    return job;
};

/** The nodes at their laid-out positions, as new objects. */
export const placeNodes = (nodes: Node[], positions: LayoutPositions): Node[] =>
    nodes.map((node) => ({
        ...node,
        position: { ...(positions[node.id] ?? {
            x: 0,
            y: 0
        }) }
    }));

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
