import React from "react";
import type { VirtualTableSortKey } from "../../components/VirtualTable/VirtualTableProps";

/** Supported view modes */
export type CollectionViewMode = "table" | "cards" | "kanban" | "list";

/** Supported collection sizes */
export type CollectionViewSize = "xs" | "s" | "m" | "l" | "xl";

/**
 * Enum value configuration.
 * Simple form: string label
 * Extended form: object with label + optional color + disabled
 */
export type CollectionEnumValueConfig = string | {
    label: string;
    color?: string;
    disabled?: boolean;
};

/**
 * A data-agnostic property definition for rendering columns/cells.
 * This is a UI-only type — it describes HOW to render, not WHERE data lives.
 *
 * This shape is deliberately compatible with Rebase's Property type,
 * so the connected wrapper can pass properties with minimal mapping.
 */
export interface CollectionPropertyConfig {
    /** Property data type — determines how cells are rendered */
    type: "string" | "number" | "boolean" | "date" | "array" | "map" | "reference" | "relation" | "geopoint";

    /** Display name shown in column headers and card labels */
    name: string;

    /** Optional description, shown as tooltip on column header */
    description?: string;

    // —— Display configuration ——
    /** Column width in pixels */
    columnWidth?: number;
    /** If true, this property is not shown in collection views */
    hideFromCollection?: boolean;

    // —— Enum support ——
    /** Map of value → label/config for enum properties */
    enum?: Record<string, CollectionEnumValueConfig> | Map<string | number, CollectionEnumValueConfig>;

    // —— String-specific ——
    multiline?: boolean;
    previewAsTag?: boolean;
    url?: boolean | string;
    markdown?: boolean;
    storage?: boolean;
    email?: boolean;

    // —— Array-specific ——
    of?: CollectionPropertyConfig;

    // —— Map-specific ——
    properties?: Record<string, CollectionPropertyConfig>;
    propertiesOrder?: string[];

    // —— Date-specific ——
    mode?: "date" | "date_time";

    // —— UI overrides ——
    /** Custom preview component for this property */
    Preview?: React.ComponentType<CellRendererProps>;
}

/**
 * Data controller interface — the headless view reads data and state through this.
 * Consumer apps can build their own implementation.
 */
export interface CollectionDataController<T = Record<string, unknown>> {
    data: T[];
    loading: boolean;
    noMoreToLoad: boolean;
    error?: Error;

    filterValues?: Record<string, [string, unknown]>;
    setFilterValues?: (values: Record<string, [string, unknown]> | undefined) => void;

    /** The sort keys in order of significance; the second breaks ties on the first. */
    sortBy?: VirtualTableSortKey[];
    setSortBy?: (sort?: VirtualTableSortKey[]) => void;

    searchString?: string;
    setSearchString?: (search?: string) => void;
    clearFilter?: () => void;

    initialScroll?: number;
    onScroll?: (props: {
        scrollDirection: "forward" | "backward";
        scrollOffset: number;
        scrollUpdateWasRequested: boolean;
    }) => void;

    paginationEnabled?: boolean;
    pageSize?: number;
    itemCount?: number;
    setItemCount?: (count: number) => void;
}

/**
 * Props passed to cell renderers.
 */
export interface CellRendererProps<T = Record<string, unknown>> {
    row: T;
    propertyKey: string;
    property: CollectionPropertyConfig;
    value: unknown;
    size?: "small" | "medium" | "large" | "tiny";
    width?: number;
    height?: number;
}

/**
 * Custom cell renderer function type.
 * Return undefined to fall through to the default renderer.
 */
export type CellRendererOverride<T = Record<string, unknown>> =
    (props: CellRendererProps<T>) => React.ReactNode | undefined;

/**
 * Selection controller for the headless view.
 */
export interface CollectionSelectionController<T = Record<string, unknown>> {
    selectedItems: T[];
    setSelectedItems: React.Dispatch<React.SetStateAction<T[]>>;
}

/**
 * Kanban property option for the view mode toggle.
 */
export interface KanbanPropertyOption {
    key: string;
    label: string;
}
