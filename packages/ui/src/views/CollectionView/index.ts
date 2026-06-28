/**
 * Headless Collection View components.
 *
 * Data-agnostic collection rendering — table, card, list, and kanban views
 * driven entirely by property configurations and callbacks.
 *
 * Zero imports from any entity or data layer.
 *
 * @module CollectionView
 */

// Types
export type {
    CollectionViewMode,
    CollectionViewSize,
    CollectionEnumValueConfig,
    CollectionPropertyConfig,
    CollectionDataController,
    CellRendererProps,
    CellRendererOverride,
    CollectionSelectionController,
    KanbanPropertyOption
} from "./CollectionViewTypes";

// Components
export { CollectionView } from "./CollectionView";
export type { CollectionViewProps } from "./CollectionView";

export { CollectionViewToolbar } from "./CollectionViewToolbar";
export type { CollectionViewToolbarProps } from "./CollectionViewToolbar";

export { CollectionTableView } from "./CollectionTableView";
export type { CollectionTableViewProps } from "./CollectionTableView";

export { CollectionCardView } from "./CollectionCardView";
export type { CollectionCardViewProps } from "./CollectionCardView";

export { CollectionListView } from "./CollectionListView";
export type { CollectionListViewProps } from "./CollectionListView";

export { CollectionKanbanView } from "./CollectionKanbanView";
export type { CollectionKanbanViewProps } from "./CollectionKanbanView";

export { DefaultCellRenderer } from "./DefaultCellRenderer";
