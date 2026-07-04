import { CopyIcon, iconSize, KeyRoundIcon, PencilIcon, Trash2Icon } from "@rebasepro/ui";
import type { SnapshotAction, User, UserCreationResult } from "@rebasepro/types";
import {
    ConfirmationDialog,
    useAuthController,
    useRebaseClient,
    useSnackbarController,
    useTranslation
} from "@rebasepro/core";
import { DeleteSnapshotDialog } from "../DeleteSnapshotDialog";
import { addRecentId } from "../CollectionViewBinding/utils";
import { navigateToSnapshot } from "../../util/navigation_utils";
import { resolveDefaultSelectedView } from "@rebasepro/common";
import { CreationResultDialog } from "../admin/CreationResultDialog";
import React, { useState } from "react";

export const editSnapshotAction: SnapshotAction = {
    icon: <PencilIcon size={iconSize.smallest}/>,
    key: "edit",
    name: "Edit",
    collapsed: false,
    isEnabled: ({ snapshot }) => Boolean(snapshot),
    onClick({
        snapshot,
        collection,
        path,
        context,
        sidePanelController,
        highlightSnapshot,
        unhighlightSnapshot,
        openSnapshotMode
    }): Promise<void> {

        if (!snapshot) {
            throw new Error("INTERNAL: editSnapshotAction: Snapshot is undefined");
        }

        if (!sidePanelController) {
            throw new Error("INTERNAL: editSnapshotAction: sidePanelController is undefined");
        }

        highlightSnapshot?.(snapshot);

        context?.analyticsController?.onAnalyticsEvent?.("snapshot_click", {
            path: snapshot.path,
            snapshotId: snapshot.id
        });

        if (collection) {
            addRecentId(collection.slug, snapshot.id);
        }

        const newFullIdPath = path ?? collection?.slug ?? snapshot.path;
        const defaultSelectedView = collection?.defaultSnapshotAction === "view"
            ? "edit"
            : resolveDefaultSelectedView(
                collection ? collection.defaultSelectedView : undefined,
                {
                    status: "existing",
                    snapshotId: snapshot.id
                }
            );
        if (!context?.urlController) {
            throw new Error("INTERNAL: editSnapshotAction: urlController is undefined");
        }
        navigateToSnapshot({
            openSnapshotMode,
            collection,
            snapshotId: snapshot.id,
            path: newFullIdPath,
            sidePanelController,
            onClose: () => unhighlightSnapshot?.(snapshot),
            navigation: context.urlController,
            selectedTab: defaultSelectedView
        });

        return Promise.resolve(undefined);
    }
}

export const copySnapshotAction: SnapshotAction = {
    icon: <CopyIcon size={iconSize.smallest}/>,
    name: "Copy",
    key: "copy",
    isEnabled: ({ snapshot }) => Boolean(snapshot),
    onClick({
        snapshot,
        collection,
        context,
        path,
        sidePanelController,
        highlightSnapshot,
        unhighlightSnapshot,
        openSnapshotMode
    }): Promise<void> {
        if (!snapshot) {
            throw new Error("INTERNAL: copySnapshotAction: Snapshot is undefined");
        }
        if (!sidePanelController) {
            throw new Error("INTERNAL: copySnapshotAction: sidePanelController is undefined");
        }
        highlightSnapshot?.(snapshot);
        context?.analyticsController?.onAnalyticsEvent?.("copy_snapshot_click", {
            path: snapshot.path,
            snapshotId: snapshot.id
        });

        const usedPath = path ?? collection?.slug ?? snapshot.path;
        if (!context?.urlController) {
            throw new Error("INTERNAL: copySnapshotAction: urlController is undefined");
        }
        navigateToSnapshot({
            openSnapshotMode,
            collection,
            snapshotId: snapshot.id,
            path: usedPath,
            copy: true,
            sidePanelController,
            onClose: () => unhighlightSnapshot?.(snapshot),
            navigation: context.urlController
        });

        return Promise.resolve(undefined);
    }
}

export const deleteSnapshotAction: SnapshotAction = {
    icon: <Trash2Icon size={iconSize.smallest}/>,
    name: "Delete",
    key: "delete",
    isEnabled: ({ snapshot }) => Boolean(snapshot),
    onClick({
        snapshot,
        path,
        collection,
        context,
        selectionController,
        onCollectionChange,
        navigateBack,
        openSnapshotMode
    }): Promise<void> {
        if (!snapshot) {
            throw new Error("INTERNAL: deleteSnapshotAction: Snapshot is undefined");
        }
        if (!context?.dialogsController) {
            throw new Error("INTERNAL: deleteSnapshotAction: context.dialogsController is undefined");
        }
        const { closeDialog } = context.dialogsController.open({
            key: "delete_snapshot_dialog_" + snapshot.id,
            Component: ({ open }) => {
                if (!collection || !path)
                    throw new Error("deleteSnapshotAction: Collection is undefined");
                return <DeleteSnapshotDialog
                    snapshotOrSnapshotsToDelete={snapshot}
                    path={path}
                    collection={collection}
                    callbacks={collection.callbacks}
                    open={open}
                    onSnapshotDelete={() => {
                        context?.analyticsController?.onAnalyticsEvent?.("single_snapshot_deleted", {
                            path
                        });
                        selectionController?.setSelectedSnapshots(selectionController.selectedSnapshots.filter(e => e.id !== snapshot.id));
                        onCollectionChange?.();
                        // In full-screen mode, navigateBack would go to the deleted snapshot's
                        // detail URL, which no longer exists. Navigate to the parent collection instead.
                        if (openSnapshotMode === "full_screen" && context?.urlController) {
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

export const resetPasswordAction: SnapshotAction = {
    icon: <KeyRoundIcon size={iconSize.smallest}/>,
    name: "Reset Password",
    key: "reset_password",
    collapsed: false,
    showActionsInListView: true,
    isEnabled: ({ snapshot }) => Boolean(snapshot),
    onClick({
        snapshot,
        context
    }): Promise<void> {
        if (!snapshot) {
            throw new Error("INTERNAL: resetPasswordAction: Snapshot is undefined");
        }
        if (!context?.dialogsController) {
            throw new Error("INTERNAL: resetPasswordAction: context.dialogsController is undefined");
        }

        const user: User = {
            uid: snapshot.id as string,
            email: snapshot.values?.email as string,
            displayName: snapshot.values?.displayName as string || null,
            photoURL: snapshot.values?.photoURL as string || null,
            providerId: snapshot.values?.providerId as string || "custom",
            isAnonymous: snapshot.values?.isAnonymous as boolean || false,
            roles: snapshot.values?.roles as string[] || []
        };

        const { closeDialog } = context!.dialogsController.open({
            key: "reset_password_dialog_" + snapshot.id,
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

