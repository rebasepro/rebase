import { CopyIcon, iconSize, KeyRoundIcon, PencilIcon, Trash2Icon } from "@rebasepro/ui";
import type { EntityAction, User, UserCreationResult } from "@rebasepro/types";
import {
    ConfirmationDialog,
    useAuthController,
    useRebaseClient,
    useSnackbarController,
    useTranslation
} from "@rebasepro/core";
import { DeleteEntityDialog } from "../DeleteEntityDialog";
import { addRecentId } from "../EntityCollectionView/utils";
import { navigateToEntity } from "../../util/navigation_utils";
import { resolveDefaultSelectedView } from "@rebasepro/common";
import { CreationResultDialog } from "../admin/CreationResultDialog";
import React, { useState } from "react";

export const editEntityAction: EntityAction = {
    icon: <PencilIcon size={iconSize.smallest}/>,
    key: "edit",
    name: "Edit",
    collapsed: false,
    isEnabled: ({ entity }) => Boolean(entity),
    onClick({
        entity,
        collection,
        path,
        context,
        sideEntityController,
        highlightEntity,
        unhighlightEntity,
        openEntityMode
    }): Promise<void> {

        if (!entity) {
            throw new Error("INTERNAL: editEntityAction: Entity is undefined");
        }

        if (!sideEntityController) {
            throw new Error("INTERNAL: editEntityAction: sideEntityController is undefined");
        }

        highlightEntity?.(entity);

        context?.analyticsController?.onAnalyticsEvent?.("entity_click", {
            path: entity.path,
            entityId: entity.id
        });

        if (collection) {
            addRecentId(collection.slug, entity.id);
        }

        const newFullIdPath = path ?? collection?.slug ?? entity.path;
        const defaultSelectedView = collection?.defaultEntityAction === "view"
            ? "edit"
            : resolveDefaultSelectedView(
                collection ? collection.defaultSelectedView : undefined,
                {
                    status: "existing",
                    entityId: entity.id
                }
            );
        if (!context?.urlController) {
            throw new Error("INTERNAL: editEntityAction: urlController is undefined");
        }
        navigateToEntity({
            openEntityMode,
            collection,
            entityId: entity.id,
            path: newFullIdPath,
            sideEntityController,
            onClose: () => unhighlightEntity?.(entity),
            navigation: context.urlController,
            selectedTab: defaultSelectedView
        });

        return Promise.resolve(undefined);
    }
}

export const copyEntityAction: EntityAction = {
    icon: <CopyIcon size={iconSize.smallest}/>,
    name: "Copy",
    key: "copy",
    isEnabled: ({ entity }) => Boolean(entity),
    onClick({
        entity,
        collection,
        context,
        path,
        sideEntityController,
        highlightEntity,
        unhighlightEntity,
        openEntityMode
    }): Promise<void> {
        if (!entity) {
            throw new Error("INTERNAL: copyEntityAction: Entity is undefined");
        }
        if (!sideEntityController) {
            throw new Error("INTERNAL: copyEntityAction: sideEntityController is undefined");
        }
        highlightEntity?.(entity);
        context?.analyticsController?.onAnalyticsEvent?.("copy_entity_click", {
            path: entity.path,
            entityId: entity.id
        });

        const usedPath = path ?? collection?.slug ?? entity.path;
        if (!context?.urlController) {
            throw new Error("INTERNAL: copyEntityAction: urlController is undefined");
        }
        navigateToEntity({
            openEntityMode,
            collection,
            entityId: entity.id,
            path: usedPath,
            copy: true,
            sideEntityController,
            onClose: () => unhighlightEntity?.(entity),
            navigation: context.urlController
        });

        return Promise.resolve(undefined);
    }
}

export const deleteEntityAction: EntityAction = {
    icon: <Trash2Icon size={iconSize.smallest}/>,
    name: "Delete",
    key: "delete",
    isEnabled: ({ entity }) => Boolean(entity),
    onClick({
        entity,
        path,
        collection,
        context,
        selectionController,
        onCollectionChange,
        navigateBack,
        openEntityMode
    }): Promise<void> {
        if (!entity) {
            throw new Error("INTERNAL: deleteEntityAction: Entity is undefined");
        }
        if (!context?.dialogsController) {
            throw new Error("INTERNAL: deleteEntityAction: context.dialogsController is undefined");
        }
        const { closeDialog } = context.dialogsController.open({
            key: "delete_entity_dialog_" + entity.id,
            Component: ({ open }) => {
                if (!collection || !path)
                    throw new Error("deleteEntityAction: Collection is undefined");
                return <DeleteEntityDialog
                    entityOrEntitiesToDelete={entity}
                    path={path}
                    collection={collection}
                    callbacks={collection.callbacks}
                    open={open}
                    onEntityDelete={() => {
                        context?.analyticsController?.onAnalyticsEvent?.("single_entity_deleted", {
                            path
                        });
                        selectionController?.setSelectedEntities(selectionController.selectedEntities.filter(e => e.id !== entity.id));
                        onCollectionChange?.();
                        // In full-screen mode, navigateBack would go to the deleted entity's
                        // detail URL, which no longer exists. Navigate to the parent collection instead.
                        if (openEntityMode === "full_screen" && context?.urlController) {
                            const collectionUrl = context.urlController.buildUrlCollectionPath(path);
                            context.urlController.navigate(collectionUrl, { replace: true });
                        } else {
                            navigateBack?.();
                        }
                    }}
                    onClose={closeDialog}/>;
            }
        });
        return Promise.resolve(undefined);
    }
}

export function ResetPasswordActionDialog({
    user,
    open,
    onClose
}: {
    user: User;
    open: boolean;
    onClose: () => void;
}) {
    const client = useRebaseClient<{ baseUrl?: string }>();
    const { getAuthToken } = useAuthController();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [creationResult, setCreationResult] = useState<UserCreationResult | null>(null);

    const handleConfirm = async () => {
        setLoading(true);
        try {
            const baseUrl = client?.baseUrl || "";
            const token = await getAuthToken?.();
            const response = await fetch(`${baseUrl}/api/admin/users/${user.uid}/reset-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                }
            });
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || "Failed to reset password");
            }
            const data = await response.json();
            setCreationResult({
                user,
                invitationSent: data.invitationSent ?? false,
                temporaryPassword: data.temporaryPassword
            });
            snackbarController.open({
                type: "success",
                message: t("reset_password_success") || "Password reset successfully"
            });
        } catch (error: unknown) {
            snackbarController.open({
                type: "error",
                message: error instanceof Error ? error.message : (t("error_resetting_password") || "Error resetting password")
            });
            onClose();
        } finally {
            setLoading(false);
        }
    };

    if (creationResult) {
        return (
            <CreationResultDialog
                result={creationResult}
                onClose={() => {
                    setCreationResult(null);
                    onClose();
                }}
            />
        );
    }

    return (
        <ConfirmationDialog
            open={open}
            loading={loading}
            onAccept={handleConfirm}
            onCancel={onClose}
            title={<>{t("reset_password") || "Reset Password"}</>}
            body={<>{t("reset_password_confirmation") || "Are you sure you want to reset this user's password?"}</>}
        />
    );
}

export const resetPasswordAction: EntityAction = {
    icon: <KeyRoundIcon size={iconSize.smallest}/>,
    name: "Reset Password",
    key: "reset_password",
    collapsed: false,
    showActionsInListView: true,
    isEnabled: ({ entity }) => Boolean(entity),
    onClick({
        entity,
        context
    }): Promise<void> {
        if (!entity) {
            throw new Error("INTERNAL: resetPasswordAction: Entity is undefined");
        }
        if (!context?.dialogsController) {
            throw new Error("INTERNAL: resetPasswordAction: context.dialogsController is undefined");
        }

        const user: User = {
            uid: entity.id as string,
            email: entity.values?.email as string,
            displayName: entity.values?.displayName as string || null,
            photoURL: entity.values?.photoURL as string || null,
            providerId: entity.values?.providerId as string || "custom",
            isAnonymous: entity.values?.isAnonymous as boolean || false,
            roles: entity.values?.roles as string[] || []
        };

        const { closeDialog } = context!.dialogsController.open({
            key: "reset_password_dialog_" + entity.id,
            Component: ({ open }) => (
                <ResetPasswordActionDialog
                    user={user}
                    open={open}
                    onClose={closeDialog}
                />
            )
        });
        return Promise.resolve(undefined);
    }
};

