"use client";
import React, { useCallback, useMemo } from "react";
import { CardView } from "../CardView";
import { Card } from "../../components/Card";
import { Typography } from "../../components/Typography";
import { Checkbox } from "../../components/Checkbox";
import { DefaultCellRenderer } from "./DefaultCellRenderer";
import { cls } from "../../util";
import { cardSelectedMixin, fieldBackgroundMixin } from "../../styles";
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
 * Props for the {@link CollectionCardView} component.
 * @group Collection View
 */
export type CollectionCardViewProps<T = Record<string, unknown>> = {
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
 * Headless card grid view that wraps {@link CardView}.
 *
 * Renders each item as a card with an optional image, title,
 * preview properties, and selection support.
 *
 * @group Collection View
 */
export function CollectionCardView<T extends Record<string, unknown> = Record<string, unknown>>({
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
}: CollectionCardViewProps<T>) {
    const order = useMemo(
        () => propertiesOrder ?? Object.keys(properties),
        [propertiesOrder, properties]
    );

    // ── Resolve title property ───────────────────────────────────────
    const titlePropertyKey = useMemo(
        () => resolveTitlePropertyKey(order, properties, idProperty, titleProperty),
        [titleProperty, order, properties, idProperty]
    );

    // ── Resolve image property ───────────────────────────────────────
    const imageProperty = useMemo(() => {
        for (const key of order) {
            const prop = properties[key];
            if (prop && prop.type === "string" && prop.storage) {
                return key;
            }
        }
        return undefined;
    }, [order, properties]);

    // ── Preview properties (up to 3) ─────────────────────────────────
    const previewProperties = useMemo(() => {
        const result: { key: string; property: CollectionPropertyConfig }[] = [];
        for (const key of order) {
            if (key === titlePropertyKey || key === imageProperty) continue;
            const prop = properties[key];
            if (prop && !prop.hideFromCollection) {
                result.push({ key, property: prop });
                if (result.length >= 3) break;
            }
        }
        return result;
    }, [order, properties, titlePropertyKey, imageProperty]);

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

    // ── Render card ──────────────────────────────────────────────────
    const renderCard = useCallback(
        (
            item: T,
            extra: {
                selected: boolean;
                highlighted: boolean;
                onSelectionChange: (selected: boolean) => void;
                onClick: (e: React.MouseEvent) => void;
            }
        ): React.ReactNode => {
            const titleValue = getValueInPath(item as Record<string, unknown>, titlePropertyKey);
            const imageValue = imageProperty
                ? getValueInPath(item as Record<string, unknown>, imageProperty)
                : undefined;
            const hasImage = typeof imageValue === "string" && imageValue.length > 0;

            return (
                <Card
                    onClick={(e) => { if (e) extra.onClick(e); }}
                    className={cls(
                        "overflow-hidden relative",
                        extra.selected && cardSelectedMixin,
                        extra.highlighted && !extra.selected && "ring-1 ring-primary/50"
                    )}
                >
                    {/* Image */}
                    {imageProperty && (
                        hasImage ? (
                            <img
                                src={imageValue as string}
                                alt=""
                                className="w-full h-32 object-cover rounded-t-lg"
                            />
                        ) : (
                            <div className={cls("h-24 rounded-t-lg", fieldBackgroundMixin)} />
                        )
                    )}

                    {/* Selection checkbox */}
                    {selectionEnabled && (
                        <div
                            className="absolute top-2 right-2"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Checkbox
                                checked={extra.selected}
                                onCheckedChange={extra.onSelectionChange}
                                size="small"
                            />
                        </div>
                    )}

                    {/* Title */}
                    <Typography variant="subtitle2" noWrap className="px-3 pt-2 pb-1">
                        {String(titleValue ?? "")}
                    </Typography>

                    {/* Preview properties */}
                    {previewProperties.map(({ key, property }) => {
                        const value = getValueInPath(item as Record<string, unknown>, key);

                        if (cellRenderer) {
                            const custom = cellRenderer({
                                row: item,
                                propertyKey: key,
                                property,
                                value,
                                size: "small",
                            });
                            if (custom !== undefined) {
                                return (
                                    <div key={key} className="px-3 py-0.5">
                                        {custom}
                                    </div>
                                );
                            }
                        }

                        return (
                            <div key={key} className="px-3 py-0.5">
                                <DefaultCellRenderer
                                    row={item}
                                    propertyKey={key}
                                    property={property}
                                    value={value}
                                    size="small"
                                />
                            </div>
                        );
                    })}

                    <div className="pb-2" />
                </Card>
            );
        },
        [titlePropertyKey, imageProperty, previewProperties, cellRenderer, selectionEnabled]
    );

    return (
        <div className={cls("w-full h-full overflow-auto", className)}>
            <CardView<T>
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
                renderCard={renderCard}
                emptyComponent={emptyComponent}
            />
        </div>
    );
}
