"use client";
import React, { useCallback, useMemo } from "react";
import { ListView } from "../ListView";
import { Typography } from "../../components/Typography";
import { Checkbox } from "../../components/Checkbox";
import { DefaultCellRenderer } from "./DefaultCellRenderer";
import { cls } from "../../util";
import type {
    CollectionPropertyConfig,
    CollectionDataController,
    CellRendererOverride,
    CollectionViewSize,
    CollectionSelectionController,
} from "./CollectionViewTypes";
import { resolveTitlePropertyKey } from "./resolveTitleProperty";

import { getValueInPath } from "./utils";

/**
 * Props for the {@link CollectionListView} component.
 * @group Collection View
 */
export type CollectionListViewProps<T = Record<string, unknown>> = {
    dataController: CollectionDataController<T>;
    properties: Record<string, CollectionPropertyConfig>;
    propertiesOrder?: string[];
    idProperty?: string;
    titleProperty?: string;
    onRowClick?: (row: T) => void;
    cellRenderer?: CellRendererOverride<T>;
    size?: CollectionViewSize;
    selectionEnabled?: boolean;
    selectionController?: CollectionSelectionController<T>;
    highlightedItems?: T[];
    emptyComponent?: React.ReactNode;
    className?: string;
};

/**
 * Headless list view that wraps {@link ListView}.
 *
 * Each row displays a title (bold), subtitle with 1–2 secondary property values,
 * and optional selection support.
 *
 * @group Collection View
 */
export function CollectionListView<T extends Record<string, unknown> = Record<string, unknown>>({
    dataController,
    properties,
    propertiesOrder,
    idProperty = "id",
    titleProperty,
    onRowClick,
    cellRenderer,
    size = "m",
    selectionEnabled,
    selectionController,
    highlightedItems,
    emptyComponent,
    className,
}: CollectionListViewProps<T>) {
    const order = useMemo(
        () => propertiesOrder ?? Object.keys(properties),
        [propertiesOrder, properties]
    );

    // ── Resolve title property ───────────────────────────────────────
    const titlePropertyKey = useMemo(
        () => resolveTitlePropertyKey(order, properties, idProperty, titleProperty),
        [titleProperty, order, properties, idProperty]
    );

    // ── Subtitle properties (up to 2) ────────────────────────────────
    const subtitleProperties = useMemo(() => {
        const result: { key: string; property: CollectionPropertyConfig }[] = [];
        for (const key of order) {
            if (key === titlePropertyKey) continue;
            const prop = properties[key];
            if (prop && !prop.hideFromCollection) {
                result.push({ key, property: prop });
                if (result.length >= 2) break;
            }
        }
        return result;
    }, [order, properties, titlePropertyKey]);

    // ── Selection IDs ────────────────────────────────────────────────
    const selectedIds = useMemo(() => {
        if (!selectionController?.selectedItems) return undefined;
        const ids = new Set<string | number>();
        for (const item of selectionController.selectedItems) {
            const id = getValueInPath(item as Record<string, unknown>, idProperty);
            if (id !== undefined && id !== null) {
                ids.add(id as string | number);
            }
        }
        return ids;
    }, [selectionController?.selectedItems, idProperty]);

    // ── Highlighted IDs ──────────────────────────────────────────────
    const highlightedIds = useMemo(() => {
        if (!highlightedItems) return undefined;
        const ids = new Set<string | number>();
        for (const item of highlightedItems) {
            const id = getValueInPath(item as Record<string, unknown>, idProperty);
            if (id !== undefined && id !== null) {
                ids.add(id as string | number);
            }
        }
        return ids;
    }, [highlightedItems, idProperty]);

    // ── Selection handler ────────────────────────────────────────────
    const handleSelectionChange = useCallback(
        (item: T, selected: boolean) => {
            if (!selectionController) return;
            selectionController.setSelectedItems((prev) => {
                if (selected) {
                    return [...prev, item];
                }
                const itemId = getValueInPath(item as Record<string, unknown>, idProperty);
                return prev.filter((existing) => {
                    const existingId = getValueInPath(existing as Record<string, unknown>, idProperty);
                    return existingId !== itemId;
                });
            });
        },
        [selectionController, idProperty]
    );

    // ── Render row ───────────────────────────────────────────────────
    const renderRow = useCallback(
        (params: {
            item: T;
            index: number;
            style: React.CSSProperties;
            className: string;
            selected: boolean;
            highlighted: boolean;
            isLast: boolean;
            onClick: (e: React.MouseEvent) => void;
            onSelectionChange: (selected: boolean) => void;
        }): React.ReactNode => {
            const { item, style, className: rowClassName, selected, highlighted, onClick, onSelectionChange } = params;
            const titleValue = getValueInPath(item as Record<string, unknown>, titlePropertyKey);

            return (
                <div
                    style={style}
                    className={cls(
                        "flex items-center gap-3 px-4 cursor-pointer",
                        "hover:bg-surface-50 dark:hover:bg-surface-700",
                        "transition-colors duration-100",
                        selected && "bg-primary-50 dark:bg-primary-900/20",
                        highlighted && "bg-surface-100 dark:bg-surface-800",
                        rowClassName
                    )}
                    onClick={onClick}
                >
                    {/* Selection checkbox */}
                    {selectionEnabled && (
                        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                                checked={selected}
                                onCheckedChange={onSelectionChange}
                                size="small"
                            />
                        </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0 py-1">
                        {/* Title */}
                        <Typography variant="subtitle2" noWrap>
                            {String(titleValue ?? "")}
                        </Typography>

                        {/* Subtitle properties */}
                        {subtitleProperties.length > 0 && (
                            <div className="flex items-center gap-2">
                                {subtitleProperties.map(({ key, property }) => {
                                    const value = getValueInPath(item as Record<string, unknown>, key);

                                    if (cellRenderer) {
                                        const custom = cellRenderer({
                                            row: item,
                                            propertyKey: key,
                                            property,
                                            value,
                                            size: "tiny",
                                        });
                                        if (custom !== undefined) {
                                            return <React.Fragment key={key}>{custom}</React.Fragment>;
                                        }
                                    }

                                    return (
                                        <React.Fragment key={key}>
                                            <DefaultCellRenderer
                                                row={item}
                                                propertyKey={key}
                                                property={property}
                                                value={value}
                                                size="tiny"
                                            />
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            );
        },
        [titlePropertyKey, subtitleProperties, cellRenderer, selectionEnabled]
    );

    return (
        <div className={cls("w-full h-full overflow-auto", className)}>
            <ListView<T>
                data={dataController.data}
                dataLoading={dataController.loading}
                noMoreToLoad={dataController.noMoreToLoad}
                dataLoadingError={dataController.error}
                itemCount={dataController.itemCount}
                setItemCount={dataController.setItemCount}
                pageSize={dataController.pageSize}
                paginationEnabled={dataController.paginationEnabled}
                onItemClick={onRowClick}
                selectedIds={selectedIds}
                highlightedIds={highlightedIds}
                selectionEnabled={!!selectionEnabled}
                onSelectionChange={handleSelectionChange}
                size={size}
                renderRow={renderRow}
                emptyComponent={emptyComponent}
            />
        </div>
    );
}
