import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    applyEdgeChanges,
    applyNodeChanges,
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useNodesInitialized,
    useReactFlow
} from "@xyflow/react";
import type { Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
    CircularProgress,
    IconButton,
    iconSize,
    Maximize2Icon,
    RefreshCwIcon,
    ToggleButtonGroup,
    Tooltip,
    Typography,
    useIsDarkMode
} from "@rebasepro/ui";
import { useTableDescriptors, useTranslation } from "@rebasepro/app";
import { useSchemaGraph, type CatalogGraphTable, type NeighbourhoodDepth, type TableNodeData } from "./useSchemaGraph";
import { useLiveRlsTables } from "./useLiveRls";
import { TableNode } from "./TableNode";
import { RelationEdge } from "./RelationEdge";

const nodeTypes = { tableNode: TableNode };
const edgeTypes = { relationEdge: RelationEdge };

export interface TablesDiagramProps {
    /** Every table of the schema as the database's catalog reports it. */
    catalog: readonly CatalogGraphTable[];
    /** A table name: drawn with its neighbourhood (always, with `alwaysFocus`; on a large schema otherwise). */
    focusTable?: string | null;
    /** Draw `focusTable`'s neighbourhood whatever the schema's size — the Relations tab. */
    alwaysFocus?: boolean;
    /** A table name to centre the canvas on when it changes — the table list's selection in diagram mode. */
    highlightTable?: string | null;
    /** A table node was clicked. */
    onOpenTable?: (tableName: string) => void;
    /** No minimap: the canvas sits inside a tab, not across the whole view. */
    compact?: boolean;
}

function DiagramCanvas({ catalog, focusTable = null, alwaysFocus = false, highlightTable = null, onOpenTable, compact = false }: TablesDiagramProps) {
    const { t } = useTranslation();
    const reactFlowInstance = useReactFlow();
    const descriptors = useTableDescriptors();
    const liveRls = useLiveRlsTables();
    // React Flow stamps its own `light` / `dark` class on the canvas; follow the app.
    const isDark = useIsDarkMode();
    const [depth, setDepth] = useState<NeighbourhoodDepth>(1);
    const [largeFocus, setLargeFocus] = useState<string | null>(null);
    const focus = focusTable ? `table-${focusTable}` : largeFocus;
    const { nodes: laidOutNodes, edges: laidOutEdges, relayout, layingOut, neighbourhood, allNodes } = useSchemaGraph(
        descriptors.tables,
        liveRls,
        focus,
        depth,
        { catalog, alwaysFocus }
    );

    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);

    // While a new layout runs, what is drawn stays drawn.
    useEffect(() => {
        if (layingOut) return;
        setNodes(laidOutNodes);
        setEdges(laidOutEdges);
    }, [laidOutNodes, laidOutEdges, layingOut]);

    // The table the view is about is drawn selected.
    const selectedId = `table-${highlightTable ?? focusTable}`;
    useEffect(() => {
        setNodes((current) => current.map((node) => (Boolean(node.selected) === (node.id === selectedId) ? node : { ...node, selected: node.id === selectedId })));
    }, [selectedId, laidOutNodes]);

    const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)), []);
    const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)), []);

    /**
     * Fit the graph into view when it is first drawn, and whenever another
     * neighbourhood replaces it. React Flow's own `fitView` waits for the
     * nodes to be measured, so it is asked for in the commit that hands them over.
     */
    const fitPending = useRef(true);
    const drawnFocus = neighbourhood?.focus ?? null;
    useEffect(() => {
        fitPending.current = true;
    }, [drawnFocus, depth]);
    // Fit once React Flow has measured every node: a fit before that frames
    // nodes of no size and leaves the drawing zoomed onto one table.
    const nodesInitialized = useNodesInitialized();
    useEffect(() => {
        if (!fitPending.current || nodes.length === 0 || !nodesInitialized) return;
        fitPending.current = false;
        void reactFlowInstance.fitView({ padding: 0.15, duration: 400 });
    }, [nodes, nodesInitialized, reactFlowInstance]);

    // The list's selection centres its node — or, on a large schema, draws its neighbourhood.
    useEffect(() => {
        if (!highlightTable) return;
        const nodeId = `table-${highlightTable}`;
        if (neighbourhood && !alwaysFocus && neighbourhood.focus !== nodeId) {
            setLargeFocus(nodeId);
            return;
        }
        const node = nodes.find((candidate) => candidate.id === nodeId);
        if (node) void reactFlowInstance.setCenter(node.position.x + 140, node.position.y + 60, { zoom: 1.1, duration: 400 });
        // Centres on a change of selection, not on every node move.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [highlightTable]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        onOpenTable?.((node.data as TableNodeData).tableName);
    }, [onOpenTable]);

    const focusName = neighbourhood
        ? (allNodes.find((node) => node.id === neighbourhood.focus)?.data as TableNodeData | undefined)?.tableName ?? ""
        : "";

    return (
        <div className="relative h-full w-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                minZoom={0.1}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                colorMode={isDark ? "dark" : "light"}
                className="bg-surface-well"
            >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-surface-well" color={isDark ? "#272a2f" : "#d9d9dc"}/>
                <Controls
                    showInteractive={false}
                    className="!bg-surface-card !border !border-hairline !shadow-sm !rounded-lg [--xy-controls-button-background-color:var(--color-surface-card)] [--xy-controls-button-background-color-hover:var(--color-surface-card-hover)] [--xy-controls-button-color:var(--color-text-secondary)] dark:[--xy-controls-button-color:var(--color-text-secondary-dark)] [--xy-controls-button-color-hover:var(--color-text-primary)] dark:[--xy-controls-button-color-hover:var(--color-text-primary-dark)] [--xy-controls-button-border-color:var(--color-hairline)]"
                />
                {!compact && (
                    <MiniMap
                        nodeStrokeColor={(node) => {
                            const data = node.data as TableNodeData;
                            if (data.isJunction) return "#a78bfa";
                            if (data.rlsEnabled) return "#22c55e";
                            return "#6366f1";
                        }}
                        nodeColor={(node) => ((node.data as TableNodeData).isJunction ? (isDark ? "#3b2f6b" : "#ede9fe") : (isDark ? "#2b2d4a" : "#eef2ff"))}
                        maskColor={isDark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.08)"}
                        className="!bg-surface-card !border !border-hairline !shadow-sm !rounded-lg"
                    />
                )}
            </ReactFlow>

            <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2 pointer-events-none">
                <div className="pointer-events-auto">
                    {neighbourhood && (
                        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-surface-card rounded-lg border border-hairline shadow-sm">
                            <Typography variant="caption" color="secondary">
                                {alwaysFocus
                                    ? t("studio_tables_diagram_neighbourhood", { shown: neighbourhood.shown, total: neighbourhood.total, table: focusName })
                                    : t("studio_schema_neighbourhood", { shown: neighbourhood.shown, total: neighbourhood.total, table: focusName })}
                            </Typography>
                            <ToggleButtonGroup
                                aria-label={t("studio_tables_diagram_depth")}
                                value={String(neighbourhood.depth)}
                                onValueChange={(value) => setDepth(value === "2" ? 2 : 1)}
                                options={[
                                    { value: "1", label: t("studio_schema_neighbourhood_depth_1") },
                                    { value: "2", label: t("studio_schema_neighbourhood_depth_2") }
                                ]}
                            />
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 px-1 py-0.5 bg-surface-card rounded-lg border border-hairline shadow-sm pointer-events-auto">
                    <Tooltip title={t("studio_schema_visualizer_fit_view")}>
                        <IconButton aria-label={t("studio_schema_visualizer_fit_view")} size="small"
                            onClick={() => void reactFlowInstance.fitView({ padding: 0.15, duration: 400 })}>
                            <Maximize2Icon size={iconSize.smallest}/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t("studio_tables_diagram_relayout")}>
                        <IconButton aria-label={t("studio_tables_diagram_relayout")} size="small" onClick={relayout}>
                            <RefreshCwIcon size={iconSize.smallest}/>
                        </IconButton>
                    </Tooltip>
                </div>
            </div>

            {layingOut && (
                <div role="status" className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="flex items-center gap-2 px-3 py-2 bg-surface-card rounded-lg border border-hairline shadow-sm">
                        <CircularProgress size="smallest"/>
                        <Typography variant="caption" color="secondary">{t("studio_schema_laying_out")}</Typography>
                    </div>
                </div>
            )}

            {!compact && (
                <div className="absolute bottom-3 right-3 flex items-center gap-3 px-3 py-1.5 bg-surface-card rounded-lg border border-hairline shadow-sm">
                    <div className="flex items-center gap-1.5">
                        <div className="w-5 h-0.5 bg-indigo-500 rounded"/>
                        <Typography variant="caption" color="secondary">{t("studio_tables_diagram_legend_fk")}</Typography>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-5 h-0.5 bg-violet-500 rounded"/>
                        <Typography variant="caption" color="secondary">{t("studio_tables_diagram_legend_mn")}</Typography>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500"/>
                        <Typography variant="caption" color="secondary">{t("studio_rls_enabled")}</Typography>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-text-disabled dark:bg-text-disabled-dark"/>
                        <Typography variant="caption" color="secondary">{t("studio_tables_diagram_not_served")}</Typography>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * The schema as a diagram: the tables the server declares — with their
 * many-to-many relations drawn through junctions — and every other table and
 * foreign key the database's catalog holds.
 */
export function TablesDiagram(props: TablesDiagramProps) {
    const { t } = useTranslation();
    const descriptors = useTableDescriptors();
    if (!props.catalog.some((table) => table.kind === "table") && !descriptors.tables.some((table) => table.kind === "table")) {
        return (
            <div className="flex items-center justify-center h-full w-full p-6">
                <div className="max-w-md text-center flex flex-col gap-2">
                    <Typography variant="subtitle2">{t("studio_tables_diagram_empty")}</Typography>
                    <Typography variant="body2" color="secondary">{t("studio_tables_diagram_empty_body")}</Typography>
                </div>
            </div>
        );
    }
    return (
        <ReactFlowProvider>
            <DiagramCanvas {...props}/>
        </ReactFlowProvider>
    );
}
