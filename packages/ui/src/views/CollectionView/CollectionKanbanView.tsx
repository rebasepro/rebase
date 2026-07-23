"use client";
import React, { useCallback, useMemo } from "react";
import { KanbanView } from "../KanbanView";
import type { BoardItem, BoardItemViewProps } from "../KanbanView";
import { Card } from "../../components/Card";
import { Typography } from "../../components/Typography";
import { DefaultCellRenderer } from "./DefaultCellRenderer";
import { cls } from "../../util";
import { cardClickableMixin, cardSelectedMixin } from "../../styles";
import type {
    CollectionPropertyConfig,
    CollectionDataController,
    CellRendererOverride,
    CollectionSelectionController,
    CollectionEnumValueConfig,
} from "./CollectionViewTypes";
import { resolveTitlePropertyKey } from "./resolveTitleProperty";

import { getValueInPath } from "./utils";

function getEnumLabel(enumConfig: CollectionPropertyConfig["enum"], key: string): string {
    if (!enumConfig) return key;
    if (enumConfig instanceof Map) {
        const cfg: CollectionEnumValueConfig | undefined = enumConfig.get(key);
        if (!cfg) return key;
        return typeof cfg === "string" ? cfg : cfg.label;
    }
    const cfg: CollectionEnumValueConfig | undefined = enumConfig[key];
    if (!cfg) return key;
    return typeof cfg === "string" ? cfg : cfg.label;
}

/**
 * Props for the {@link CollectionKanbanView} component.
 * @group Collection View
 */
export type CollectionKanbanViewProps<T = Record<string, unknown>> = {
    dataController: CollectionDataController<T>;
    properties: Record<string, CollectionPropertyConfig>;
    propertiesOrder?: string[];
    idProperty?: string;
    titleProperty?: string;
    kanbanProperty: string;
    onRowClick?: (row: T) => void;
    cellRenderer?: CellRendererOverride<T>;
    selectionEnabled?: boolean;
    selectionController?: CollectionSelectionController<T>;
    highlightedItems?: T[];
    emptyComponent?: React.ReactNode;
    onRowCreate?: (defaults?: Record<string, unknown>) => void;
    className?: string;
};

/**
 * Headless kanban view that wraps {@link KanbanView}.
 *
 * Groups data by a kanban property's enum values into columns.
 * Each card displays a title and 1–2 preview properties.
 *
 * @group Collection View
 */
export function CollectionKanbanView<T extends Record<string, unknown> = Record<string, unknown>>({
    dataController,
    properties,
    propertiesOrder,
    idProperty = "id",
    titleProperty,
    kanbanProperty,
    onRowClick,
    cellRenderer,
    emptyComponent,
    onRowCreate,
    className,
}: CollectionKanbanViewProps<T>) {
    const order = useMemo(
        () => propertiesOrder ?? Object.keys(properties),
        [propertiesOrder, properties]
    );

    // ── Resolve kanban columns ───────────────────────────────────────
    const columns = useMemo<string[]>(() => {
        const kanbanConfig = properties[kanbanProperty];
        if (kanbanConfig?.enum) {
            if (kanbanConfig.enum instanceof Map) {
                return Array.from(kanbanConfig.enum.keys()).map(String);
            }
            return Object.keys(kanbanConfig.enum);
        }
        // Deduce from data
        const seen = new Set<string>();
        for (const row of dataController.data) {
            const val = getValueInPath(row as Record<string, unknown>, kanbanProperty);
            if (val !== null && val !== undefined) {
                seen.add(String(val));
            }
        }
        return Array.from(seen);
    }, [properties, kanbanProperty, dataController.data]);

    // ── Column labels ────────────────────────────────────────────────
    const columnLabels = useMemo(() => {
        const kanbanConfig = properties[kanbanProperty];
        const labels: Record<string, string> = {};
        for (const col of columns) {
            labels[col] = getEnumLabel(kanbanConfig?.enum, col);
        }
        return labels;
    }, [properties, kanbanProperty, columns]);

    // ── Resolve title property ───────────────────────────────────────
    const titlePropertyKey = useMemo(
        () => resolveTitlePropertyKey(order, properties, idProperty, titleProperty),
        [titleProperty, order, properties, idProperty]
    );

    // ── Preview properties (up to 2) ─────────────────────────────────
    const previewProperties = useMemo(() => {
        const result: { key: string; property: CollectionPropertyConfig }[] = [];
        for (const key of order) {
            if (key === titlePropertyKey || key === kanbanProperty) continue;
            const prop = properties[key];
            if (prop && !prop.hideFromCollection) {
                result.push({ key, property: prop });
                if (result.length >= 2) break;
            }
        }
        return result;
    }, [order, properties, titlePropertyKey, kanbanProperty]);

    // ── Convert data to BoardItem<T>[] ───────────────────────────────
    const boardItems = useMemo<BoardItem<T>[]>(() => {
        return dataController.data.map((row, index) => {
            const id = getValueInPath(row as Record<string, unknown>, idProperty);
            return {
                id: id !== null && id !== undefined ? String(id) : String(index),
                data: row,
            };
        });
    }, [dataController.data, idProperty]);

    // ── Assign column ────────────────────────────────────────────────
    const assignColumn = useCallback(
        (item: BoardItem<T>): string => {
            const val = getValueInPath(item.data as Record<string, unknown>, kanbanProperty);
            const strVal = val !== null && val !== undefined ? String(val) : "";
            if (columns.includes(strVal)) return strVal;
            return columns[0] ?? "";
        },
        [kanbanProperty, columns]
    );

    // ── Item component ───────────────────────────────────────────────
    const ItemComponent = useMemo(() => {
        function KanbanCard(props: BoardItemViewProps<T>) {
            const { item } = props;
            const titleValue = getValueInPath(
                item.data as Record<string, unknown>,
                titlePropertyKey
            );

            return (
                <Card
                    onClick={() => onRowClick?.(item.data)}
                    className={cls(
                        "p-3",
                        cardClickableMixin,
                        props.isDragging && cardSelectedMixin,
                        props.isDragging && "shadow-lg opacity-75"
                    )}
                >
                    <Typography variant="subtitle2" noWrap>
                        {String(titleValue ?? "")}
                    </Typography>
                    {previewProperties.map(({ key, property }) => {
                        const value = getValueInPath(
                            item.data as Record<string, unknown>,
                            key
                        );

                        if (cellRenderer) {
                            const custom = cellRenderer({
                                row: item.data,
                                propertyKey: key,
                                property,
                                value,
                                size: "tiny",
                            });
                            if (custom !== undefined) {
                                return (
                                    <div key={key} className="mt-1">
                                        {custom}
                                    </div>
                                );
                            }
                        }

                        return (
                            <div key={key} className="mt-1">
                                <DefaultCellRenderer
                                    row={item.data}
                                    propertyKey={key}
                                    property={property}
                                    value={value}
                                    size="tiny"
                                />
                            </div>
                        );
                    })}
                </Card>
            );
        }
        return KanbanCard;
    }, [titlePropertyKey, previewProperties, cellRenderer, onRowClick]);

    // ── Add item to column ───────────────────────────────────────────
    const handleAddItemToColumn = useCallback(
        (column: string) => {
            onRowCreate?.({ [kanbanProperty]: column });
        },
        [onRowCreate, kanbanProperty]
    );

    if (columns.length === 0 && !dataController.loading) {
        return (
            <div className="flex items-center justify-center p-8">
                {emptyComponent ?? (
                    <Typography variant="body2" color="secondary">
                        No columns available for kanban view.
                    </Typography>
                )}
            </div>
        );
    }

    return (
        <KanbanView<T, string>
            columns={columns}
            columnLabels={columnLabels as Record<string, string>}
            data={boardItems}
            assignColumn={assignColumn}
            ItemComponent={ItemComponent}
            onAddItemToColumn={onRowCreate ? handleAddItemToColumn : undefined}
            className={className}
        />
    );
}
