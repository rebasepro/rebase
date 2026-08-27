
import { getCollectionDataPath } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import type { EntityAction, AdminCollection } from "@rebasepro/cms-types";
import React from "react";
import { Entity } from "@rebasepro/types";
import type { EntityFormActionsProps } from "../types/components/EntityFormActionsProps";
import { getIcon } from "@rebasepro/app";
import {
    AlertCircleIcon,
    Button,
    DialogActions,
    IconButton,
    LoadingButton,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { FormexController } from "@rebasepro/forms";

/**
 * The form's own action bar.
 *
 * There used to be two variants: this one, and a `w-80 2xl:w-96` sticky rail
 * holding the same two buttons above several hundred pixels of nothing — a
 * fifth of a 1440px viewport reserved for a Save button. The rail is gone. When
 * the container supplies its own actions (the entity view's identity bar does)
 * it passes `showDefaultActions={false}`, and this renders only what the bar
 * cannot host: the saving error, plugin actions, and collection form actions.
 */
export function EntityFormActions({
    path,
    collection,
    entity,
    savingError,
    formex,
    disabled,
    status,
    pluginActions,
    openEntityMode,
    navigateBack,
    formContext,
    showDefaultActions = true
}: EntityFormActionsProps) {

    return buildBottomActions({
        path,
        savingError,
        entity,
        collection,
        disabled,
        status,
        pluginActions,
        openEntityMode,
        navigateBack,
        formContext,
        formex,
        showDefaultActions
    });
}

type ActionsViewProps<M extends Record<string, unknown>> = {
    path: string,
    savingError: Error | undefined,
    entity: Entity<M> | undefined,
    formActions?: EntityAction[],
    collection: AdminCollection,
    disabled: boolean,
    status: "new" | "existing" | "copy",
    pluginActions?: React.ReactNode[],
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    navigateBack: () => void;
    formContext: FormContext,
    formex: FormexController<Record<string, unknown>>;
    showDefaultActions: boolean;
    className?: string;
};

function buildBottomActions<M extends Record<string, unknown>>({
    savingError,
    entity,
    path,
    formActions,
    collection,
    disabled,
    status,
    pluginActions,
    openEntityMode,
    navigateBack,
    formContext,
    formex,
    showDefaultActions,
    className
}: ActionsViewProps<M>) {

    const hasErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;
    const entityActions = entity ? (formActions ?? []) : [];
    const hasPluginActions = Boolean(pluginActions && (pluginActions as React.ReactNode[]).length > 0);

    // Nothing to show means no footer at all, rather than an empty bar pinned
    // over the last field. This is also what made `showDefaultActions` start
    // meaning something: it was accepted as a prop and then never read, so
    // passing `false` silently kept the buttons.
    if (!showDefaultActions && !savingError && !entityActions.length && !hasPluginActions) {
        return null;
    }

    return <DialogActions position={"sticky"} className={className}>
        {savingError &&
            <div className="text-right">
                <Typography color={"error"}>{savingError.message}</Typography>
            </div>
        }
        {entityActions.length > 0 && <div className="grow flex overflow-auto no-scrollbar">
            {entityActions.map(action => (
                <IconButton
                    key={action.name}
                    color="primary"
                    onClick={(event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
                        event.stopPropagation();
                        if (entity)
                            action.onClick({
                                view: "form",
                                entity,
                                path: path ?? getCollectionDataPath(collection),
                                collection: collection,
                                context: undefined,
                                sidePanelController: undefined,
                                openEntityMode: openEntityMode,
                                navigateBack,
                                formContext
                            });
                    }}>
                    {getIcon(action.icon, undefined, undefined, "smallest")}
                </IconButton>
            ))}
        </div>}
        {pluginActions}

        {showDefaultActions && <>
            <Button variant="text" disabled={disabled || formex.isSubmitting}
                color={"primary"}
                type="reset">
                {status === "existing" ? "Discard" : "Clear"}
            </Button>
            <Tooltip title={hasErrors ? "Fix highlighted errors before saving" : undefined}>
                <LoadingButton variant={"filled"}
                    color="primary"
                    type="submit"
                    loading={formex.isSubmitting}
                    disabled={disabled || formex.isSubmitting}
                    startIcon={hasErrors ? <AlertCircleIcon/> : undefined}>
                    {status === "existing" && "Save"}
                    {status === "copy" && "Create copy"}
                    {status === "new" && "Create"}
                </LoadingButton>
            </Tooltip>
        </>}

    </DialogActions>;
}
