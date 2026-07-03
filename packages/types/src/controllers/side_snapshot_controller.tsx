import type { Snapshot } from "../types/snapshots";
import type { SnapshotCollection } from "../types/collections";

/**
 * Props used to open a side dialog
 * @group Hooks and utilities
 */
export interface SnapshotSidePanelProps<M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * Absolute path of the snapshot
     */
    path: string;

    /**
     * ID of the snapshot, if not set, it means we are creating a new snapshot
     */
    snapshotId?: string | number;

    /**
     * Set this flag to true if you want to make a copy of an existing snapshot
     */
    copy?: boolean;

    /**
     * Open the snapshot with a selected sub-collection view. If the panel for this
     * snapshot was already open, it is replaced.
     */
    selectedTab?: string;

    /**
     * Use this prop to override the width of the form view.
     * e.g. "600px"
     */
    width?: number | string;

    /**
     * Collection representing the snapshots of this view.
     * If you leave it blank it will be induced by your navigation
     */
    collection?: SnapshotCollection<M>;

    /**
     * Should update the URL when opening the dialog.
     * Consider that if the collection that you provide is not defined in the base
     * config of your `Rebase` component, you will not be able to recreate
     * the state if copying the URL to a different window.
     */
    updateUrl?: boolean;

    /**
     * Callback when the snapshot is updated
     * @param params
     */
    onUpdate?: (params: { snapshot: Snapshot<M> }) => void;

    /**
     * Callback when the dialog is closed
     */
    onClose?: () => void;

    /**
     * Should this panel close when saving
     */
    closeOnSave?: boolean;

    /**
     * Override some form properties
     */
    formProps?: Record<string, unknown>;

    /**
     * Allow the user to open the snapshot fullscreen
     */
    allowFullScreen?: boolean;

    /**
     * Pre-populate the form with these values when creating a new snapshot.
     * Only applied when `snapshotId` is not set (i.e. the form is in "new" mode).
     * Useful for actions that fetch data from an external source (e.g. a URL)
     * and want to pre-fill the document before the user saves.
     */
    defaultValues?: Partial<M>;
}

/**
 * Controller to open the side dialog displaying snapshot forms
 * @group Hooks and utilities
 */
export interface SideSnapshotController {
    /**
     * Close the last panel
     */
    close: () => void;

    /**
     * Open a new snapshot sideDialog. By default, the collection and configuration
     * of the view is fetched from the collections you have specified in the
     * navigation.
     * At least you need to pass the path of the snapshot you would like
     * to edit. You can set a snapshotId if you would like to edit and existing one
     * (or a new one with that id).
     * @param props
     */
    open: <M extends Record<string, unknown> = Record<string, unknown>>(props: SnapshotSidePanelProps<M>) => void;

    /**
     * Replace the last open snapshot panel with the given one.
     * @param props
     */
    replace: <M extends Record<string, unknown> = Record<string, unknown>>(props: SnapshotSidePanelProps<M>) => void;
}
