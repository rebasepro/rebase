import { useMemo, useState, useCallback, useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { isPostgresCollectionConfig } from "@rebasepro/types";
import type { Relation, ResolvedRelation } from "@rebasepro/types";
import { getTableName, resolveCollectionRelations } from "@rebasepro/common";
import {
    cachedLayout,
    getCardinalityLabel,
    layOutInBackground,
    layOutNow,
    NODE_WIDTH,
    placeNodes,
    planLayout
} from "./schema-visualizer.utils";
import type { RelationEdgeData } from "./schema-visualizer.utils";
import type { LayoutPositions } from "./dagre-layout";
import { canLayOutOffThread } from "./layout-runner";
import type { AdminCollection, AdminPostgresCollection } from "@rebasepro/cms-types";

// ─── Column info extracted from a collection ──────────────────────────

export interface ColumnInfo {
    name: string;
    type: string;
    /**
     * The type the collection declares — `string`, `number`, `date`… — or
     * `FK` for a relation's key. Not the database's column type: the diagram
     * is drawn from the collections, and a property's column type depends on
     * more than its `type` (`columnType`, `isId`, integer validation).
     */
    typeLabel: string;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    isRequired: boolean;
    isEnum: boolean;
    enumValues?: string[];
    relationName?: string;
}

// ─── Node data shape ──────────────────────────────────────────────────

export interface TableNodeData {
    tableName: string;
    collectionName: string;
    slug: string;
    columns: ColumnInfo[];
    isJunction: boolean;
    isUnmanaged: boolean;
    rlsEnabled: boolean;
    historyEnabled: boolean;
    icon?: string;
    [key: string]: unknown;
}

// ─── Extract columns from a AdminCollection ─────────────────────────

const extractColumns = (collection: AdminCollection): ColumnInfo[] => {
    const columns: ColumnInfo[] = [];
    const properties = collection.properties ?? {};

    for (const [propName, prop] of Object.entries(properties)) {
        if (prop.type === "relation") continue; // Relations are shown as edges, not columns

        const isPk =
            ("isId" in prop && Boolean(prop.isId)) ||
            (!Object.values(properties).some(
                (p) => "isId" in p && Boolean(p.isId)
            ) &&
                propName === "id");

        const isEnum = prop.type === "string" && "enum" in prop && Boolean(prop.enum);

        let enumValues: string[] | undefined;
        if (isEnum && "enum" in prop && prop.enum) {
            const enumProp = prop.enum;
            if (Array.isArray(enumProp)) {
                enumValues = enumProp.map((v: unknown) =>
                    typeof v === "string" ? v : String((v as Record<string, unknown>)?.id ?? v)
                );
            } else if (typeof enumProp === "object" && enumProp !== null) {
                enumValues = Object.keys(enumProp);
            }
        }

        columns.push({
            name: propName,
            type: prop.type,
            typeLabel: prop.type,
            isPrimaryKey: isPk,
            isForeignKey: false,
            isRequired: Boolean(prop.validation?.required),
            isEnum,
            enumValues
        });
    }

    // Add FK columns from owning relations
    if (isPostgresCollectionConfig(collection)) {
        try {
            const resolvedRelations = resolveCollectionRelations(collection);
            for (const rel of Object.values(resolvedRelations)) {
                if (rel.kind === "belongsTo" && rel.localKey) {
                    // Only add if not already present as a regular column
                    if (!columns.some((c) => c.name === rel.localKey)) {
                        columns.push({
                            name: rel.localKey,
                            type: "number",
                            typeLabel: "FK",
                            isPrimaryKey: false,
                            isForeignKey: true,
                            isRequired: false,
                            isEnum: false,
                            relationName: rel.relationName
                        });
                    } else {
                        // Mark existing column as FK
                        const existing = columns.find((c) => c.name === rel.localKey);
                        if (existing) {
                            existing.isForeignKey = true;
                            existing.relationName = rel.relationName;
                        }
                    }
                }
            }
        } catch {
            // Ignore resolution errors
        }
    }

    return columns;
};

// ─── Build graph from collections ─────────────────────────────────────

/**
 * Every table and relation the collections declare, not yet placed. Edges
 * carry their column handles without a side; {@link placeGraph} picks the
 * side once it knows where the tables are.
 */
interface SchemaGraph {
    nodes: Node[];
    edges: Edge[];
}

const buildGraph = (
    collections: AdminCollection[],
    liveRls: Set<string> | null
): SchemaGraph => {
    /**
     * Is RLS on for this table?
     *
     * The database is the authority whenever we could reach it. Declaring rules
     * in code is not the same as having them applied, and the hosted console
     * never sees the declarations at all — see `useLiveRlsTables`. Only when
     * there is no SQL capability do we fall back to what the config says.
     */
    const isRlsEnabled = (schema: string, tableName: string, declaresRules: boolean): boolean =>
        liveRls ? liveRls.has(`${schema}.${tableName}`) : declaresRules;

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const tableToNodeId = new Map<string, string>();
    // Track columns per node so we can resolve handle IDs for edges
    const nodeColumns = new Map<string, ColumnInfo[]>();

    // Helper: find the PK column name for a node (falls back to "id")
    const getPkHandle = (nodeId: string): string => {
        const cols = nodeColumns.get(nodeId);
        const pk = cols?.find((c) => c.isPrimaryKey);
        return pk ? `target-${pk.name}` : "target-default";
    };

    // Helper: find the FK column name for a node pointing to a relation
    const getFkHandle = (nodeId: string, localKey: string | undefined): string => {
        if (!localKey) return "source-default";
        const cols = nodeColumns.get(nodeId);
        const fk = cols?.find((c) => c.name === localKey);
        return fk ? `source-${fk.name}` : "source-default";
    };

    // 1. Create nodes for each collection
    //
    // Named by `getTableName`, the table `db push` creates: `table`, or the
    // slug in snake case. The slug as it stands (`blog-posts`) names a table
    // the database does not have, and the live RLS answer is keyed by the real
    // one.
    for (const collection of collections) {
        if (!isPostgresCollectionConfig(collection)) continue;

        const tableName = getTableName(collection);
        const nodeId = `table-${tableName}`;
        tableToNodeId.set(tableName, nodeId);

        const columns = extractColumns(collection);
        nodeColumns.set(nodeId, columns);

        const nodeData: TableNodeData = {
            tableName,
            collectionName: collection.name,
            slug: collection.slug,
            columns,
            isJunction: false,
            isUnmanaged: false,
            rlsEnabled: isRlsEnabled(
                collection.schema ?? "public",
                tableName,
                Boolean(collection.securityRules && collection.securityRules.length > 0)
            ),
            historyEnabled: Boolean(collection.history),
            icon: typeof collection.icon === "string" ? collection.icon : undefined
        };

        nodes.push({
            id: nodeId,
            type: "tableNode",
            position: { x: 0,
y: 0 },
            data: nodeData
        });
    }

    // 2. Create junction table nodes and edges
    const processedJunctions = new Set<string>();

    for (const collection of collections) {
        if (!isPostgresCollectionConfig(collection)) continue;

        const tableName = getTableName(collection);
        const sourceNodeId = tableToNodeId.get(tableName);
        if (!sourceNodeId) continue;

        let resolvedRelations: Record<string, ResolvedRelation>;
        try {
            resolvedRelations = resolveCollectionRelations(collection);
        } catch {
            continue;
        }

        for (const [relationKey, rel] of Object.entries(resolvedRelations)) {
            let targetCollection: AdminCollection;
            try {
                targetCollection = rel.target();
            } catch {
                continue;
            }

            if (!isPostgresCollectionConfig(targetCollection)) continue;

            const targetTable = getTableName(targetCollection);
            const targetNodeId = tableToNodeId.get(targetTable);
            if (!targetNodeId) continue;

            // Draw the side that owns the storage: a foreign key on this table,
            // or the junction. `hasOne`/`hasMany` are the mirror image of a
            // `belongsTo` that is drawn from the other end, and `via` has no
            // single edge to draw.
            if (rel.kind !== "belongsTo" && rel.kind !== "manyToMany") continue;

            const direction = "owning" as const;
            const edgeData: RelationEdgeData = {
                cardinality: rel.cardinality,
                direction,
                relationName: rel.relationName ?? relationKey,
                hasJunction: rel.kind === "manyToMany",
                hasJoinPath: false,
                label: getCardinalityLabel(rel.cardinality, direction)
            };

            if (rel.kind === "manyToMany" && !processedJunctions.has(rel.through.table)) {
                // Many-to-many: create junction node + two edges
                processedJunctions.add(rel.through.table);
                const junctionNodeId = `junction-${rel.through.table}`;

                const junctionColumns: ColumnInfo[] = [
                    {
                        name: rel.through.sourceColumn,
                        type: "number",
                        typeLabel: "FK",
                        isPrimaryKey: true,
                        isForeignKey: true,
                        isRequired: true,
                        isEnum: false
                    },
                    {
                        name: rel.through.targetColumn,
                        type: "number",
                        typeLabel: "FK",
                        isPrimaryKey: true,
                        isForeignKey: true,
                        isRequired: true,
                        isEnum: false
                    }
                ];
                nodeColumns.set(junctionNodeId, junctionColumns);

                nodes.push({
                    id: junctionNodeId,
                    type: "tableNode",
                    position: { x: 0,
y: 0 },
                    data: {
                        tableName: rel.through.table,
                        collectionName: rel.through.table,
                        slug: rel.through.table,
                        columns: junctionColumns,
                        isJunction: true,
                        isUnmanaged: false,
                        // Junction tables get derived policies rather than
                        // declared ones, so the config can never say — but the
                        // database can, and usually says yes.
                        rlsEnabled: isRlsEnabled("public", rel.through.table, false),
                        historyEnabled: false
                    } satisfies TableNodeData
                });

                // Source table → junction (junction references source PK)
                const sourcePk = nodeColumns.get(sourceNodeId)?.find((c) => c.isPrimaryKey);
                edges.push({
                    id: `edge-${sourceNodeId}-${junctionNodeId}`,
                    source: sourceNodeId,
                    target: junctionNodeId,
                    sourceHandle: sourcePk ? `source-${sourcePk.name}` : "source-default",
                    targetHandle: `target-${rel.through.sourceColumn}`,
                    type: "relationEdge",
                    data: { ...edgeData,
label: "1:N" } as Record<string, unknown>,
                    markerEnd: { type: MarkerType.ArrowClosed,
width: 16,
height: 16 }
                });

                // Junction → target table
                edges.push({
                    id: `edge-${junctionNodeId}-${targetNodeId}`,
                    source: junctionNodeId,
                    target: targetNodeId,
                    sourceHandle: `source-${rel.through.targetColumn}`,
                    targetHandle: getPkHandle(targetNodeId),
                    type: "relationEdge",
                    data: { ...edgeData,
label: "N:1" } as Record<string, unknown>,
                    markerEnd: { type: MarkerType.ArrowClosed,
width: 16,
height: 16 }
                });
            } else if (rel.kind === "belongsTo") {
                // A foreign key on this table.
                edges.push({
                    id: `edge-${sourceNodeId}-${targetNodeId}-${relationKey}`,
                    source: sourceNodeId,
                    target: targetNodeId,
                    sourceHandle: getFkHandle(sourceNodeId, rel.localKey),
                    targetHandle: getPkHandle(targetNodeId),
                    type: "relationEdge",
                    data: { ...edgeData } as Record<string, unknown>,
                    markerEnd: { type: MarkerType.ArrowClosed,
width: 16,
height: 16 }
                });
            }
        }
    }
    return {
        nodes,
        edges
    };
};

/**
 * The graph at its laid-out positions, with each edge's handles on the sides
 * that face each other: a source left of its target exits right and enters
 * the target from the left, and the other way round.
 */
const placeGraph = (graph: SchemaGraph, positions: LayoutPositions): SchemaGraph => {
    const nodes = placeNodes(graph.nodes, positions);
    const edges = graph.edges.map((edge) => {
        const srcPos = positions[edge.source];
        const tgtPos = positions[edge.target];
        const srcBaseHandle = edge.sourceHandle ?? "source-default";
        const tgtBaseHandle = edge.targetHandle ?? "target-default";
        if (!srcPos || !tgtPos) {
            return {
                ...edge,
                sourceHandle: `${srcBaseHandle}-right`,
                targetHandle: `${tgtBaseHandle}-left`
            };
        }
        const sourceIsLeft = srcPos.x + NODE_WIDTH / 2 <= tgtPos.x + NODE_WIDTH / 2;
        return {
            ...edge,
            sourceHandle: `${srcBaseHandle}-${sourceIsLeft ? "right" : "left"}`,
            targetHandle: `${tgtBaseHandle}-${sourceIsLeft ? "left" : "right"}`
        };
    });
    return {
        nodes,
        edges
    };
};

// ─── Large schemas: one table's neighbourhood ─────────────────────────

/**
 * Above this many tables the diagram draws one table's neighbourhood, not
 * the whole schema. Laying out 300 cross-linked tables takes dagre several
 * seconds even in a worker, and a canvas of that many tables is no longer
 * something anyone reads.
 */
export const LARGE_SCHEMA_TABLES = 300;

/** How far from the focused table the drawn neighbourhood reaches. */
export type NeighbourhoodDepth = 1 | 2;

const isJunctionNode = (node: Node): boolean => Boolean((node.data as TableNodeData).isJunction);

/**
 * The tables within `depth` relations of `focus`, and every relation between
 * them.
 *
 * A junction table is not a step of its own: a many-to-many is one relation,
 * drawn through its junction. So distances are counted in half steps — an edge
 * that touches a junction is one, a foreign key between two tables is two.
 */
const neighbourhoodOf = (graph: SchemaGraph, focus: string, depth: NeighbourhoodDepth): SchemaGraph => {
    const junctions = new Set(graph.nodes.filter(isJunctionNode).map((node) => node.id));
    const adjacent = new Map<string, string[]>();
    for (const edge of graph.edges) {
        adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
        adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
    }
    const limit = depth * 2;
    const distance = new Map<string, number>([[focus, 0]]);
    const byDistance: string[][] = Array.from({ length: limit + 1 }, () => []);
    byDistance[0].push(focus);
    for (let reached = 0; reached <= limit; reached++) {
        for (const id of byDistance[reached]) {
            if (distance.get(id) !== reached) continue;
            for (const next of adjacent.get(id) ?? []) {
                const step = junctions.has(id) || junctions.has(next) ? 1 : 2;
                const nextDistance = reached + step;
                if (nextDistance > limit || (distance.get(next) ?? Infinity) <= nextDistance) continue;
                distance.set(next, nextDistance);
                byDistance[nextDistance].push(next);
            }
        }
    }
    return {
        nodes: graph.nodes.filter((node) => distance.has(node.id)),
        edges: graph.edges.filter((edge) => distance.has(edge.source) && distance.has(edge.target))
    };
};

/** The table with the most relations: where a large schema opens. */
const mostConnectedTable = (graph: SchemaGraph): string | undefined => {
    const degree = new Map<string, number>();
    for (const edge of graph.edges) {
        degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
        degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    let best: Node | undefined;
    for (const node of graph.nodes) {
        if (isJunctionNode(node)) continue;
        if (!best || (degree.get(node.id) ?? 0) > (degree.get(best.id) ?? 0)) best = node;
    }
    return best?.id;
};

// ─── Hook ─────────────────────────────────────────────────────────────

export interface UseSchemaGraphResult {
    /**
     * The tables and relations on the canvas, placed. Empty while
     * {@link layingOut} — the layout of a graph not seen before runs in a
     * worker, never in render.
     */
    nodes: Node[];
    edges: Edge[];
    /** Every table and junction table in the schema, drawn or not. */
    allNodes: Node[];
    relayout: () => void;
    /** Tables and relations in the whole schema. */
    tableCount: number;
    relationCount: number;
    /** The layout is running off the main thread. */
    layingOut: boolean;
    /**
     * Set when the schema has more than {@link LARGE_SCHEMA_TABLES} tables:
     * which table's neighbourhood is drawn, how far it reaches, how many
     * tables that is, and how many there are in all.
     */
    neighbourhood: { focus: string; depth: NeighbourhoodDepth; shown: number; total: number } | null;
}

const EMPTY_GRAPH: SchemaGraph = {
    nodes: [],
    edges: []
};
const NO_POSITIONS: LayoutPositions = {};

export const useSchemaGraph = (
    collections: AdminCollection[] | undefined,
    /**
     * `schema.table` for every table the database reports RLS on, or `null`
     * when there is no SQL capability to ask. See {@link useLiveRlsTables}.
     */
    liveRls: Set<string> | null = null,
    /**
     * The table whose neighbourhood a large schema draws, by node id. When it
     * is absent, or not a table of this schema, the most connected one. Not
     * read for a schema of {@link LARGE_SCHEMA_TABLES} tables or fewer, which
     * is drawn whole.
     */
    focus: string | null = null,
    depth: NeighbourhoodDepth = 1
): UseSchemaGraphResult => {
    const [version, setVersion] = useState(0);

    const relayout = useCallback(() => setVersion((v) => v + 1), []);

    const graph = useMemo(
        () => (collections && collections.length > 0 ? buildGraph(collections, liveRls) : EMPTY_GRAPH),
        [collections, liveRls]
    );

    const tables = graph.nodes.filter((node) => !isJunctionNode(node)).length;
    const large = tables > LARGE_SCHEMA_TABLES;
    const focused = large
        ? (focus && graph.nodes.some((node) => node.id === focus) ? focus : mostConnectedTable(graph)) ?? null
        : null;

    const drawn = useMemo(
        () => (focused ? neighbourhoodOf(graph, focused, depth) : graph),
        [graph, focused, depth]
    );
    const plan = useMemo(() => planLayout(drawn.nodes, drawn.edges), [drawn]);

    /**
     * Where the layout runs. Off the main thread wherever a worker can start;
     * in tests and on a server, here, as the visualizer always did.
     */
    const offThread = canLayOutOffThread();
    const [laidOut, setLaidOut] = useState<{ signature: string; positions: LayoutPositions } | null>(null);
    const [layoutError, setLayoutError] = useState<unknown>(null);

    const positions = drawn.nodes.length === 0
        ? NO_POSITIONS
        : cachedLayout(plan)
            ?? (laidOut?.signature === plan.signature ? laidOut.positions : undefined)
            ?? (offThread ? undefined : layOutNow(plan));

    useEffect(() => {
        if (!offThread || drawn.nodes.length === 0 || cachedLayout(plan)) return;
        let current = true;
        layOutInBackground(plan).then(
            (result) => {
                if (current) {
                    setLaidOut({
                        signature: plan.signature,
                        positions: result
                    });
                }
            },
            (error: unknown) => {
                if (current) setLayoutError(error);
            }
        );
        return () => {
            current = false;
        };
    }, [plan, offThread, drawn]);

    const placed = useMemo(
        () => (positions ? placeGraph(drawn, positions) : EMPTY_GRAPH),
        // `version` is the relayout button: new node objects put back every
        // table a person dragged.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [drawn, positions, version]
    );

    // The layout failing is the diagram failing, as it was when the layout
    // ran in render: the view's error boundary says so.
    if (layoutError) throw layoutError;

    return {
        nodes: placed.nodes,
        edges: placed.edges,
        allNodes: graph.nodes,
        relayout,
        tableCount: graph.nodes.length,
        relationCount: graph.edges.length,
        layingOut: positions === undefined,
        neighbourhood: focused
            ? {
                focus: focused,
                depth,
                shown: drawn.nodes.length,
                total: tables
            }
            : null
    };
};
