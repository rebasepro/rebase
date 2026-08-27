

import type { FormContext } from "../types/fields";
import type { EntityAction, EntityActionClickProps, SidePanelController, AdminCollection } from "@rebasepro/cms-types";
import React, { useMemo } from "react";
import { Entity, getCollectionDataPath } from "@rebasepro/types";
import { RebaseContext } from "@rebasepro/cms-types";
import type { EntityFormActionsProps } from "../types/components/EntityFormActionsProps";
import { copyEntityAction, deleteEntityAction, unlinkEntityAction } from "./common/default_entity_actions";
import { mergeEntityActions } from "../util/entity_actions";
import { resolveEntityAction } from "../util/resolutions";
import { Button, CircularProgress, cls, defaultBorderMixin, DialogActions, IconButton, LoadingButton, Tooltip, Typography } from "@rebasepro/ui";
import { AlertCircleIcon, iconSize } from "@rebasepro/ui";
import {
    useCustomizationController,
    useSnackbarController,
    useTranslation
} from "@rebasepro/app";
import { SideDialogController, useSideDialogContext } from "./SideDialogs";
import { FormexController } from "@rebasepro/forms";
import { ErrorTooltip } from "@rebasepro/app";
import { usePermissions } from "@rebasepro/app";
import { getIcon } from "@rebasepro/app";
import { useAdminContext } from "../hooks/useAdminContext";
import { useChildViewSource } from "../hooks/useChildViewSource";

/**
 * The entity form's footer.
 *
 * It used to render in two shapes: this footer, and a `w-80 2xl:w-96` sticky
 * side rail carrying the same Save and Discard above several hundred pixels of
 * nothing. The rail is gone, and Save/Discard have moved to the identity bar
 * where they stay visible while the form scrolls — so with
 * `showDefaultActions={false}` this renders only what the bar cannot host:
 * record actions (copy, delete, custom), plugin actions, the saving error, and
 * the side-panel-only "save and close".
 */
export function EditFormActions({
    collection,
    path,
    entity,
    savingError,
    formex,
    disabled,
    status,
    pluginActions,
    openEntityMode,
    showDefaultActions = true,
    navigateBack,
    formContext
}: EntityFormActionsProps) {

    const { canCreate, canDelete } = usePermissions();
    const context = useAdminContext();
    const sidePanelController = context.sidePanelController;
    const sideDialogContext = useSideDialogContext();
    const customizationController = useCustomizationController();
    const { t } = useTranslation();

    // Rows shared through a junction: the delete button here removes the
    // link, because that is what the server does for this path.
    const childViewSource = useChildViewSource(path);
    const isLinkedChildView = childViewSource?.kind === "relation" && childViewSource.mode === "linked";

    const entityActions = useMemo((): EntityAction[] => {
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
        if (customEntityActions)
            return mergeEntityActions(actions, customEntityActions);
        return actions;
    }, [canCreate, canDelete, collection, path, customizationController.entityActions?.length, entity, collection.disableDefaultActions, isLinkedChildView]);

    // Record actions stay in the footer whether or not the bar carries Save;
    // they are things you do *to* the record, not ways to leave the form.
    const formActions = entityActions.filter(a => a.includeInForm === undefined || a.includeInForm);

    return buildBottomActions({
        savingError,
        entity,
        formActions,
        collection,
        context,
        sidePanelController,
        disabled,
        status,
        sideDialogContext,
        pluginActions,
        openEntityMode,
        navigateBack,
        formContext,
        formex,
        t,
        showDefaultActions
    });
}

type ActionsViewProps<M extends Record<string, unknown>> = {
    savingError: Error | undefined,
    entity: Entity<M> | undefined,
    formActions: EntityAction[],
    collection: AdminCollection,
    context: RebaseContext,
    sidePanelController: SidePanelController,
    disabled: boolean,
    status: "new" | "existing" | "copy",
    sideDialogContext: SideDialogController,
    pluginActions?: React.ReactNode[],
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    navigateBack: () => void;
    formContext: FormContext,
    formex: FormexController<Record<string, unknown>>;
    t: (key: string, vars?: Record<string, string>) => string;
    showDefaultActions: boolean;
    className?: string;
};

function buildBottomActions<M extends Record<string, unknown>>({
    savingError,
    entity,
    formActions,
    collection,
    context,
    sidePanelController,
    disabled,
    status,
    sideDialogContext,
    pluginActions,
    openEntityMode,
    navigateBack,
    formContext,
    formex,
    t,
    showDefaultActions,
    className
}: ActionsViewProps<M>) {

    const hasErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;
    // "Save and close" only means something where there is something to close.
    const canClose = openEntityMode === "side_panel" || openEntityMode === "dialog";
    const showBackToDetail = collection.defaultEntityAction === "view" && status === "existing";

    // When the container carries the actions — the entity view's identity bar
    // does — this renders nothing at all. A full-width bar holding a copy icon
    // and a delete icon is the same waste as the side rail it replaced: the
    // record actions moved into the bar's overflow menu, and Save, Discard and
    // "save and close" are buttons up there too.
    const hasContent = showDefaultActions || Boolean(savingError);

    if (!hasContent) return null;

    return <DialogActions
        className={className}
        // In normal flow at the foot of the form column, not overlaying it.
        position={"sticky"}>
        {savingError &&
            <div className="text-right">
                <Typography color={"error"}>{savingError.message}</Typography>
            </div>
        }

        {formActions.length > 0 && <div className="grow flex overflow-auto no-scrollbar">
            {formActions.map((action, index) => {

                const props = {
                    view: "form",
                    entity,
                    path: getCollectionDataPath(collection),
                    collection: collection,
                    context,
                    sidePanelController,
                    openEntityMode,
                    navigateBack,
                    formContext
                } satisfies EntityActionClickProps<Record<string, unknown>>;

                const isEnabled = !action.isEnabled || action.isEnabled(props);
                return (
                    <EntityActionButton
                        key={action.key ?? action.name ?? index}
                        action={action}
                        enabled={isEnabled}
                        props={props}
                    />
                );
            })}
        </div>}

        {pluginActions}

        {hasErrors ?
            <ErrorTooltip title={"This form has errors"}>
                <AlertCircleIcon className="ml-4 text-red-500" size={iconSize.smallest}/>
            </ErrorTooltip> : null}

        {showBackToDetail && (
            <Button variant="text"
                color="primary"
                disabled={disabled}
                onClick={navigateBack}>
                {t("back_to_detail") ?? "Back to details"}
            </Button>
        )}

        {showDefaultActions && <>
            <Button variant="text"
                color="primary"
                disabled={disabled || formex.isSubmitting}
                type="reset">
                {status === "existing" ? t("discard") : t("clear")}
            </Button>
            <Tooltip title={hasErrors ? (t("fix_errors_before_saving") ?? "Fix highlighted errors before saving") : undefined}>
                <Button variant={canClose ? "text" : "filled"}
                    color="primary"
                    type="submit"
                    disabled={disabled || formex.isSubmitting}
                    onClick={() => {
                        sideDialogContext.setPendingClose(false);
                    }}>
                    {status === "existing" && t("save")}
                    {status === "copy" && t("create_copy")}
                    {status === "new" && t("create")}
                </Button>
            </Tooltip>
        </>}

        {canClose && <LoadingButton variant="filled"
            color="primary"
            type="submit"
            loading={formex.isSubmitting}
            disabled={disabled}
            onClick={() => {
                sideDialogContext.setPendingClose?.(true);
            }}>
            {status === "existing" && t("save_and_close")}
            {status === "copy" && t("create_copy_and_close")}
            {status === "new" && t("create_and_close")}
        </LoadingButton>}
    </DialogActions>;
}

function EntityActionButton({
    action,
    enabled,
    props
}: {
    action: EntityAction,
    enabled: boolean,
    props: EntityActionClickProps<Record<string, unknown>>
}) {
    const snackbarController = useSnackbarController();
    const [loading, setLoading] = React.useState(false);
    return <Tooltip
        title={action.name}>
        <IconButton
            color="primary"
            disabled={!enabled}
            onClick={(event) => {
                console.debug("Executing action", action.key, props);
                try {
                    event.stopPropagation();
                    if (props.entity) {
                        const onClick = action.onClick(props);
                        // If the action returns a promise, we can handle it
                        if (onClick instanceof Promise) {
                            setLoading(true);
                            onClick
                                .catch((error) => {
                                    console.error("Error executing action", action.key, error);
                                    snackbarController.open({
                                        message: `Error executing action: ${error.message}`,
                                        type: "error"
                                    })
                                })
                                .finally(() => setLoading(false));
                        } else {
                            snackbarController.open({
                                message: `Action ${action.name} executed successfully`,
                                type: "success"
                            });
                        }

                    }
                } catch (e: unknown) {
                    console.error("Error executing action", action.key, e);
                    snackbarController.open({
                        message: `Error executing action: ${e instanceof Error ? e.message : String(e)}`,
                        type: "error"
                    });
                }
            }}>
            {loading ? <CircularProgress size={"smallest"}/> : getIcon(action.icon, undefined, undefined, "smallest")}
        </IconButton>
    </Tooltip>;
}
