import { useMemo, useState, useCallback } from "react";
import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { isPostgresCollectionConfig } from "@rebasepro/types";
import type { Relation, ResolvedRelation } from "@rebasepro/types";
import { resolveCollectionRelations } from "@rebasepro/common";
import { getLayoutedElements, getCardinalityLabel, getTypeLabel, NODE_WIDTH } from "./schema-visualizer.utils";
import type { RelationEdgeData } from "./schema-visualizer.utils";
import type { AdminCollection, AdminPostgresCollection } from "@rebasepro/cms-types";

// ─── Column info extracted from a collection ──────────────────────────

export interface ColumnInfo {
    name: string;
    type: string;
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
            typeLabel: getTypeLabel(prop.type),
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

const buildGraph = (
    collections: AdminCollection[],
    liveRls: Set<string> | null
): { nodes: Node[]; edges: Edge[] } => {
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
    for (const collection of collections) {
        if (!isPostgresCollectionConfig(collection)) continue;

        const tableName = collection.table ?? collection.slug;
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

        const tableName = collection.table ?? collection.slug;
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

            const targetTable = targetCollection.table ?? targetCollection.slug;
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
    // 3. Apply dagre layout first to get node positions
    const layoutResult = getLayoutedElements(nodes, edges);

    // 4. Build a position lookup from the laid-out nodes
    const nodePositions = new Map<string, { x: number }>();
    for (const node of layoutResult.nodes) {
        nodePositions.set(node.id, { x: node.position.x });
    }

    // 5. Resolve handle sides based on relative node positions.
    //    If source is left of target → source exits Right, target enters Left.
    //    If source is right of target → source exits Left, target enters Right.
    for (const edge of layoutResult.edges) {
        const srcPos = nodePositions.get(edge.source);
        const tgtPos = nodePositions.get(edge.target);

        const srcBaseHandle = (edge.sourceHandle ?? "source-default") as string;
        const tgtBaseHandle = (edge.targetHandle ?? "target-default") as string;

        if (srcPos && tgtPos) {
            const srcCenterX = srcPos.x + NODE_WIDTH / 2;
            const tgtCenterX = tgtPos.x + NODE_WIDTH / 2;
            const sourceIsLeft = srcCenterX <= tgtCenterX;

            edge.sourceHandle = `${srcBaseHandle}-${sourceIsLeft ? "right" : "left"}`;
            edge.targetHandle = `${tgtBaseHandle}-${sourceIsLeft ? "left" : "right"}`;
        } else {
            edge.sourceHandle = `${srcBaseHandle}-right`;
            edge.targetHandle = `${tgtBaseHandle}-left`;
        }
    }

    return layoutResult;
};

// ─── Hook ─────────────────────────────────────────────────────────────

export interface UseSchemaGraphResult {
    nodes: Node[];
    edges: Edge[];
    relayout: () => void;
    tableCount: number;
    relationCount: number;
}

export const useSchemaGraph = (
    collections: AdminCollection[] | undefined,
    /**
     * `schema.table` for every table the database reports RLS on, or `null`
     * when there is no SQL capability to ask. See {@link useLiveRlsTables}.
     */
    liveRls: Set<string> | null = null
): UseSchemaGraphResult => {
    const [version, setVersion] = useState(0);

    const relayout = useCallback(() => setVersion((v) => v + 1), []);

    const { nodes, edges, tableCount, relationCount } = useMemo(() => {
        if (!collections || collections.length === 0) {
            return { nodes: [],
edges: [],
tableCount: 0,
relationCount: 0 };
        }
        const result = buildGraph(collections, liveRls);
        return {
            ...result,
            tableCount: result.nodes.length,
            relationCount: result.edges.length
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collections, version, liveRls]);

    return {
        nodes,
        edges,
        relayout,
        tableCount,
        relationCount
    };
};
