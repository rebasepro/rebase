import type { EntityAction, AdminCollection } from "@rebasepro/cms-types";
import type { Entity } from "@rebasepro/types";
import { useMemo } from "react";
import { useCustomizationController, usePermissions } from "@rebasepro/app";
import { copyEntityAction, deleteEntityAction, unlinkEntityAction } from "../components/common/default_entity_actions";
import { mergeEntityActions } from "../util/entity_actions";
import { resolveEntityAction } from "../util/resolutions";
import { useChildViewSource } from "./useChildViewSource";

export interface UseRecordActionsParams<M extends Record<string, unknown>> {
    collection: AdminCollection<M>;
    path: string;
    entity?: Entity<M>;
}

/**
 * The actions you can perform *on* a record — copy, delete, and whatever the
 * collection adds — resolved against the current user's permissions.
 *
 * Extracted from the form's footer so the identity bar can own them. They are
 * not ways to leave the form, so they never belonged next to Save; putting them
 * in the bar's overflow menu is what let the footer disappear instead of
 * becoming a full-width strip holding two icon buttons.
 */
export function useRecordActions<M extends Record<string, unknown>>({
    collection,
    path,
    entity
}: UseRecordActionsParams<M>): EntityAction[] {

    const { canCreate, canDelete } = usePermissions();
    const customizationController = useCustomizationController();

    // Rows shared through a junction: the delete action here removes the link,
    // because that is what the server does for this path.
    const childViewSource = useChildViewSource(path);
    const isLinkedChildView = childViewSource?.kind === "relation" && childViewSource.mode === "linked";

    return useMemo((): EntityAction[] => {
        const customEntityActions = (collection.entityActions ?? [])
            .map(action => resolveEntityAction(action, customizationController.entityActions))
            .filter(Boolean) as EntityAction[];

        const createEnabled = canCreate(collection, path);
        const deleteEnabled = entity ? canDelete(collection, path, entity) : false;
        const disableActions = collection.disableDefaultActions ?? [];

        const actions: EntityAction[] = [];
        if (createEnabled && !disableActions.includes("copy"))
            actions.push(copyEntityAction);
        if (deleteEnabled && !disableActions.includes("delete"))
            actions.push(isLinkedChildView ? unlinkEntityAction : deleteEntityAction);

        const merged = customEntityActions.length
            ? mergeEntityActions(actions, customEntityActions)
            : actions;

        return merged.filter(a => a.includeInForm === undefined || a.includeInForm);
    }, [
        canCreate,
        canDelete,
        collection,
        path,
        customizationController.entityActions?.length,
        entity,
        collection.disableDefaultActions,
        isLinkedChildView
    ]);
}
