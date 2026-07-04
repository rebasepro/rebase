import React from "react";
import type { Snapshot } from "./snapshots";
import type { CollectionConfig, SelectionController } from "./collections";
import type { FormContext } from "./snapshot_views";
import type { User } from "../users";
import type { RebaseContext } from "../rebase_context";
import type { SidePanelController } from "../controllers/side_panel_controller";

/**
 * A snapshot action is a custom action that can be performed on a snapshot.
 * They are displayed in the snapshot view and in the collection view.
 */
export interface SnapshotAction<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {
    /**
     * Title of the action
     */
    name: string;

    /**
     * Key of the action. You only need to provide this if you want to
     * override the default actions, or if you are not passing the action
     * directly to the `snapshotActions` prop of a collection.
     * You can define your actions at the app level, in which case you
     * must provide a key.
     * The default actions are:
     * - edit
     * - delete
     * - copy
     */
    key?: string;

    /**
     * Icon of the action
     */
    icon?: React.ReactElement;

    /**
     * Callback when the action is clicked
     * @param props
     */
    onClick(props: SnapshotActionClickProps<M, USER>): Promise<void> | void;

    /**
     * Optional callback in case you want to disable the action
     * @param props
     */
    isEnabled?(props: SnapshotActionClickProps<M, USER>): boolean;

    /**
     * When true, this action is rendered inline on each row in the list view.
     * By default, snapshot actions only appear in the table view and snapshot form.
     * Use this for actions that should be easily accessible regardless of view mode.
     */
    showActionsInListView?: boolean;

    /**
     * Show this action collapsed in the menu of the collection view.
     * Defaults to true
     * If false, the action will be shown in the menu
     */
    collapsed?: boolean;

    /**
     * Show this action in the form, defaults to true
     */
    includeInForm?: boolean;

}

export type SnapshotActionClickProps<M extends Record<string, unknown>, USER extends User = User> = {
    snapshot?: Snapshot<M>;
    context?: RebaseContext<USER>;

    path?: string;
    collection?: CollectionConfig<M>;

    /**
     * Optional form context, present if the action is being called from a form.
     * This allows you to access the form state and methods, including modifying the form values.
     */
    formContext?: FormContext;

    /**
     * Present if this actions is being called from a side dialog only
     */
    sidePanelController?: SidePanelController;

    /**
     * Is the action being called from the collection view or from the snapshot form view?
     */
    view: "collection" | "form";

    /**
     * If the action is rendered in the form, is it open in a side panel or full screen?
     */
    openSnapshotMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * Optional selection controller, present if the action is being called from a collection view
     */
    selectionController?: SelectionController;

    /**
     * Optional highlight function to highlight the snapshot in the collection view
     * @param snapshot
     */
    highlightSnapshot?: (snapshot: Snapshot<Record<string, unknown>>) => void;

    /**
     * Optional unhighlight function to remove the highlight from the snapshot in the collection view
     * @param snapshot
     */
    unhighlightSnapshot?: (snapshot: Snapshot<Record<string, unknown>>) => void;

    /**
     * Optional function to navigate back (e.g. when deleting a snapshot or navigating from a form)
     */
    navigateBack?: () => void;

    /**
     * Callback to be called when the collection changes, e.g. after a snapshot is deleted or created.
     */
    onCollectionChange?: () => void;

};
