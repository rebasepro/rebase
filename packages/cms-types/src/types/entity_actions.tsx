import React from "react";
import type { Entity } from "@rebasepro/types";

import type { SelectionController } from "../collections";
import type { FormContext } from "./entity_views";
import type { User } from "@rebasepro/types";
import type { RebaseContext } from "../rebase_context";
import type { SidePanelController } from "../controllers/side_panel_controller";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * A entity action is a custom action that can be performed on a entity.
 * They are displayed in the entity view and in the collection view.
 */
export interface EntityAction<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {
    /**
     * Title of the action
     */
    name: string;

    /**
     * Key of the action. You only need to provide this if you want to
     * override the default actions, or if you are not passing the action
     * directly to the `entityActions` prop of a collection.
     * You can define your actions at the app level, in which case you
     * must provide a key.
     * The default actions are:
     * - edit
     * - delete
     * - copy
     */
    key?: string;

    /**
     * Icon of the action: a Lucide icon name (`"FileBarChart"`) or an element.
     *
     * The name form is what lets a collection declare one from the config package,
     * which is plain `.ts` with no React dependency — an element would drag the
     * whole UI layer into a backend that only loads the collection for its schema.
     * It also matches how every other icon in a collection is written
     * (`admin.icon`, `entityViews[].icon`), which were already strings while this
     * one alone was not.
     */
    icon?: React.ReactElement | string;

    /**
     * Callback when the action is clicked
     * @param props
     */
    onClick(props: EntityActionClickProps<M, USER>): Promise<void> | void;

    /**
     * Optional callback in case you want to disable the action
     * @param props
     */
    isEnabled?(props: EntityActionClickProps<M, USER>): boolean;

    /**
     * When true, this action is rendered inline on each row in the list view.
     * By default, entity actions only appear in the table view and entity form.
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

export type EntityActionClickProps<M extends Record<string, unknown>, USER extends User = User> = {
    entity?: Entity<M>;
    context?: RebaseContext<USER>;

    path?: string;
    collection?: AdminCollection<M>;

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
     * Is the action being called from the collection view or from the entity form view?
     */
    view: "collection" | "form";

    /**
     * If the action is rendered in the form, is it open in a side panel or full screen?
     */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * Optional selection controller, present if the action is being called from a collection view
     */
    selectionController?: SelectionController;

    /**
     * Optional highlight function to highlight the entity in the collection view
     * @param entity
     */
    highlightEntity?: (entity: Entity<Record<string, unknown>>) => void;

    /**
     * Optional unhighlight function to remove the highlight from the entity in the collection view
     * @param entity
     */
    unhighlightEntity?: (entity: Entity<Record<string, unknown>>) => void;

    /**
     * Optional function to navigate back (e.g. when deleting a entity or navigating from a form)
     */
    navigateBack?: () => void;

    /**
     * Callback to be called when the collection changes, e.g. after a entity is deleted or created.
     */
    onCollectionChange?: () => void;

};
