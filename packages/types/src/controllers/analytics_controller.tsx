export type AnalyticsController = {

    /**
     * Callback used to get analytics events from the CMS
     */
    onAnalyticsEvent?: (event: AnalyticsEvent, data?: object) => void;

}

export type AnalyticsEvent =
    | "snapshot_click"
    | "snapshot_click_from_reference"

    | "reference_selection_clear"
    | "reference_selection_toggle"
    | "reference_selected_single"
    | "reference_selection_new_snapshot"

    | "edit_snapshot_clicked"
    | "snapshot_edited"
    | "new_snapshot_click"
    | "new_snapshot_saved"
    | "copy_snapshot_click"
    | "snapshot_copied"

    | "single_delete_dialog_open"
    | "multiple_delete_dialog_open"
    | "single_snapshot_deleted"
    | "multiple_snapshots_deleted"

    | "drawer_navigate_to_home"
    | "drawer_navigate_to_collection"
    | "drawer_navigate_to_view"

    | "home_navigate_to_collection"
    | "home_favorite_navigate_to_collection"
    | "home_navigate_to_view"
    | "home_navigate_to_admin_view"
    | "home_favorite_navigate_to_view"
    | "home_move_card"
    | "home_move_group"
    | "home_drop_new_group"

    | "collection_inline_editing"

    | "view_mode_changed"

    | "kanban_card_moved"
    | "kanban_column_reorder"
    | "kanban_property_changed"
    | "kanban_new_snapshot_in_column"
    | "kanban_backfill_order"

    | "card_view_snapshot_click"

    | "unmapped_event"
    ;
