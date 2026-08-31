import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
    ReactFlow,
    Controls,
    MiniMap,
    Background,
    BackgroundVariant,
    useReactFlow,
    useNodesInitialized,
    ReactFlowProvider,
    applyNodeChanges,
    applyEdgeChanges
} from "@xyflow/react";
import type { Node, Edge, NodeChange, EdgeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
    SearchBar,
    TextField,
    Tooltip,
    Alert,
    Typography,
    cls,
    defaultBorderMixin,
    CircularProgress,
    ResizablePanels,
    IconButton
} from "@rebasepro/ui";
import {
    useStudioCollectionRegistry,
    IconForView
} from "@rebasepro/app";

import { isPostgresCollectionConfig } from "@rebasepro/types";
import { useSchemaGraph } from "./useSchemaGraph";
import { useLiveRlsTables } from "./useLiveRls";
import type { TableNodeData } from "./useSchemaGraph";
import { TableNode } from "./TableNode";
import { RelationEdge } from "./RelationEdge";
import type { AdminCollection } from "@rebasepro/cms-types";

// ─── Custom node / edge type registrations ────────────────────────────

const nodeTypes = {
    tableNode: TableNode
};

const edgeTypes = {
    relationEdge: RelationEdge
};

// ─── Inner component (needs ReactFlowProvider) ─────────────────────────

function SchemaVisualizerCanvas({
    collections
}: {
    collections: AdminCollection[];
}) {
    const reactFlowInstance = useReactFlow();
    const liveRls = useLiveRlsTables();
    const {
        nodes: layoutedNodes,
        edges: layoutedEdges,
        relayout,
        tableCount,
        relationCount
    } = useSchemaGraph(collections, liveRls);

    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const initialFitDone = useRef(false);

    // Sync layouted data into state
    useEffect(() => {
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }, [layoutedNodes, layoutedEdges]);

    const onNodesChange = useCallback(
        (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
        []
    );
    const onEdgesChange = useCallback(
        (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        []
    );

    /**
     * Fit the graph into view, once, as soon as it can be measured.
     *
     * This used to fire on a 200ms timer. `fitView` needs every node's real
     * width and height, which React Flow only knows after it has laid them out
     * and measured them — with a dozen tables, a cold Monaco-sized bundle and
     * a slow first paint, 200ms is often too early. The fit then ran against
     * zero-sized nodes and produced a viewport nothing lines up with, and
     * `initialFitDone` made sure it was never retried: the ERD opened as a
     * scatter of specks in a corner and stayed there until you hit "fit" by
     * hand. `useNodesInitialized` is the event this was approximating.
     */
    const nodesInitialized = useNodesInitialized();
    useEffect(() => {
        if (!nodesInitialized || nodes.length === 0 || initialFitDone.current) return;
        initialFitDone.current = true;
        reactFlowInstance.fitView({ padding: 0.15,
duration: 400 });
    }, [nodesInitialized, nodes.length, reactFlowInstance]);

    const handleFitView = useCallback(() => {
        reactFlowInstance.fitView({ padding: 0.15,
duration: 400 });
    }, [reactFlowInstance]);

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedTable(node.id);
    }, []);

    const handlePaneClick = useCallback(() => {
        setSelectedTable(null);
    }, []);

    // Focus on a table from the sidebar
    const handleTableSelect = useCallback(
        (nodeId: string) => {
            setSelectedTable(nodeId);
            const node = nodes.find((n) => n.id === nodeId);
            if (node) {
                reactFlowInstance.setCenter(
                    node.position.x + 140,
                    node.position.y + 60,
                    { zoom: 1.2,
duration: 400 }
                );
            }
        },
        [nodes, reactFlowInstance]
    );

    // Sidebar panel size
    const [sidebarSize, setSidebarSize] = useState(() => {
        try {
            const saved = localStorage.getItem("rebase_schema_viz_sidebar_size");
            return saved !== null ? parseFloat(saved) : 20;
        } catch {
            return 20;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(
                "rebase_schema_viz_sidebar_size",
                sidebarSize.toString()
            );
        } catch {
            // Ignore
        }
    }, [sidebarSize]);

    // Group collections for sidebar
    const postgresCollections = useMemo(
        () => collections.filter(isPostgresCollectionConfig),
        [collections]
    );

    const filteredCollections = useMemo(() => {
        if (!searchQuery.trim()) return postgresCollections;
        const q = searchQuery.toLowerCase();
        return postgresCollections.filter(
            (c) =>
                c.name.toLowerCase().includes(q) ||
                c.table?.toLowerCase().includes(q) ||
                c.slug?.toLowerCase().includes(q)
        );
    }, [postgresCollections, searchQuery]);

    // Junction table nodes
    const junctionNodes = useMemo(
        () =>
            nodes.filter(
                (n) => (n.data as TableNodeData).isJunction
            ),
        [nodes]
    );

    /**
     * The RLS answer for one collection, from the same place the graph used.
     *
     * `nodes` already carries it, so look it up there rather than re-deriving —
     * that is what kept the sidebar dots, the node badges and the total from
     * agreeing.
     */
    const rlsEnabledFor = useCallback(
        (collection: AdminCollection): boolean => {
            const table = (isPostgresCollectionConfig(collection) ? collection.table : undefined) ?? collection.slug;
            const node = nodes.find((n) => n.id === `table-${table}`);
            return Boolean((node?.data as TableNodeData | undefined)?.rlsEnabled);
        },
        [nodes]
    );

    // Stats
    const stats = useMemo(
        () => ({
            tables: tableCount,
            relations: relationCount,
            junctions: junctionNodes.length,
            // Counted off the nodes, which already carry the database's answer
            // where there was one — the same number the per-table badges show.
            // Counting `securityRules` here instead made the total disagree
            // with the badges, and read 0 in the hosted console, where the
            // contract endpoint strips those rules.
            withRls: nodes.filter((n) => (n.data as TableNodeData | undefined)?.rlsEnabled).length
        }),
        [
            tableCount,
            relationCount,
            junctionNodes.length,
            nodes
        ]
    );

    return (
        <ResizablePanels
            orientation="horizontal"
            panelSizePercent={sidebarSize}
            onPanelSizeChange={setSidebarSize}
            minPanelSizePx={220}
            firstPanel={
                <div
                    className={cls(
                        "flex flex-col h-full w-full bg-white dark:bg-surface-950 border-r",
                        defaultBorderMixin
                    )}
                >
                    {/* Sidebar header */}
                    <div
                        className={cls(
                            "flex items-center justify-between px-3 py-2 border-b bg-surface-50 dark:bg-surface-900 min-h-[48px]",
                            defaultBorderMixin
                        )}
                    >
                        <Typography
                            variant="caption"
                            className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark"
                        >
                            Tables
                        </Typography>
                        <Typography
                            variant="caption"
                            className="text-[10px] text-text-disabled dark:text-text-disabled-dark font-mono"
                        >
                            {stats.tables}
                        </Typography>
                    </div>

                    {/* Search */}
                    <div className="px-2 py-1.5 border-b border-surface-200/40 dark:border-surface-700/40">
                        <SearchBar
                            size="smallest"
                            placeholder="Filter tables…"
                            onTextSearch={(val) => setSearchQuery(val ?? "")}
                            innerClassName="text-xs"
                        />
                    </div>

                    {/* Table list */}
                    <div className="flex-grow overflow-y-auto no-scrollbar p-1">
                        {/* Regular collections */}
                        <div className="space-y-0.5">
                            {filteredCollections.map((collection) => {
                                const table = collection.table ?? collection.slug;
                                const nodeId = `table-${table}`;
                                const isSelected = selectedTable === nodeId;
                                return (
                                    <div
                                        key={nodeId}
                                        onClick={() =>
                                            handleTableSelect(nodeId)
                                        }
                                        className={cls(
                                            "flex items-center p-1.5 cursor-pointer rounded transition-colors group",
                                            isSelected
                                                ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-light"
                                                : "hover:bg-surface-100 dark:hover:bg-surface-950 text-text-secondary dark:text-text-secondary-dark"
                                        )}
                                    >
                                        <div className="shrink-0 mr-1.5 text-text-disabled dark:text-text-disabled-dark">
                                            <IconForView
                                                collectionOrView={{
                                                    slug: collection.slug,
                                                    name: collection.name,
                                                    icon:
                                                        typeof collection.icon ===
                                                        "string"
                                                            ? collection.icon
                                                            : undefined
                                                }}
                                                size="smallest"
                                            />
                                        </div>
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <Typography
                                                variant="caption"
                                                className="text-xs truncate font-medium"
                                            >
                                                {collection.name}
                                            </Typography>
                                            {table !== collection.name && (
                                                <Typography
                                                    variant="caption"
                                                    className="text-[10px] text-text-disabled dark:text-text-disabled-dark font-mono truncate"
                                                >
                                                    {table}
                                                </Typography>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 ml-1">
                                            {/* Same source as the node badge and the
                                                "RLS protected" total: the database when
                                                it could be asked, the config otherwise.
                                                Reading `securityRules` directly here made
                                                the three disagree. */}
                                            {rlsEnabledFor(collection) && (
                                                <Tooltip title="RLS enabled">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"/>
                                                </Tooltip>
                                            )}
                                            {collection.history && (
                                                <Tooltip title="History enabled">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400"/>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Junction tables */}
                        {junctionNodes.length > 0 && (
                            <div className="mt-3">
                                <Typography
                                    variant="caption"
                                    className="px-1.5 text-[10px] uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark font-medium"
                                >
                                    Junction Tables
                                </Typography>
                                <div className="mt-1 space-y-0.5">
                                    {junctionNodes.map((node) => {
                                        const d =
                                            node.data as TableNodeData;
                                        const isSelected =
                                            selectedTable === node.id;
                                        return (
                                            <div
                                                key={node.id}
                                                onClick={() =>
                                                    handleTableSelect(
                                                        node.id
                                                    )
                                                }
                                                className={cls(
                                                    "flex items-center p-1.5 cursor-pointer rounded transition-colors",
                                                    isSelected
                                                        ? "bg-primary/10 text-primary dark:bg-primary/20"
                                                        : "hover:bg-surface-100 dark:hover:bg-surface-950 text-text-disabled dark:text-text-disabled-dark"
                                                )}
                                            >
                                                <svg
                                                    className="w-3.5 h-3.5 mr-1.5 shrink-0"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                                                    />
                                                </svg>
                                                <Typography
                                                    variant="caption"
                                                    className="text-xs font-mono truncate"
                                                >
                                                    {d.tableName}
                                                </Typography>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stats footer */}
                    <div
                        className={cls(
                            "px-3 py-2 border-t bg-surface-50 dark:bg-surface-900 space-y-1",
                            defaultBorderMixin
                        )}
                    >
                        <div className="flex items-center justify-between">
                            <Typography
                                variant="caption"
                                className="text-[10px] text-text-disabled dark:text-text-disabled-dark"
                            >
                                Tables
                            </Typography>
                            <Typography
                                variant="caption"
                                className="text-[10px] font-mono font-medium"
                            >
                                {stats.tables}
                            </Typography>
                        </div>
                        <div className="flex items-center justify-between">
                            <Typography
                                variant="caption"
                                className="text-[10px] text-text-disabled dark:text-text-disabled-dark"
                            >
                                Relations
                            </Typography>
                            <Typography
                                variant="caption"
                                className="text-[10px] font-mono font-medium"
                            >
                                {stats.relations}
                            </Typography>
                        </div>
                        <div className="flex items-center justify-between">
                            <Typography
                                variant="caption"
                                className="text-[10px] text-text-disabled dark:text-text-disabled-dark"
                            >
                                RLS protected
                            </Typography>
                            <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500"/>
                                <Typography
                                    variant="caption"
                                    className="text-[10px] font-mono font-medium"
                                >
                                    {stats.withRls}
                                </Typography>
                            </div>
                        </div>
                    </div>
                </div>
            }
            secondPanel={
                <div className="flex-grow flex flex-col min-w-0 h-full w-full bg-white dark:bg-surface-950">
                    {/* Toolbar */}
                    <div
                        className={cls(
                            "flex items-center justify-between pr-2 border-b bg-white dark:bg-surface-950 min-h-[46px]",
                            defaultBorderMixin
                        )}
                    >
                        <div className="flex items-center gap-2 px-4">
                            <Typography
                                variant="subtitle2"
                                className="font-mono text-text-secondary dark:text-text-secondary-dark"
                            >
                                Schema Visualizer
                            </Typography>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            {/* Fit view */}
                            <Tooltip title="Fit to view">
                                <IconButton
                                    size="small"
                                    onClick={handleFitView}
                                >
                                    <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                                        />
                                    </svg>
                                </IconButton>
                            </Tooltip>

                            {/* Re-layout */}
                            <Tooltip title="Re-layout">
                                <IconButton
                                    size="small"
                                    onClick={relayout}
                                >
                                    <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                        />
                                    </svg>
                                </IconButton>
                            </Tooltip>
                        </div>
                    </div>

                    {/* Canvas */}
                    <div className="flex-grow relative">
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onNodeClick={handleNodeClick}
                            onPaneClick={handlePaneClick}
                            nodeTypes={nodeTypes}
                            edgeTypes={edgeTypes}
                            fitView
                            fitViewOptions={{ padding: 0.15 }}
                            minZoom={0.1}
                            maxZoom={2}
                            proOptions={{ hideAttribution: true }}
                            className="bg-surface-50 dark:bg-surface-950"
                        >
                            <Background
                                variant={BackgroundVariant.Dots}
                                gap={20}
                                size={1}
                                className="!bg-surface-50 dark:!bg-surface-950"
                                color="var(--rf-bg-dot, #d4d4d8)"
                            />
                            <Controls
                                showInteractive={false}
                                // mb clears the legend overlay pinned at bottom-left
                                className="!mb-16 !bg-white dark:!bg-surface-900 !border !border-surface-200/40 dark:!border-surface-700/40 !shadow-sm !rounded-lg dark:[--xy-controls-button-background-color:var(--color-surface-900)] dark:[--xy-controls-button-background-color-hover:var(--color-surface-800)] dark:[--xy-controls-button-color:var(--color-surface-300)] dark:[--xy-controls-button-color-hover:var(--color-surface-50)] dark:[--xy-controls-button-border-color:var(--color-surface-700)]"
                            />
                            <MiniMap
                                nodeStrokeColor={(n) => {
                                    const d = n.data as TableNodeData;
                                    if (d.isJunction) return "#a78bfa";
                                    if (d.rlsEnabled) return "#22c55e";
                                    return "#6366f1";
                                }}
                                nodeColor={(n) => {
                                    const d = n.data as TableNodeData;
                                    if (d.isJunction) return "#ede9fe";
                                    return "#eef2ff";
                                }}
                                maskColor="rgba(0,0,0,0.08)"
                                className="!bg-white dark:!bg-surface-900 !border !border-surface-200/40 dark:!border-surface-700/40 !shadow-sm !rounded-lg"
                            />
                        </ReactFlow>

                        {/* Legend overlay */}
                        <div className="absolute bottom-4 left-4 flex items-center gap-3 px-3 py-2 bg-white/90 dark:bg-surface-900/90 backdrop-blur-sm rounded-lg border border-surface-200/40 dark:border-surface-700/40 shadow-sm">
                            <div className="flex items-center gap-1.5">
                                <div className="w-6 h-0.5 bg-indigo-500 rounded"/>
                                <Typography
                                    variant="caption"
                                    className="text-[10px] text-text-disabled dark:text-text-disabled-dark"
                                >
                                    Owning
                                </Typography>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-6 h-0.5 bg-violet-500 rounded"/>
                                <Typography
                                    variant="caption"
                                    className="text-[10px] text-text-disabled dark:text-text-disabled-dark"
                                >
                                    M:N
                                </Typography>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <div
                                    className="w-6 h-0.5 rounded"
                                    style={{
                                        backgroundImage:
                                            "repeating-linear-gradient(90deg, #94a3b8, #94a3b8 4px, transparent 4px, transparent 7px)"
                                    }}
                                />
                                <Typography
                                    variant="caption"
                                    className="text-[10px] text-text-disabled dark:text-text-disabled-dark"
                                >
                                    Inverse
                                </Typography>
                            </div>
                            <div className="h-3 w-px bg-surface-200 dark:bg-surface-700"/>
                            <div className="flex items-center gap-1">
                                <span className="text-[9px]">🔑</span>
                                <Typography
                                    variant="caption"
                                    className="text-[10px] text-text-disabled dark:text-text-disabled-dark"
                                >
                                    PK
                                </Typography>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="text-[9px]">🔗</span>
                                <Typography
                                    variant="caption"
                                    className="text-[10px] text-text-disabled dark:text-text-disabled-dark"
                                >
                                    FK
                                </Typography>
                            </div>
                        </div>
                    </div>
                </div>
            }
        />
    );
}

// ─── Outer wrapper (provides ReactFlowProvider) ────────────────────────

export const SchemaVisualizer = () => {
    const { collections: registryCollections } =
        useStudioCollectionRegistry() as {
            collections?: AdminCollection[];
        };

    // Merge registry collections with any passed collections
    const collections = useMemo(() => {
        return registryCollections ?? [];
    }, [registryCollections]);

    if (!collections || collections.length === 0) {
        return (
            <div className="flex items-center justify-center h-full w-full">
                <div className="text-center space-y-3">
                    <CircularProgress size="small"/>
                    <Typography
                        variant="body2"
                        color="secondary"
                    >
                        Loading schema…
                    </Typography>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full bg-white dark:bg-surface-950 overflow-hidden text-text-primary dark:text-text-primary-dark">
            <ReactFlowProvider>
                <SchemaVisualizerCanvas collections={collections}/>
            </ReactFlowProvider>
        </div>
    );
};
