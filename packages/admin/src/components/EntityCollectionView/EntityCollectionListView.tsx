import type { EntityCollection, Property } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectionSize, Entity, EntityTableController, SelectionController } from "@rebasepro/types";
// @ts-ignore
import { FixedSizeList as List, ListOnItemsRenderedProps } from "react-window";
import useMeasure from "react-use-measure";
import { getEntityImagePreviewPropertyKey } from "@rebasepro/common";
import {
    Checkbox,
    Chip,
    CircularProgress,
    cls,
    defaultBorderMixin,
    Typography
} from "@rebasepro/ui";
import { PropertyPreview } from "../../preview";
import {
    useAuthController,
    useCustomizationController
} from "@rebasepro/core";
import { useAnalyticsController } from "@rebasepro/core";
import { getEntityTitlePropertyKey, getEntityPreviewKeys } from "../../util/previews";
import { IconForView } from "@rebasepro/core";
import { getValueInPath } from "@rebasepro/utils";
import { useCollectionSlotKeys, resolveEntitySlots, type CollectionSlotKeys } from "./useEntityPreviewSlots";

export type EntityCollectionListViewProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: EntityCollection<M>;
    tableController: EntityTableController<M>;
    onEntityClick?: (entity: Entity<M>) => void;
    selectionController?: SelectionController<M>;
    selectionEnabled?: boolean;
    highlightedEntities?: Entity<M>[];
    emptyComponent?: React.ReactNode;
    onScroll?: (props: {
        scrollDirection: "forward" | "backward";
        scrollOffset: number;
        scrollUpdateWasRequested: boolean;
    }) => void;
    initialScroll?: number;
    /**
     * Size of the list rows.
     * - "xs": Most compact, single-line rows
     * - "s": Compact with minimal info
     * - "m": Balanced (default) — title + subtitle
     * - "l": Spacious with more preview fields
     * - "xl": Full detail with all preview fields
     */
    size?: CollectionSize;
    /**
     * ID of the currently selected/active entity. When set, the matching
     * row is visually highlighted with a primary accent.
     */
    selectedEntityId?: string | number;
};

type ListColumnDef = {
    key: string;
    label: string;
    property: Property;
    isTitle?: boolean;
    isStatus?: boolean;
    isDate?: boolean;
    align: "left" | "center" | "right";
    width: string;
};

/**
 * Get the number of preview property lines to show based on size
 */
function getPreviewCount(size: CollectionSize): number {
    switch (size) {
        case "xs": return 0;
        case "s": return 1;
        case "m": return 2;
        case "l": return 3;
        case "xl": return 4;
        default: return 2;
    }
}

/**
 * Fixed row height in pixels for react-window virtualisation.
 * Must match the visual height produced by getRowClasses (padding + content).
 */
function getRowHeight(size: CollectionSize): number {
    switch (size) {
        case "xs": return 44;
        case "s":  return 52;
        case "m":  return 72;
        case "l":  return 84;
        case "xl": return 96;
        default:   return 72;
    }
}

/**
 * Get row padding/spacing classes based on size
 */
function getRowClasses(size: CollectionSize): string {
    switch (size) {
        case "xs": return "py-2 px-5 min-h-[40px]";
        case "s": return "py-2.5 px-5 min-h-[48px]";
        case "m": return "py-3 px-5 min-h-[64px]";
        case "l": return "py-4 px-5 min-h-[76px]";
        case "xl": return "py-5 px-5 min-h-[88px]";
        default: return "py-3 px-5 min-h-[64px]";
    }
}

/**
 * Returns true if a property type should NOT be rendered via
 * PropertyPreview in list row columns (because it would blow up height).
 */
function isComplexPropertyType(property: Property): boolean {
    return property.type === "array"
        || property.type === "map"
        || property.type === "reference"
        || property.type === "relation";
}

/**
 * Render a complex value as a compact, single-line string.
 * - Arrays  → "Item, Item +3"
 * - Maps    → "4 fields"
 * - Refs    → entity ID
 * - Relations → entity ID or name
 */
function compactValueSummary(value: unknown, property: Property): string | null {
    if (value === undefined || value === null) return null;

    if (property.type === "array") {
        if (!Array.isArray(value)) return null;
        if (value.length === 0) return null;

        const of = "of" in property ? property.of : undefined;
        const innerProp = of ? (Array.isArray(of) ? of[0] : of) : undefined;

        // String/number arrays → join
        const labels = value.map((v: unknown) => {
            if (typeof v === "string") return v;
            if (typeof v === "number") return String(v);
            // Reference inside array
            if (v && typeof v === "object" && "id" in v) return String((v as Record<string, unknown>).id);
            // Enum label lookup
            if (innerProp && "enum" in innerProp && innerProp.enum && typeof v === "string") {
                const enumValues = innerProp.enum;
                if (Array.isArray(enumValues)) {
                    const match = enumValues.find((e: unknown) =>
                        typeof e === "object" && e !== null && "id" in e && (e as Record<string, unknown>).id === v
                    );
                    if (match && typeof match === "object" && "label" in match) return String((match as Record<string, unknown>).label);
                } else if (typeof enumValues === "object") {
                    const label = (enumValues as Record<string, unknown>)[v];
                    if (typeof label === "string") return label;
                    if (label && typeof label === "object" && "label" in label) return String((label as Record<string, unknown>).label);
                }
                return v;
            }
            return "•";
        });

        const MAX_SHOWN = 2;
        const shown = labels.slice(0, MAX_SHOWN).join(", ");
        const remaining = labels.length - MAX_SHOWN;
        return remaining > 0 ? `${shown} +${remaining}` : shown;
    }

    if (property.type === "map") {
        if (typeof value !== "object" || value === null) return null;
        const count = Object.keys(value).length;
        return count === 0 ? null : `${count} field${count !== 1 ? "s" : ""}`;
    }

    if (property.type === "reference") {
        if (typeof value === "string") return value;
        if (value && typeof value === "object" && "id" in value) return String((value as Record<string, unknown>).id);
        return null;
    }

    if (property.type === "relation") {
        // Relation data is often populated as { id, data: { ... } }
        if (typeof value === "string" || typeof value === "number") return String(value);
        if (value && typeof value === "object") {
            const obj = value as Record<string, unknown>;
            // Try to find a display name in relation data
            if (obj.data && typeof obj.data === "object") {
                const data = obj.data as Record<string, unknown>;
                const name = data.name ?? data.title ?? data.display_name ?? data.displayName ?? data.email;
                if (name) return String(name);
            }
            if ("id" in obj) return String(obj.id);
        }
        return null;
    }

    return null;
}

/**
 * Format a date value for display in the list
 */
function formatDateValue(value: unknown): string | null {
    if (!value) return null;
    let date: Date | null = null;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === "string" || typeof value === "number") {
        date = new Date(value);
    }
    if (!date || isNaN(date.getTime())) return null;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
        return "Yesterday";
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else {
        return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: diffDays > 365 ? "numeric" : undefined });
    }
}

/**
 * Classic CMS list view for displaying entities.
 * Designed to be the most familiar, stereotypical CMS content management view:
 * - Clean rows with checkbox, icon/avatar, title, metadata, and actions
 * - Column-sortable headers
 * - Infinite scroll
 */
export function EntityCollectionListView<M extends Record<string, unknown> = Record<string, unknown>>({
    collection,
    tableController,
    onEntityClick,
    selectionController,
    selectionEnabled = true,
    highlightedEntities,
    emptyComponent,
    onScroll,
    initialScroll,
    size = "m",
    selectedEntityId
}: EntityCollectionListViewProps<M>) {
    const authController = useAuthController();
    const customizationController = useCustomizationController();
    const analyticsController = useAnalyticsController();

    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<List>(null);
    const [measureRef, bounds] = useMeasure({
        debounce: 50,
        polyfill: ResizeObserver,
        offsetSize: true
    });

    const {
        data,
        dataLoading,
        noMoreToLoad,
        dataLoadingError,
        itemCount,
        setItemCount,
        pageSize = 50,
        paginationEnabled
    } = tableController;

    const isLoadingMore = useRef(false);

    // Infinite scroll via react-window onItemsRendered
    const onItemsRendered = useCallback(({ visibleStopIndex }: ListOnItemsRenderedProps) => {
        if (!paginationEnabled || noMoreToLoad || dataLoading || isLoadingMore.current) return;
        // Trigger load when within 10 rows of the end
        if (visibleStopIndex >= data.length - 10) {
            isLoadingMore.current = true;
            setItemCount?.((itemCount ?? pageSize) + pageSize);
        }
    }, [paginationEnabled, noMoreToLoad, dataLoading, data.length, itemCount, pageSize, setItemCount]);

    // Reset the loading-more gate when new data arrives
    useEffect(() => {
        if (!dataLoading) isLoadingMore.current = false;
    }, [dataLoading]);

    // Scroll restoration via react-window scrollTo
    const hasRestoredScroll = useRef(false);
    useEffect(() => {
        if (!initialScroll || hasRestoredScroll.current || data.length === 0) return;
        if (listRef.current) {
            listRef.current.scrollTo(initialScroll);
            hasRestoredScroll.current = true;
        }
    }, [initialScroll, data.length]);

    // Scroll tracking via react-window onScroll
    const lastScrollOffset = useRef(0);
    const handleListScroll = useCallback(({ scrollDirection, scrollOffset, scrollUpdateWasRequested }: {
        scrollDirection: "forward" | "backward";
        scrollOffset: number;
        scrollUpdateWasRequested: boolean;
    }) => {
        lastScrollOffset.current = scrollOffset;
        onScroll?.({
            scrollDirection,
            scrollOffset,
            scrollUpdateWasRequested
        });
    }, [onScroll]);

    // Responsive column count: derived from useMeasure bounds
    const containerWidth = bounds.width || 1200;

    const resolvedCollection = collection;

    // ── Shared slot resolution (replaces 4 individual useMemo calls) ──
    const slotKeys = useCollectionSlotKeys(
        resolvedCollection as EntityCollection<Record<string, unknown>>,
        authController,
        customizationController.propertyConfigs
    );
    const { titleKey: titlePropertyKey, imageKey: imagePropertyKey, subtitleKey, statusKey: statusPropertyKey, dateKey: datePropertyKey } = slotKeys;



    const previewKeys = useMemo(
        () => getEntityPreviewKeys(authController, resolvedCollection, customizationController.propertyConfigs, undefined, 10)
            .filter(key => key !== titlePropertyKey && key !== imagePropertyKey && key !== statusPropertyKey && key !== datePropertyKey),
        [authController, resolvedCollection, customizationController.propertyConfigs, titlePropertyKey, imagePropertyKey, statusPropertyKey, datePropertyKey]
    );


    const columns = useMemo(() => {
        const cols: ListColumnDef[] = [];
        
        const getIdealColumnWidth = (prop: Property) => {
            if (prop.type === "string" && "enum" in prop) return "flex-shrink-0 w-32";
            if (prop.type === "date" || prop.type === "number" || prop.type === "boolean") return "flex-shrink-0 w-28";
            if (prop.type === "reference" || prop.type === "relation") return "flex-shrink-0 w-56 lg:w-64";
            if (prop.type === "string") return "flex-shrink-0 w-40 lg:w-48";
            return "flex-shrink-0 w-40";
        };

        if (resolvedCollection.listProperties && resolvedCollection.listProperties.length > 0) {
            resolvedCollection.listProperties.forEach((key, index) => {
                const prop = resolvedCollection.properties[key] as Property;
                if (!prop) return;
                
                cols.push({
                    key,
                    label: prop.name || key,
                    property: prop,
                    isTitle: index === 0,
                    align: prop.type === "number" || prop.type === "date" ? "right" : "left",
                    width: index === 0 ? "flex-1 min-w-[200px]" : getIdealColumnWidth(prop)
                });
            });
            return cols;
        }

        // Smart default
        if (titlePropertyKey) {
            const prop = resolvedCollection.properties[titlePropertyKey] as Property;
            if (prop) {
                cols.push({
                    key: titlePropertyKey,
                    label: prop.name || "Name",
                    property: prop,
                    isTitle: true,
                    align: "left",
                    width: "flex-1 min-w-[200px]"
                });
            }
        }

        // Collect all candidate columns — visible count determined later by container width
        const showDate = datePropertyKey && size !== "xs";
        const showStatus = statusPropertyKey && size !== "xs" && size !== "s";

        // The first previewKey makes a great subtitle (strict rules: no relations, no large blocks).
        const subtitleKey = previewKeys.length > 0 ? previewKeys[0] : undefined;

        // For the additional columns, we can use any unused property (including relations!).
        const allKeys = resolvedCollection.propertiesOrder || Object.keys(resolvedCollection.properties);
        const usedKeys = new Set([
            titlePropertyKey,
            imagePropertyKey,
            statusPropertyKey,
            datePropertyKey,
            subtitleKey,
            "id"
        ]);

        const availableExtraKeys = allKeys.filter(k => !usedKeys.has(k) && resolvedCollection.properties[k]);

        availableExtraKeys.forEach(key => {
            const prop = resolvedCollection.properties[key] as Property;
            cols.push({
                key,
                label: prop.name || key,
                property: prop,
                align: prop.type === "number" || prop.type === "date" ? "right" : "left",
                width: getIdealColumnWidth(prop)
            });
        });

        if (showStatus && statusPropertyKey) {
            const prop = resolvedCollection.properties[statusPropertyKey] as Property;
            if (prop) {
                cols.push({
                    key: statusPropertyKey,
                    label: prop.name || "Status",
                    property: prop,
                    isStatus: true,
                    align: "center",
                    width: "flex-shrink-0 w-32"
                });
            }
        }

        if (showDate && datePropertyKey) {
            const prop = resolvedCollection.properties[datePropertyKey] as Property;
            if (prop) {
                cols.push({
                    key: datePropertyKey,
                    label: prop.name || "Modified",
                    property: prop,
                    isDate: true,
                    align: "right",
                    width: "flex-shrink-0 w-28"
                });
            }
        }

        return cols;
    }, [resolvedCollection, titlePropertyKey, statusPropertyKey, datePropertyKey, imagePropertyKey, previewKeys, size]);

    const showImage = size !== "xs";
    const rowHeight = getRowHeight(size);

    // Responsive: determine visible columns based on container width.
    // The first extra column requires significantly more available space (600px)
    // to ensure the title area has generous room before columns appear.
    // Each subsequent column needs 160px.
    const visibleColumns = useMemo(() => {
        if (columns.length <= 1) return columns;

        const titleCol = columns.find(c => c.isTitle);
        const extraCols = columns.filter(c => !c.isTitle);

        // Base width consumed by fixed-width elements (padding + checkbox + image + min title)
        const baseWidth = 40 + (selectionEnabled ? 40 : 0) + (showImage ? 56 : 0) + 200;
        const availableForExtra = Math.max(0, containerWidth - baseWidth);

        // First extra column needs 500px; each additional needs 160px
        const FIRST_COL_THRESHOLD = 500;
        const EXTRA_COL_WIDTH = 160;

        let maxExtraCols = 0;
        if (availableForExtra >= FIRST_COL_THRESHOLD) {
            maxExtraCols = 1 + Math.floor((availableForExtra - FIRST_COL_THRESHOLD) / EXTRA_COL_WIDTH);
        }

        return [
            ...(titleCol ? [titleCol] : []),
            ...extraCols.slice(0, maxExtraCols)
        ];
    }, [columns, containerWidth, selectionEnabled, showImage]);

    const handleEntityClick = useCallback((entity: Entity<M>) => {
        analyticsController.onAnalyticsEvent?.("entity_click", {
            path: entity.path,
            entityId: entity.id
        });
        onEntityClick?.(entity);
    }, [onEntityClick, analyticsController]);

    const handleSelectionChange = useCallback((entity: Entity<M>, selected: boolean) => {
        selectionController?.toggleEntitySelection(entity, selected);
    }, [selectionController]);

    const isEntitySelected = useCallback((entity: Entity<M>) => {
        return selectionController?.isEntitySelected(entity) ?? false;
    }, [selectionController]);

    const isEntityHighlighted = useCallback((entity: Entity<M>) => {
        return highlightedEntities?.some(e => e.id === entity.id && e.path === entity.path) ?? false;
    }, [highlightedEntities]);



    const rowClasses = getRowClasses(size);

    // Empty state
    const isEmpty = !dataLoading && data.length === 0 && !dataLoadingError;

    // Memoised row renderer for react-window
    const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
        const entity = data[index];
        if (!entity) return null;
        return (
            <div style={style}>
                <ListRow
                    entity={entity}
                    collection={resolvedCollection}
                    onClick={handleEntityClick}
                    selected={isEntitySelected(entity)}
                    highlighted={isEntityHighlighted(entity)}
                    onSelectionChange={handleSelectionChange}
                    selectionEnabled={selectionEnabled}
                    columns={visibleColumns}
                    slotKeys={slotKeys}
                    rowClasses={rowClasses}
                    showImage={showImage}
                    size={size}
                    isLast={index === data.length - 1}
                    isActive={selectedEntityId !== undefined && entity.id === selectedEntityId}
                />
            </div>
        );
    }, [data, resolvedCollection, handleEntityClick, isEntitySelected, isEntityHighlighted, handleSelectionChange, selectionEnabled, visibleColumns, slotKeys, rowClasses, showImage, size, selectedEntityId]);

    return (
        <div
            ref={(node) => {
                // Merge refs: useMeasure + containerRef
                measureRef(node);
                (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            }}
            className="flex-1 overflow-hidden bg-white dark:bg-surface-950"
        >
            {/* Error state */}
            {dataLoadingError ? (
                <div className="flex-1 flex items-center justify-center p-8">
                    <Typography className="text-red-500">
                        Error loading data: {dataLoadingError.message}
                    </Typography>
                </div>
            ) : isEmpty ? (
                <div className="flex-1 flex items-center justify-center p-8">
                    {emptyComponent ?? (
                        <Typography variant="label" color="secondary">
                            No entries found
                        </Typography>
                    )}
                </div>
            ) : (
                <>
                    <List
                        ref={listRef}
                        height={bounds.height || 600}
                        width={bounds.width || "100%"}
                        itemCount={data.length}
                        itemSize={rowHeight}
                        overscanCount={8}
                        onScroll={handleListScroll}
                        onItemsRendered={onItemsRendered}
                    >
                        {Row}
                    </List>

                    {/* Loading indicator (below the virtual list) */}
                    {dataLoading && (
                        <div className="flex items-center justify-center py-4">
                            <CircularProgress size="small" />
                        </div>
                    )}
                    {!dataLoading && noMoreToLoad && data.length > 0 && (
                        <div className="flex items-center justify-center py-2">
                            <Typography variant="caption" color="secondary">
                                All {data.length} entries loaded
                            </Typography>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * Single row in the list view.
 * Uses the shared slot system for a fixed editorial layout:
 *   [Checkbox] [Image] [Title + Subtitle] → spacer → [Status] [Date]
 *
 * When collection.listProperties is explicitly set, falls back to
 * the column system for developer-defined table layouts.
 */
const ListRow = React.memo(function ListRow<M extends Record<string, unknown>>({
    entity,
    collection,
    onClick,
    selected,
    highlighted,
    onSelectionChange,
    selectionEnabled,
    columns,
    slotKeys,
    rowClasses,
    showImage,
    size,
    isLast,
    isActive = false
}: {
    entity: Entity<M>;
    collection: EntityCollection<M>;
    onClick?: (entity: Entity<M>) => void;
    selected?: boolean;
    highlighted?: boolean;
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
    columns: ListColumnDef[];
    slotKeys: CollectionSlotKeys;
    rowClasses: string;
    showImage: boolean;
    size: CollectionSize;
    isLast: boolean;
    isActive?: boolean;
}) {
    // ── Resolve slots (pure function, no hooks) ──
    const slots = resolveEntitySlots(
        entity as Entity<Record<string, unknown>>,
        collection as EntityCollection<Record<string, unknown>>,
        slotKeys
    );

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Cmd+click (Mac) or Ctrl+click (Windows) toggles selection
        if ((e.metaKey || e.ctrlKey) && selectionEnabled) {
            e.preventDefault();
            onSelectionChange?.(entity, !selected);
            return;
        }
        onClick?.(entity);
    }, [entity, onClick, selected, selectionEnabled, onSelectionChange]);

    const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    const handleCheckboxChange = useCallback((checked: boolean) => {
        onSelectionChange?.(entity, checked);
    }, [entity, onSelectionChange]);

    // Developer-defined column mode (listProperties is explicitly set)
    const useColumnMode = !!collection.listProperties && collection.listProperties.length > 0;
    const extraColumns = useColumnMode ? columns.filter(c => !c.isTitle) : [];

    return (
        <div
            className={cls(
                "flex items-center gap-4 cursor-pointer group transition-all duration-200 relative",
                rowClasses,
                !isLast && "border-b",
                !isLast && defaultBorderMixin,
                isActive
                    ? "bg-surface-accent-50 dark:bg-surface-accent-950"
                    : selected
                        ? "bg-primary-50/60 dark:bg-primary-900/20"
                        : highlighted
                            ? "bg-surface-accent-50 dark:bg-surface-accent-950"
                            : "hover:bg-surface-50/80 dark:hover:bg-surface-800/40"
            )}
            onClick={handleClick}
        >
            {/* Selection indicator line */}
            {selected && !isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary-500 rounded-r-full" />
            )}

            {/* Selection Checkbox */}
            {selectionEnabled && (
                <div
                    className="flex-shrink-0 w-8"
                    onClick={handleCheckboxClick}
                >
                    <Checkbox
                        checked={selected ?? false}
                        onCheckedChange={handleCheckboxChange}
                        size="smallest"
                    />
                </div>
            )}

            {/* MEDIA slot → Image / Icon */}
            {showImage && (
                <div className="flex-shrink-0">
                    {slots.image ? (
                        <div className={cls("w-10 h-10 rounded-lg border relative overflow-hidden bg-surface-100 dark:bg-surface-800", defaultBorderMixin)}>
                            <PropertyPreview propertyKey={slots.image.propertyKey} value={slots.image.value} property={slots.image.property} size="small" fill={true} />
                        </div>
                    ) : (
                        <div className={cls("w-10 h-10 rounded-lg bg-surface-100 dark:bg-surface-800 flex items-center justify-center border", defaultBorderMixin)}>
                            <IconForView
                                collectionOrView={collection}
                                className="text-surface-500 dark:text-surface-400"
                                size="small"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* PRIMARY slot → Title + subtitle + byline */}
            <div className={cls("min-w-[180px]", useColumnMode ? "flex-1" : "flex-1 max-w-xl")}>
                <div className="truncate">
                    {slots.title?.value !== undefined ? (
                        <Typography component="div" variant="body2" className="font-semibold text-surface-900 dark:text-surface-50 truncate transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400">
                            <PropertyPreview
                                propertyKey={slots.title.propertyKey}
                                value={slots.title.value}
                                property={slots.title.property}
                                size="small"
                            />
                        </Typography>
                    ) : (
                        <Typography component="div" variant="body2" className="font-semibold text-surface-500 dark:text-surface-400 font-mono text-xs transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400">
                            {entity.id}
                        </Typography>
                    )}
                </div>

                {/* SUBTITLE slot — always plain truncated text */}
                {slots.subtitle && (
                    <div className="truncate mt-0.5">
                        <Typography variant="caption" className="text-surface-500 dark:text-surface-400 truncate">
                            {typeof slots.subtitle.value === "string"
                                ? slots.subtitle.value
                                : slots.subtitle.value != null
                                    ? String(slots.subtitle.value)
                                    : "—"}
                        </Typography>
                    </div>
                )}

                {/* RELATION CHIPS slot — compact chips for all relations */}
                {!useColumnMode && slots.relations.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 overflow-hidden max-w-full">
                        {slots.relations.map((rel) => (
                            rel.items.map((item) => (
                                <Chip
                                    key={`${rel.propertyKey}-${item.id}`}
                                    size="smallest"
                                    colorScheme={rel.colorScheme}
                                    className="!text-[10px] !leading-tight !py-0 shrink-0 max-w-[120px] truncate"
                                >
                                    {item.displayName}
                                </Chip>
                            ))
                        ))}
                        {slots.relations.some(r => r.totalCount > r.items.length) && (
                            <span className="text-[10px] text-surface-400 dark:text-surface-500 shrink-0">
                                +{slots.relations.reduce((acc, r) => acc + Math.max(0, r.totalCount - r.items.length), 0)}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {useColumnMode ? (
                /* ── COLUMN MODE (developer-defined listProperties) ── */
                <>
                    {extraColumns.map((col) => {
                        const value = getValueInPath(entity.values, col.key);

                        if (col.isStatus || (col.property.type === "string" && "enum" in col.property)) {
                            return (
                                <div key={col.key} className={cls(col.width, "flex", col.align === "center" ? "justify-center" : col.align === "right" ? "justify-end" : "justify-start")}>
                                    {value ? (
                                        <PropertyPreview propertyKey={col.key} value={value} property={col.property} size="small" />
                                    ) : <span className="text-surface-400">—</span>}
                                </div>
                            );
                        }

                        if (col.isDate || col.property.type === "date") {
                            return (
                                <div key={col.key} className={cls(col.width, col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left")}>
                                    <Typography variant="caption" className="whitespace-nowrap text-surface-400 dark:text-surface-500 font-medium">
                                        {formatDateValue(value) ?? "—"}
                                    </Typography>
                                </div>
                            );
                        }

                        // Complex types → compact single-line summary
                        if (isComplexPropertyType(col.property)) {
                            const summary = compactValueSummary(value, col.property);
                            return (
                                <div key={col.key} className={cls(col.width, "truncate", col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left")}>
                                    <Typography variant="caption" className="text-surface-500 dark:text-surface-400 truncate">
                                        {summary ?? "—"}
                                    </Typography>
                                </div>
                            );
                        }

                        // Simple scalar → PropertyPreview (single-line)
                        return (
                            <div key={col.key} className={cls(col.width, "truncate", col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left")}>
                                <Typography component="div" variant="body2" className="text-surface-600 dark:text-surface-300 truncate">
                                    {value !== undefined ? (
                                        <PropertyPreview propertyKey={col.key} value={value} property={col.property} size="small" />
                                    ) : "—"}
                                </Typography>
                            </div>
                        );
                    })}
                </>
            ) : (
                /* ── SLOT MODE (editorial scanner layout) ── */
                <>
                    {/* STATUS slot */}
                    {slots.status && (
                        <div className="flex-shrink-0">
                            <PropertyPreview
                                propertyKey={slots.status.propertyKey}
                                value={slots.status.value}
                                property={slots.status.property}
                                size="small"
                            />
                        </div>
                    )}

                    {/* DATE slot */}
                    {slots.date && (
                        <div className="flex-shrink-0 text-right min-w-[80px]">
                            <Typography variant="caption" className="whitespace-nowrap text-surface-400 dark:text-surface-500 font-medium">
                                {slots.date.formatted ?? "—"}
                            </Typography>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}) as <M extends Record<string, unknown>>(props: {
    entity: Entity<M>;
    collection: EntityCollection<M>;
    onClick?: (entity: Entity<M>) => void;
    selected?: boolean;
    highlighted?: boolean;
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
    columns: ListColumnDef[];
    slotKeys: CollectionSlotKeys;
    rowClasses: string;
    showImage: boolean;
    size: CollectionSize;
    isLast: boolean;
    isActive?: boolean;
}) => React.ReactElement;

