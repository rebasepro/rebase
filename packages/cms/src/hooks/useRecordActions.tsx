import type { EntityAction, EntityActionClickProps, AdminCollection } from "@rebasepro/cms-types";
import type { Entity } from "@rebasepro/types";
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { getIcon, useCustomizationController, usePermissions, useSnackbarController } from "@rebasepro/app";
import { copyEntityAction, deleteEntityAction, unlinkEntityAction } from "../components/common/default_entity_actions";
import { mergeEntityActions, placeEntityActions, resolveEntityActionState, type PlacedEntityActions } from "../util/entity_actions";
import { resolveEntityAction } from "../util/resolutions";
import { useChildViewSource } from "./useChildViewSource";
import { useUrlController } from "./navigation/contexts/UrlContext";
import { withListState } from "../util/view_mode";
import type { RecordActionItem } from "../components/EntityIdentityBar";
import { useSideDialogContext } from "../components/SideDialogs";

export interface UseRecordActionsParams<M extends Record<string, unknown>> {
    collection: AdminCollection<M>;
    path: string;
    entity?: Entity<M>;
    /**
     * What every action is called with — and asked `isEnabled` with. Undefined
     * until there is a record to act on.
     */
    clickProps?: EntityActionClickProps<Record<string, unknown>>;
}

/**
 * The actions you can perform *on* a record — copy, delete, and whatever the
 * collection adds — resolved against the current user's permissions, and
 * placed for the record's identity bar: buttons for the ones declared
 * `collapsed: false`, menu groups for the rest.
 *
 * Extracted from the form's footer so the identity bar can own them. They are
 * not ways to leave the form, so they never belonged next to Save's footer;
 * the bar carries them on the edit view and the read-only view alike.
 */
export function useRecordActions<M extends Record<string, unknown>>({
    collection,
    path,
    entity,
    clickProps
}: UseRecordActionsParams<M>): PlacedEntityActions<RecordActionItem> | undefined {

    const { canCreate, canDelete } = usePermissions();
    const customizationController = useCustomizationController();
    const snackbarController = useSnackbarController();

    // Rows shared through a junction: the delete action here removes the link,
    // because that is what the server does for this path.
    const childViewSource = useChildViewSource(path);
    const isLinkedChildView = childViewSource?.kind === "relation" && childViewSource.mode === "linked";

    const actions = useMemo((): EntityAction[] => {
        const customEntityActions = (collection.entityActions ?? [])
            .map(action => resolveEntityAction(action, customizationController.entityActions))
            .filter(Boolean) as EntityAction[];

        const createEnabled = canCreate(collection, path);
        const deleteEnabled = entity ? canDelete(collection, path, entity) : false;
        const disableActions = collection.disableDefaultActions ?? [];

        const defaults: EntityAction[] = [];
        if (createEnabled && !disableActions.includes("copy"))
            defaults.push(copyEntityAction);
        if (deleteEnabled && !disableActions.includes("delete"))
            defaults.push(isLinkedChildView ? unlinkEntityAction : deleteEntityAction);

        const merged = customEntityActions.length
            ? mergeEntityActions(defaults, customEntityActions)
            : defaults;

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

    return useMemo(() => {
        if (!clickProps?.entity || !actions.length) return undefined;

        const report = (action: EntityAction, error: unknown) => {
            console.error("Error executing action", action.key ?? action.name, error);
            snackbarController.open({
                type: "error",
                message: `${action.name}: ${error instanceof Error ? error.message : String(error)}`
            });
        };

        const items = actions.map((action, index): RecordActionItem & Pick<EntityAction, "collapsed"> => ({
            key: action.key ?? `${action.name}_${index}`,
            name: action.name,
            icon: getIcon(action.icon, undefined, undefined, "smallest"),
            collapsed: action.collapsed,
            ...resolveEntityActionState(action, clickProps),
            // A failure reaches the user rather than the console alone, wherever
            // the action was clicked from. A promise is handed back only when the
            // action returned one, so a button shows a spinner for work that is
            // actually running and never flashes one for a synchronous call.
            run: () => {
                try {
                    const result = action.onClick(clickProps);
                    if (result instanceof Promise) return result.catch(error => report(action, error));
                } catch (error: unknown) {
                    report(action, error);
                }
                return undefined;
            }
        }));

        return placeEntityActions(items);
    }, [actions, clickProps, snackbarController]);
}

/**
 * What a record's own actions mean by `navigateBack`: leave the record. The
 * delete action calls it once the row is gone.
 *
 * It is not the edit view's `navigateBack` prop, which every layout wires to
 * "leave the edit view for the record's detail view" — after a delete that is a
 * record that no longer exists, and the split, the side panel and the dialog
 * stayed open on it.
 */
export function useLeaveRecord({
    layout,
    path,
    onCloseRequest
}: {
    layout: "side_panel" | "full_screen" | "split" | "dialog";
    path: string;
    onCloseRequest?: () => void;
}): () => void {
    const sideDialogContext = useSideDialogContext();
    const navigate = useNavigate();
    const urlController = useUrlController();
    return useCallback(() => {
        if (layout === "side_panel" || layout === "dialog") {
            sideDialogContext.close(true);
        } else if (onCloseRequest) {
            onCloseRequest();
        } else {
            navigate(withListState(urlController.buildUrlCollectionPath(path)), { replace: true });
        }
    }, [layout, sideDialogContext, onCloseRequest, navigate, urlController, path]);
}
