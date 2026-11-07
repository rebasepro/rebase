/**
 * Headless Collection View components.
 *
 * Data-agnostic collection rendering — table, card, list, and kanban views
 * driven entirely by property configurations and callbacks.
 *
 * Zero imports from any entity or data layer.
 *
 * Deprecated, with every type below: use `CollectionPanel` from
 * `@rebasepro/cms`, which renders the same four views for a collection with
 * its permissions, actions, overrides, realtime updates and saved view state.
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
//
// `CollectionView` is the entry point. The per-mode views
// (table/card/list/kanban), the toolbar and the default cell renderer are
// internal: `CollectionView` selects and wires them from `mode`, and nothing
// outside this package consumed them directly. Their prop types stay exported
// so callers can still type overrides.
export { CollectionView } from "./CollectionView";
export type { CollectionViewProps } from "./CollectionView";

export type { CollectionViewToolbarProps } from "./CollectionViewToolbar";
export type { CollectionTableViewProps } from "./CollectionTableView";
export type { CollectionCardViewProps } from "./CollectionCardView";
export type { CollectionListViewProps } from "./CollectionListView";
export type { CollectionKanbanViewProps } from "./CollectionKanbanView";
