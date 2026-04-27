import type { EntityCollection, Property } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectionSize, Entity, EntityTableController, SelectionController } from "@rebasepro/types";
import { getEntityImagePreviewPropertyKey } from "@rebasepro/common";
import {
    Avatar,
    Checkbox,
    Chip,
    CircularProgress,
    cls,
    Typography,
    Separator,
    ArrowUpwardIcon,
    ArrowDownwardIcon
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
    size = "m"
}: EntityCollectionListViewProps<M>) {
    const authController = useAuthController();
    const customizationController = useCustomizationController();
    const analyticsController = useAnalyticsController();

    const containerRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const hasRestoredScroll = useRef(false);

    const {
        data,
        dataLoading,
        noMoreToLoad,
        dataLoadingError,
        itemCount,
        setItemCount,
        pageSize = 50,
        paginationEnabled,
        sortBy,
        setSortBy
    } = tableController;

    const isLoadingMore = useRef(false);

    // Infinite scroll with Intersection Observer
    useEffect(() => {
        if (!paginationEnabled || noMoreToLoad || dataLoading) return;
        if (!dataLoading) isLoadingMore.current = false;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !dataLoading && !noMoreToLoad && !isLoadingMore.current) {
                    isLoadingMore.current = true;
                    setItemCount?.((itemCount ?? pageSize) + pageSize);
                }
            },
            {
                root: containerRef.current,
                rootMargin: "400px",
                threshold: 0
            }
        );

        if (loadMoreRef.current) observer.observe(loadMoreRef.current);
        return () => observer.disconnect();
    }, [paginationEnabled, noMoreToLoad, dataLoading, itemCount, pageSize, setItemCount]);

    // Scroll restoration
    useEffect(() => {
        if (containerRef.current && initialScroll && !hasRestoredScroll.current && data.length > 0) {
            containerRef.current.scrollTop = initialScroll;
            hasRestoredScroll.current = true;
        }
    }, [initialScroll, data.length]);

    // Scroll tracking
    const lastScrollOffset = useRef(0);
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !onScroll) return;

        const handleScroll = () => {
            const currentOffset = container.scrollTop;
            const direction = currentOffset > lastScrollOffset.current ? "forward" : "backward";
            lastScrollOffset.current = currentOffset;
            onScroll({
                scrollDirection: direction,
                scrollOffset: currentOffset,
                scrollUpdateWasRequested: false
            });
        };

        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, [onScroll]);

    const resolvedCollection = collection;

    const titlePropertyKey = useMemo(
        () => getEntityTitlePropertyKey(resolvedCollection, customizationController.propertyConfigs),
        [resolvedCollection, customizationController.propertyConfigs]
    );

    const imagePropertyKey = useMemo(
        () => getEntityImagePreviewPropertyKey(resolvedCollection),
        [resolvedCollection]
    );

    const previewCount = getPreviewCount(size);

    // Detect date properties for "last modified" style display
    const datePropertyKey = useMemo(() => {
        const candidates = ["updated_at", "updatedAt", "modified_at", "modifiedAt", "created_at", "createdAt"];
        for (const candidate of candidates) {
            if (resolvedCollection.properties[candidate]) return candidate;
        }
        // Fall back to any date/datetime property
        for (const [key, prop] of Object.entries(resolvedCollection.properties)) {
            const p = prop as Property;
            if (p.type === "date") return key;
        }
        return undefined;
    }, [resolvedCollection.properties]);

    // Detect enum/status properties for chip display
    const statusPropertyKey = useMemo(() => {
        for (const [key, prop] of Object.entries(resolvedCollection.properties)) {
            const p = prop as Property;
            if (p.type === "string" && "enum" in p && p.enum && key !== titlePropertyKey) {
                return key;
            }
        }
        return undefined;
    }, [resolvedCollection.properties, titlePropertyKey]);

    const previewKeys = useMemo(
        () => getEntityPreviewKeys(authController, resolvedCollection, customizationController.propertyConfigs, undefined, 10)
            .filter(key => key !== titlePropertyKey && key !== imagePropertyKey && key !== statusPropertyKey && key !== datePropertyKey),
        [authController, resolvedCollection, customizationController.propertyConfigs, titlePropertyKey, imagePropertyKey, statusPropertyKey, datePropertyKey]
    );

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

        // Calculate how many extra columns we need to reach at least 4 columns total
        const showDate = datePropertyKey && size !== "xs";
        const showStatus = statusPropertyKey && size !== "xs" && size !== "s";
        
        const existingColsCount = 1 + (showStatus ? 1 : 0) + (showDate ? 1 : 0);
        const targetColsCount = 3;
        const neededExtraCols = Math.max(1, targetColsCount - existingColsCount);

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
        const extraColKeys = availableExtraKeys.slice(0, neededExtraCols);

        extraColKeys.forEach(key => {
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
    }, [resolvedCollection, titlePropertyKey, statusPropertyKey, datePropertyKey, size]);

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

    // Select all toggle
    const allSelected = data.length > 0 && data.every(e => isEntitySelected(e));
    const someSelected = data.some(e => isEntitySelected(e));

    const handleSelectAll = useCallback(() => {
        if (allSelected) {
            selectionController?.setSelectedEntities([]);
        } else {
            selectionController?.setSelectedEntities(data);
        }
    }, [allSelected, data, selectionController]);

    // Sort handler for column headers
    const handleSort = useCallback((propertyKey: string) => {
        if (!setSortBy) return;
        if (sortBy && sortBy[0] === propertyKey) {
            if (sortBy[1] === "asc") {
                setSortBy([propertyKey, "desc"]);
            } else {
                setSortBy(undefined);
            }
        } else {
            setSortBy([propertyKey, "asc"]);
        }
    }, [sortBy, setSortBy]);

    // Empty state
    if (!dataLoading && data.length === 0 && !dataLoadingError) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                {emptyComponent ?? (
                    <Typography variant="label" color="secondary">
                        No entries found
                    </Typography>
                )}
            </div>
        );
    }

    // Error state
    if (dataLoadingError) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <Typography className="text-red-500">
                    Error loading data: {dataLoadingError.message}
                </Typography>
            </div>
        );
    }

    const rowClasses = getRowClasses(size);
    const showImage = size !== "xs";

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 bg-surface-50/30 dark:bg-surface-900/10"
        >
            <div className="max-w-6xl mx-auto bg-white dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl shadow-sm overflow-hidden">
                {/* Column header row */}
                <div className={cls(
                    "flex items-center gap-4 px-5 py-3 sticky top-0 z-10",
                    "bg-surface-50/80 dark:bg-surface-900/80 backdrop-blur-md",
                    "border-b border-surface-200 dark:border-surface-800",
                    "text-[11px] font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-widest select-none"
                )}>
                    {/* Select All Checkbox */}
                    {selectionEnabled && (
                        <div className="flex-shrink-0 w-6">
                            <Checkbox
                                checked={allSelected}
                                indeterminate={someSelected && !allSelected}
                                onCheckedChange={handleSelectAll}
                                size="smallest"
                            />
                        </div>
                    )}

                    {/* Thumbnail placeholder */}
                    {showImage && <div className="flex-shrink-0 w-10" />}

                    {/* Dynamic Columns */}
                    {columns.map(col => {
                        const isOwningRelation = col.property?.type === "relation" && col.property.relation?.direction === "owning";
                        const isSortable = col.property ? (
                            ["string", "number", "boolean", "date"].includes(col.property.type) || isOwningRelation
                        ) : false;
                        
                        return (
                            <div
                                key={col.key}
                                className={cls(
                                    col.width,
                                    "flex items-center gap-1.5 transition-colors group",
                                    isSortable ? "cursor-pointer hover:text-surface-800 dark:hover:text-surface-100" : "cursor-default text-surface-400 dark:text-surface-500",
                                    col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : "justify-start"
                                )}
                                onClick={() => isSortable && handleSort(col.key)}
                            >
                                <span>{col.label}</span>
                                {isSortable && (
                                    sortBy && sortBy[0] === col.key ? (
                                        sortBy[1] === "asc"
                                            ? <ArrowUpwardIcon size="smallest" className="text-primary-500" />
                                            : <ArrowDownwardIcon size="smallest" className="text-primary-500" />
                                    ) : (
                                        <ArrowDownwardIcon size="smallest" className="opacity-0 group-hover:opacity-30 transition-opacity" />
                                    )
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Entity rows */}
                {data.map((entity, index) => (
                    <ListRow
                        key={`${entity.path}_${entity.id}`}
                        entity={entity}
                        collection={resolvedCollection}
                        onClick={handleEntityClick}
                        selected={isEntitySelected(entity)}
                        highlighted={isEntityHighlighted(entity)}
                        onSelectionChange={handleSelectionChange}
                        selectionEnabled={selectionEnabled}
                        columns={columns}
                        imagePropertyKey={imagePropertyKey}
                        previewKeys={previewKeys.length > 0 ? [previewKeys[0]] : []} // First property as subtitle
                        rowClasses={rowClasses}
                        showImage={showImage}
                        size={size}
                        isLast={index === data.length - 1}
                    />
                ))}

                {/* Load more trigger / Loading indicator */}
                <div
                    ref={loadMoreRef}
                    className="flex items-center justify-center py-6"
                >
                    {dataLoading && (
                        <CircularProgress size="small" />
                    )}
                    {!dataLoading && noMoreToLoad && data.length > 0 && (
                        <Typography variant="caption" color="secondary">
                            All {data.length} entries loaded
                        </Typography>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * Single row in the list view
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
    imagePropertyKey,
    previewKeys,
    rowClasses,
    showImage,
    size,
    isLast
}: {
    entity: Entity<M>;
    collection: EntityCollection<M>;
    onClick?: (entity: Entity<M>) => void;
    selected?: boolean;
    highlighted?: boolean;
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
    columns: any[];
    imagePropertyKey?: string;
    previewKeys: string[];
    rowClasses: string;
    showImage: boolean;
    size: CollectionSize;
    isLast: boolean;
}) {
    const imageProperty = imagePropertyKey ? collection.properties[imagePropertyKey] : undefined;
    const ofProp = imageProperty && "of" in imageProperty ? imageProperty.of : undefined;
    const usedImageProperty = ofProp ? (Array.isArray(ofProp) ? ofProp[0] : ofProp) : imageProperty;
    const imageValue = imagePropertyKey ? getValueInPath(entity.values, imagePropertyKey) : undefined;
    const usedImageValue = imageProperty !== undefined
        ? ("of" in imageProperty
            ? (((imageValue as unknown[]) ?? []).length > 0 ? (imageValue as unknown[])[0] : undefined)
            : imageValue)
        : undefined;

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

    // Resolve image URL string for the avatar
    const imageUrl = useMemo(() => {
        if (!usedImageValue) return undefined;
        if (typeof usedImageValue === "string") return usedImageValue;
        if (typeof usedImageValue === "object" && usedImageValue !== null && "url" in usedImageValue) {
            return (usedImageValue as { url: string }).url;
        }
        return undefined;
    }, [usedImageValue]);

    return (
        <div
            className={cls(
                "flex items-center gap-4 cursor-pointer group transition-all duration-200 relative",
                rowClasses,
                !isLast && "border-b border-surface-100 dark:border-surface-800/60",
                selected
                    ? "bg-primary-50/60 dark:bg-primary-900/20"
                    : highlighted
                        ? "bg-surface-100 dark:bg-surface-800/80"
                        : "hover:bg-surface-50/80 dark:hover:bg-surface-800/40"
            )}
            onClick={handleClick}
        >
            {/* Selection indicator line */}
            {selected && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary-500 rounded-r-full" />
            )}

            {/* Selection Checkbox */}
            {selectionEnabled && (
                <div
                    className={cls(
                        "flex-shrink-0 w-6 transition-opacity duration-200",
                        !selected && "opacity-0 group-hover:opacity-100"
                    )}
                    onClick={handleCheckboxClick}
                >
                    <Checkbox
                        checked={selected ?? false}
                        onCheckedChange={handleCheckboxChange}
                        size="smallest"
                    />
                </div>
            )}

            {/* Entity Icon / Avatar */}
            {showImage && (
                <div className="flex-shrink-0 transition-transform duration-200 group-hover:scale-105">
                    {usedImageValue && usedImageProperty ? (
                        <div className="w-10 h-10 rounded-lg shadow-sm border border-surface-200/50 dark:border-surface-700/50 relative overflow-hidden bg-surface-100 dark:bg-surface-800">
                            <PropertyPreview propertyKey={imagePropertyKey!} value={usedImageValue} property={usedImageProperty} size="small" fill={true} />
                        </div>
                    ) : (
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-surface-100 to-surface-200 dark:from-surface-800 dark:to-surface-900 flex items-center justify-center shadow-sm border border-surface-200/50 dark:border-surface-700/50">
                            <IconForView
                                collectionOrView={collection}
                                className="text-surface-500 dark:text-surface-400"
                                size="small"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Content Columns */}
            {columns.map((col, i) => {
                const value = getValueInPath(entity.values, col.key);

                if (col.isTitle) {
                    return (
                        <div key={col.key} className={col.width}>
                            <div className="flex items-center gap-2">
                                <div className="truncate">
                                    {value !== undefined ? (
                                        <Typography component="div" variant="body2" className="font-semibold text-surface-900 dark:text-surface-50 truncate transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400">
                                            <PropertyPreview
                                                propertyKey={col.key}
                                                value={value}
                                                property={col.property}
                                                size="small"
                                            />
                                        </Typography>
                                    ) : (
                                        <Typography component="div" variant="body2" className="font-semibold text-surface-500 dark:text-surface-400 font-mono text-xs transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400">
                                            {entity.id}
                                        </Typography>
                                    )}
                                </div>
                            </div>

                            {/* Preview property lines */}
                            {previewKeys.length > 0 && !collection.listProperties && (
                                <div className="flex items-center gap-2 mt-0.5">
                                    {previewKeys.map((key, i) => {
                                        const property = collection.properties[key] as Property;
                                        if (!property) return null;
                                        const previewValue = getValueInPath(entity.values, key);
                                        if (previewValue === undefined || previewValue === null || previewValue === "") return null;
                                        return (
                                            <React.Fragment key={key}>
                                                {i > 0 && (
                                                    <span className="text-surface-300 dark:text-surface-600">·</span>
                                                )}
                                                <div className="truncate text-xs text-surface-500 dark:text-surface-400 max-w-[200px]">
                                                    <PropertyPreview
                                                        propertyKey={key}
                                                        value={previewValue as never}
                                                        property={property}
                                                        size="small"
                                                    />
                                                </div>
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                }

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
    columns: any[];
    imagePropertyKey?: string;
    previewKeys: string[];
    rowClasses: string;
    showImage: boolean;
    size: CollectionSize;
    isLast: boolean;
}) => React.ReactElement;
