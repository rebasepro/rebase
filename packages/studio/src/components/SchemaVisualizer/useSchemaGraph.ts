import { useMemo, useState, useCallback, useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { columnTypeLabel } from "@rebasepro/types";
import type { ColumnDescriptor, ColumnType, RelationDescriptor, TableDescriptor } from "@rebasepro/types";
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

// ─── Column info extracted from a table descriptor ────────────────────

export interface ColumnInfo {
    /** The SQL column name: what the diagram shows, and what a foreign key's handle is named by. */
    name: string;
    /** The key on a JSON row, in the SDK and in filters. */
    key: string;
    /** The Postgres type's kind (`uuid`, `text`, `enum`…). */
    type: string;
    /** The Postgres type as SQL spells it: `varchar(255)`, `integer[]`, `numeric(10, 2)`. */
    typeLabel: string;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    /** `NOT NULL`. */
    isRequired: boolean;
    /** A single-column `UNIQUE` constraint. */
    isUnique: boolean;
    /** A Postgres enum, or a closed value set (`.oneOf`). */
    isEnum: boolean;
    enumValues?: string[];
    /** The `belongsTo` relation this column is the foreign key of. */
    relationName?: string;
}

// ─── Node data shape ──────────────────────────────────────────────────

export interface TableNodeData {
    tableName: string;
    /** The name the table was defined under. */
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

// ─── Columns of a table descriptor ────────────────────────────────────

function enumValuesOf(column: ColumnDescriptor): string[] | undefined {
    if (column.type.kind === "enum") return [...column.type.values];
    if (column.oneOf) return column.oneOf.map(String);
    return undefined;
}

const columnInfo = (column: ColumnDescriptor): ColumnInfo => {
    const enumValues = enumValuesOf(column);
    return {
        name: column.column,
        key: column.key,
        type: column.type.kind,
        typeLabel: columnTypeLabel(column.type),
        isPrimaryKey: column.primaryKey === true,
        isForeignKey: column.foreignKeyOf !== undefined,
        isRequired: !column.nullable,
        isUnique: column.unique === true,
        isEnum: enumValues !== undefined,
        ...(enumValues ? { enumValues } : {}),
        ...(column.foreignKeyOf !== undefined ? { relationName: column.foreignKeyOf } : {})
    };
};

/**
 * Every column the server serves, in physical order. A `belongsTo` whose key
 * column was withheld from this caller still names its column, so the edge
 * has a handle to leave from.
 */
const extractColumns = (table: TableDescriptor): ColumnInfo[] => {
    const columns = table.columns.map(columnInfo);
    for (const relation of table.relations) {
        if (relation.kind !== "belongsTo") continue;
        const existing = columns.find((c) => c.name === relation.localKey);
        if (existing) {
            existing.isForeignKey = true;
            existing.relationName = relation.name;
            continue;
        }
        columns.push({
            name: relation.localKey,
            key: relation.localField,
            type: "foreignKey",
            typeLabel: "FK",
            isPrimaryKey: false,
            isForeignKey: true,
            isRequired: false,
            isUnique: false,
            isEnum: false,
            relationName: relation.name
        });
    }
    return columns;
};

/** The integer type a column that points at a serial key holds. */
const SERIAL_REFERENCE: Partial<Record<ColumnType["kind"], ColumnType>> = {
    smallserial: { kind: "smallint" },
    serial: { kind: "integer" },
    bigserial: { kind: "bigint" }
};

/** The type label of a junction column: the type of the key it points at (a serial's integer). */
function keyTypeLabel(table: TableDescriptor | undefined): string {
    const key = table?.columns.find((column) => column.primaryKey === true);
    if (!key) return "FK";
    return columnTypeLabel(SERIAL_REFERENCE[key.type.kind] ?? key.type);
}

// ─── Build graph from the tables ──────────────────────────────────────

/**
 * Every table and relation the server declares, not yet placed. Edges carry
 * their column handles without a side; {@link placeGraph} picks the side once
 * it knows where the tables are.
 */
interface SchemaGraph {
    nodes: Node[];
    edges: Edge[];
}

const buildGraph = (
    tables: readonly TableDescriptor[],
    liveRls: Set<string> | null
): SchemaGraph => {
    /**
     * Is RLS on for this table?
     *
     * The database is the authority whenever we could reach it. Declaring rules
     * is not the same as having them applied — see `useLiveRlsTables`. Only
     * when there is no SQL capability do we fall back to the declaration:
     * every declared table's posture enables RLS.
     */
    const isRlsEnabled = (schema: string, tableName: string, declared: boolean): boolean =>
        liveRls ? liveRls.has(`${schema}.${tableName}`) : declared;

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const tableToNodeId = new Map<string, string>();
    // Track columns per node so we can resolve handle IDs for edges
    const nodeColumns = new Map<string, ColumnInfo[]>();
    const bySlug = new Map(tables.map((table) => [table.slug, table]));

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

    const drawn = tables.filter((table) => table.kind === "table");

    // 1. A node for each table, named by its SQL table — the live RLS answer
    //    is keyed by it.
    for (const table of drawn) {
        const nodeId = `table-${table.table}`;
        tableToNodeId.set(table.slug, nodeId);

        const columns = extractColumns(table);
        nodeColumns.set(nodeId, columns);

        const nodeData: TableNodeData = {
            tableName: table.table,
            collectionName: table.name,
            slug: table.slug,
            columns,
            isJunction: false,
            isUnmanaged: false,
            rlsEnabled: isRlsEnabled(table.schema, table.table, true),
            historyEnabled: table.history === true
        };

        nodes.push({
            id: nodeId,
            type: "tableNode",
            position: { x: 0,
y: 0 },
            data: nodeData
        });
    }

    // 2. Junction table nodes and edges
    const processedJunctions = new Set<string>();

    for (const table of drawn) {
        const sourceNodeId = tableToNodeId.get(table.slug);
        if (!sourceNodeId) continue;

        for (const rel of table.relations) {
            const targetNodeId = tableToNodeId.get(rel.target);
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
                relationName: rel.name,
                hasJunction: rel.kind === "manyToMany",
                hasJoinPath: false,
                label: getCardinalityLabel(rel.cardinality, direction)
            };

            if (rel.kind === "manyToMany") {
                if (processedJunctions.has(rel.through.table)) continue;
                processedJunctions.add(rel.through.table);
                drawJunction(table, rel, sourceNodeId, targetNodeId, edgeData);
            } else {
                // A foreign key on this table.
                edges.push({
                    id: `edge-${sourceNodeId}-${targetNodeId}-${rel.name}`,
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

    // Many-to-many: a junction node, and two edges.
    function drawJunction(
        table: TableDescriptor,
        rel: Extract<RelationDescriptor, { kind: "manyToMany" }>,
        sourceNodeId: string,
        targetNodeId: string,
        edgeData: RelationEdgeData
    ): void {
        const junctionNodeId = `junction-${rel.through.table}`;
        const junctionColumns: ColumnInfo[] = [
            {
                name: rel.through.sourceKey,
                key: rel.through.sourceKey,
                type: "foreignKey",
                typeLabel: keyTypeLabel(table),
                isPrimaryKey: true,
                isForeignKey: true,
                isRequired: true,
                isUnique: false,
                isEnum: false
            },
            {
                name: rel.through.targetKey,
                key: rel.through.targetKey,
                type: "foreignKey",
                typeLabel: keyTypeLabel(bySlug.get(rel.target)),
                isPrimaryKey: true,
                isForeignKey: true,
                isRequired: true,
                isUnique: false,
                isEnum: false
            },
            ...rel.through.pivot.map(columnInfo)
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
                // A junction gets derived policies, and the server switches
                // RLS on for it like any table it declares.
                rlsEnabled: isRlsEnabled(table.schema, rel.through.table, true),
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
            targetHandle: `target-${rel.through.sourceKey}`,
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
            sourceHandle: `source-${rel.through.targetKey}`,
            targetHandle: getPkHandle(targetNodeId),
            type: "relationEdge",
            data: { ...edgeData,
label: "N:1" } as Record<string, unknown>,
            markerEnd: { type: MarkerType.ArrowClosed,
width: 16,
height: 16 }
        });
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
    descriptors: readonly TableDescriptor[] | undefined,
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
        () => (descriptors && descriptors.length > 0 ? buildGraph(descriptors, liveRls) : EMPTY_GRAPH),
        [descriptors, liveRls]
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
