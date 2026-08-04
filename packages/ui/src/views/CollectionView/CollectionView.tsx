import React, { useCallback, useMemo, useState } from "react";
import { cls } from "../../util";
import { Typography } from "../../components/Typography";
import { CollectionViewToolbar } from "./CollectionViewToolbar";
import { CollectionTableView } from "./CollectionTableView";
import { CollectionCardView } from "./CollectionCardView";
import { CollectionListView } from "./CollectionListView";
import { CollectionKanbanView } from "./CollectionKanbanView";
import type {
    CollectionViewMode,
    CollectionViewSize,
    CollectionPropertyConfig,
    CollectionDataController,
    CellRendererOverride,
    CollectionSelectionController,
    KanbanPropertyOption
} from "./CollectionViewTypes";

/**
 * Props for the headless {@link CollectionView} component.
 *
 * This component is data-agnostic — it renders collection data based on
 * property configurations and callbacks, with ZERO coupling to any entity
 * or data layer.
 *
 * @group Collection View
 */
export interface CollectionViewProps<T = Record<string, unknown>> {
    // ── Data ──────────────────────────────────────────────────────────

    /**
     * Data controller providing rows, loading state, pagination,
     * filter/sort/search state and setters.
     */
    dataController: CollectionDataController<T>;

    /**
     * Property definitions keyed by property key.
     * Drives column rendering, cell formatting, and filter UI.
     */
    properties: Record<string, CollectionPropertyConfig>;

    /**
     * Display order of properties. If omitted, uses Object.keys(properties).
     */
    propertiesOrder?: string[];

    /**
     * Subset of property keys to actually display as columns.
     * If omitted, all non-hidden properties are shown.
     */
    displayedColumnIds?: string[];

    // ── Identity ──────────────────────────────────────────────────────

    /** Property key used as row identifier. Default: "id" */
    idProperty?: string;

    /** Property key used as the display title in card/list views */
    titleProperty?: string;

    // ── View configuration ────────────────────────────────────────────

    /** Title displayed above the collection. `false` to hide. */
    title?: string | false;

    /** Controlled view mode. If omitted, internal state is used. */
    viewMode?: CollectionViewMode;

    /** Default view mode when uncontrolled. Default: "list" */
    defaultViewMode?: CollectionViewMode;

    /** Which view modes are available in the toggle */
    enabledViews?: CollectionViewMode[];

    /** Callback when view mode changes */
    onViewModeChange?: (mode: CollectionViewMode) => void;

    // ── Size ──────────────────────────────────────────────────────────

    /** Controlled size. If omitted, internal state is used. */
    size?: CollectionViewSize;

    /** Default size. Default: "m" */
    defaultSize?: CollectionViewSize;

    /** Callback when size changes */
    onSizeChange?: (size: CollectionViewSize) => void;

    // ── Kanban ─────────────────────────────────────────────────────────

    /** Property key for kanban column grouping */
    kanbanProperty?: string;

    /** Available kanban property options (shown in view toggle) */
    kanbanPropertyOptions?: KanbanPropertyOption[];

    /** Callback when kanban column property changes */
    onKanbanPropertyChange?: (property: string) => void;

    // ── Interactions ──────────────────────────────────────────────────

    /** Called when a row is clicked */
    onRowClick?: (row: T) => void;

    /** Called when the "create" button is clicked */
    onRowCreate?: (defaults?: Record<string, unknown>) => void;

    /** Whether creation is allowed (shows the + button) */
    canCreate?: boolean;

    // ── Selection ─────────────────────────────────────────────────────

    /** Enable row selection checkboxes */
    selectionEnabled?: boolean;

    /** Selection controller */
    selectionController?: CollectionSelectionController<T>;

    /** Highlighted items (e.g. recently clicked) */
    highlightedItems?: T[];

    /** Callback for bulk delete */
    onMultipleDelete?: (rows: T[]) => void;

    // ── Custom rendering ──────────────────────────────────────────────

    /**
     * Custom cell renderer override. Return undefined to use default.
     * This is how the connected wrapper injects PropertyPreview.
     */
    cellRenderer?: CellRendererOverride<T>;

    /** Custom empty state component */
    emptyComponent?: React.ReactNode;

    // ── Toolbar ───────────────────────────────────────────────────────

    /** Actions rendered at the start (left) of the toolbar */
    toolbarActionsStart?: React.ReactNode;

    /** Actions rendered at the end (right) of the toolbar */
    toolbarActionsEnd?: React.ReactNode;

    /** Hide the built-in toolbar entirely */
    hideToolbar?: boolean;

    // ── Table-specific ────────────────────────────────────────────────

    /** Enable row hover highlight in table view */
    hoverRow?: boolean;

    /** Callback when table columns are resized */
    onColumnResize?: (params: { key: string; width: number }) => void;

    /** Callback when table columns are reordered */
    onColumnsOrderChange?: (keys: string[]) => void;

    // ── Style ─────────────────────────────────────────────────────────

    /** CSS class for the outer container */
    className?: string;
}

const DEFAULT_ENABLED_VIEWS: CollectionViewMode[] = ["list", "table", "cards", "kanban"];

/**
 * A data-agnostic collection view component that orchestrates table, card,
 * list, and kanban views — driven entirely by props.
 *
 * Zero imports from any entity or data layer. This component lives in
 * `@rebasepro/ui` and can be used with any data source.
 *
 * @example
 * ```tsx
 * import { CollectionView } from "@rebasepro/ui";
 *
 * <CollectionView
 *     dataController={{ data: myRows, loading: false, noMoreToLoad: true }}
 *     properties={{
 *         name: { type: "string", name: "Name" },
 *         email: { type: "string", name: "Email" },
 *     }}
 *     title="Contacts"
 *     onRowClick={(row) => openDetail(row.id)}
 * />
 * ```
 *
 * @group Collection View
 */
export function CollectionView<T extends Record<string, unknown> = Record<string, unknown>>({
    dataController,
    properties,
    propertiesOrder,
    displayedColumnIds,
    idProperty = "id",
    titleProperty,
    title,
    viewMode: viewModeProp,
    defaultViewMode = "list",
    enabledViews = DEFAULT_ENABLED_VIEWS,
    onViewModeChange: onViewModeChangeProp,
    size: sizeProp,
    defaultSize = "m",
    onSizeChange: onSizeChangeProp,
    kanbanProperty: kanbanPropertyProp,
    kanbanPropertyOptions,
    onKanbanPropertyChange: onKanbanPropertyChangeProp,
    onRowClick,
    onRowCreate,
    canCreate = true,
    selectionEnabled,
    selectionController,
    highlightedItems,
    onMultipleDelete,
    cellRenderer,
    emptyComponent,
    toolbarActionsStart,
    toolbarActionsEnd,
    hideToolbar,
    hoverRow = true,
    onColumnResize,
    onColumnsOrderChange,
    className
}: CollectionViewProps<T>) {

    // ── View mode state (uncontrolled with controlled override) ───────

    const [internalViewMode, setInternalViewMode] = useState<CollectionViewMode>(defaultViewMode);
    const viewMode = viewModeProp ?? internalViewMode;

    const onViewModeChange = useCallback((mode: CollectionViewMode) => {
        setInternalViewMode(mode);
        onViewModeChangeProp?.(mode);
    }, [onViewModeChangeProp]);

    // ── Size state (uncontrolled with controlled override) ────────────

    const [internalSize, setInternalSize] = useState<CollectionViewSize>(defaultSize);
    const size = sizeProp ?? internalSize;

    const onSizeChange = useCallback((s: CollectionViewSize) => {
        setInternalSize(s);
        onSizeChangeProp?.(s);
    }, [onSizeChangeProp]);

    // ── Kanban property state ─────────────────────────────────────────

    const [internalKanbanProperty, setInternalKanbanProperty] = useState<string | undefined>(kanbanPropertyProp);
    const kanbanProperty = kanbanPropertyProp ?? internalKanbanProperty;

    const onKanbanPropertyChange = useCallback((property: string) => {
        setInternalKanbanProperty(property);
        onKanbanPropertyChangeProp?.(property);
    }, [onKanbanPropertyChangeProp]);

    // Auto-detect kanban property if not provided
    const resolvedKanbanProperty = useMemo(() => {
        if (kanbanProperty) return kanbanProperty;
        // Find first enum property
        const order = propertiesOrder ?? Object.keys(properties);
        for (const key of order) {
            const prop = properties[key];
            if (prop && prop.type === "string" && prop.enum) {
                return key;
            }
        }
        return undefined;
    }, [kanbanProperty, properties, propertiesOrder]);

    // Build kanban property options from properties if not provided
    const resolvedKanbanPropertyOptions = useMemo((): KanbanPropertyOption[] => {
        if (kanbanPropertyOptions) return kanbanPropertyOptions;
        const options: KanbanPropertyOption[] = [];
        const order = propertiesOrder ?? Object.keys(properties);
        for (const key of order) {
            const prop = properties[key];
            if (prop && prop.type === "string" && prop.enum) {
                options.push({ key, label: prop.name });
            }
        }
        return options;
    }, [kanbanPropertyOptions, properties, propertiesOrder]);

    // ── Render ────────────────────────────────────────────────────────

    const sharedProps = {
        dataController,
        properties,
        propertiesOrder,
        idProperty,
        titleProperty,
        onRowClick,
        cellRenderer,
        selectionEnabled,
        selectionController,
        highlightedItems,
        emptyComponent,
    };

    function renderView() {
        switch (viewMode) {
            case "table":
                return (
                    <CollectionTableView<T>
                        {...sharedProps}
                        displayedColumnIds={displayedColumnIds}
                        size={size}
                        hoverRow={hoverRow}
                        onColumnResize={onColumnResize}
                        onColumnsOrderChange={onColumnsOrderChange}
                    />
                );
            case "cards":
                return (
                    <CollectionCardView<T>
                        {...sharedProps}
                        size={size}
                    />
                );
            case "kanban":
                return resolvedKanbanProperty ? (
                    <CollectionKanbanView<T>
                        {...sharedProps}
                        kanbanProperty={resolvedKanbanProperty}
                        // `canCreate` is documented as "whether creation is
                        // allowed (shows the + button)" and was destructured
                        // and read nowhere, so the button showed regardless.
                        // The kanban view draws its add affordance exactly when
                        // it has a callback, so withholding the callback is
                        // what the prop means.
                        onRowCreate={canCreate ? onRowCreate : undefined}
                    />
                ) : (
                    <div className="flex items-center justify-center p-8">
                        <Typography variant="body2" color="secondary">
                            No enum property available for kanban grouping.
                        </Typography>
                    </div>
                );
            case "list":
            default:
                return (
                    <CollectionListView<T>
                        {...sharedProps}
                        size={size}
                    />
                );
        }
    }

    return (
        <div
            className={cls(
                "overflow-hidden h-full w-full rounded-md flex flex-col",
                "dark:bg-surface-800",
                className
            )}
        >
            {/* Error banner */}
            {dataController.error && dataController.data.length > 0 && (
                <div className="flex items-center gap-4 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 flex-shrink-0">
                    <Typography variant="body2" className="text-red-700 dark:text-red-300 flex-1">
                        <strong>Warning:</strong> {dataController.error.message || "Failed to update data."}
                    </Typography>
                </div>
            )}

            {/* Toolbar */}
            {!hideToolbar && (
                <CollectionViewToolbar
                    viewMode={viewMode}
                    onViewModeChange={enabledViews.length > 1 ? onViewModeChange : undefined}
                    enabledViews={enabledViews}
                    size={size}
                    onSizeChange={onSizeChange}
                    searchString={dataController.searchString}
                    onSearchChange={dataController.setSearchString}
                    loading={dataController.loading}
                    actionsStart={toolbarActionsStart}
                    actionsEnd={toolbarActionsEnd}
                    kanbanPropertyOptions={viewMode === "kanban" ? resolvedKanbanPropertyOptions : undefined}
                    selectedKanbanProperty={resolvedKanbanProperty}
                    onKanbanPropertyChange={onKanbanPropertyChange}
                />
            )}

            {/* View */}
            <div className="flex-1 overflow-hidden">
                {renderView()}
            </div>
        </div>
    );
}
