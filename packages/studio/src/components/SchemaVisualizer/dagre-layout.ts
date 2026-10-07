import dagre from "dagre";

/**
 * What the layout reads, as plain data: each table's id and box, each
 * relation's ends. Plain so it can cross into the layout worker unchanged.
 */
export interface LayoutInput {
    nodes: { id: string; width: number; height: number }[];
    edges: { source: string; target: string }[];
}

/** Each table's top-left corner, by node id. */
export type LayoutPositions = Record<string, { x: number; y: number }>;

/**
 * Place the graph with dagre, top to bottom.
 *
 * An ERD read as a column of tables fits the tall, narrow canvas the
 * visualizer is given, and it is the only layout the visualizer offers.
 * Deterministic: the same input always gives the same positions.
 *
 * The cost is in dagre's ordering phase and grows fast with cross-linked
 * graphs — 5 s at 200 tables with two relations each, 90 s at 500 — which is
 * why the visualizer runs this in a worker (`dagre-layout.worker.ts`).
 */
export function runDagre(input: LayoutInput): LayoutPositions {
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

    for (const node of input.nodes) {
        g.setNode(node.id, {
            width: node.width,
            height: node.height
        });
    }
    for (const edge of input.edges) {
        g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    const positions: LayoutPositions = {};
    for (const node of input.nodes) {
        const placed = g.node(node.id);
        positions[node.id] = {
            x: placed.x - node.width / 2,
            y: placed.y - node.height / 2
        };
    }
    return positions;
}
