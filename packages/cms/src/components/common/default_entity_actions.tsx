import {
    Alert,
    Button,
    CopyIcon,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    iconSize,
    KeyRoundIcon,
    Label,
    LoadingButton,
    PencilIcon,
    RadioGroup,
    RadioGroupItem,
    TextField,
    Trash2Icon,
    Unlink2Icon,
    Typography
} from "@rebasepro/ui";
import type { User } from "@rebasepro/types";
import type { EntityAction, UserCreationResult } from "@rebasepro/cms-types";
import {
    apiBaseOf,
    useAuthController,
    useRebaseClient,
    useSnackbarController,
    useTranslation
} from "@rebasepro/app";
import { DeleteEntityDialog } from "../DeleteEntityDialog";
import { addRecentId } from "../CollectionViewBinding/utils";
import { navigateToEntity } from "../../util/navigation_utils";
import { resolveDefaultSelectedView } from "@rebasepro/app";
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
        sidePanelController,
        highlightEntity,
        unhighlightEntity,
        openEntityMode
    }): Promise<void> {

        if (!entity) {
            throw new Error("INTERNAL: editEntityAction: Entity is undefined");
        }

        if (!sidePanelController) {
            throw new Error("INTERNAL: editEntityAction: sidePanelController is undefined");
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
            sidePanelController,
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
        sidePanelController,
        highlightEntity,
        unhighlightEntity,
        openEntityMode
    }): Promise<void> {
        if (!entity) {
            throw new Error("INTERNAL: copyEntityAction: Entity is undefined");
        }
        if (!sidePanelController) {
            throw new Error("INTERNAL: copyEntityAction: sidePanelController is undefined");
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
            sidePanelController,
            onClose: () => unhighlightEntity?.(entity),
            navigation: context.urlController
        });

        return Promise.resolve(undefined);
    }
}

/**
 * The destructive row action, in its two readings.
 *
 * The mechanics are identical — both issue a DELETE at the row's path — but
 * what that *does* is not. On a many-to-many tab the path is
 * `posts/1/tags/5`, and the backend removes the junction row: tag 5 keeps
 * existing, and every other post keeps it. Labelling that "Delete" and warning
 * about permanent removal describes an operation the server will not perform.
 */
function buildRemoveEntityAction({
    key,
    name,
    icon,
    variant
}: {
    key: string;
    name: string;
    icon: React.ReactElement;
    variant: "delete" | "unlink";
}): EntityAction {
    return {
        icon,
        name,
        key,
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
                throw new Error(`INTERNAL: ${key}EntityAction: Entity is undefined`);
            }
            if (!context?.dialogsController) {
                throw new Error(`INTERNAL: ${key}EntityAction: context.dialogsController is undefined`);
            }
            const { closeDialog } = context.dialogsController.open({
                key: `${key}_entity_dialog_` + entity.id,
                Component: ({ open }) => {
                    if (!collection || !path)
                        throw new Error(`${key}EntityAction: Collection is undefined`);
                    return <DeleteEntityDialog
                        entityOrEntitiesToDelete={entity}
                        path={path}
                        collection={collection}
                        variant={variant}
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
    };
}

export const deleteEntityAction: EntityAction = buildRemoveEntityAction({
    key: "delete",
    name: "Delete",
    icon: <Trash2Icon size={iconSize.smallest}/>,
    variant: "delete"
});

/**
 * The destructive action on a tab whose rows are shared through a junction.
 * Removes the row from *this* parent; the row itself is untouched.
 */
export const unlinkEntityAction: EntityAction = buildRemoveEntityAction({
    key: "unlink",
    name: "Remove",
    icon: <Unlink2Icon size={iconSize.smallest}/>,
    variant: "unlink"
});

export function ResetPasswordActionDialog({
    user,
    open,
    onClose
}: {
    user: User;
    open: boolean;
    onClose: () => void;
}) {
    const client = useRebaseClient<{ baseUrl?: string, apiPath?: string }>();
    const { getAuthToken } = useAuthController();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [creationResult, setCreationResult] = useState<UserCreationResult | null>(null);
    const [mode, setMode] = useState<"email" | "manual">("email");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState<string | null>(null);

    // Strength rules are enforced server side, and are overridable through auth
    // hooks, so only the match is checked here; the server's message is surfaced.
    const passwordsMatch = password === confirmPassword;
    const canSubmit = mode === "email" || (password.length > 0 && passwordsMatch);

    const handleConfirm = async () => {
        if (mode === "manual" && !passwordsMatch) {
            setError(t("passwords_dont_match", { defaultValue: "Passwords don't match" }));
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const apiBase = apiBaseOf(client) ?? "";
            const token = await getAuthToken?.();
            const response = await fetch(`${apiBase}/admin/users/${user.uid}/reset-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                },
                body: JSON.stringify(mode === "manual" ? { password } : {})
            });
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(errorBody.error?.message || errorBody.message || "Failed to reset password");
            }
            const data = await response.json();
            snackbarController.open({
                type: "success",
                message: t("reset_password_success", { defaultValue: "Password reset successfully" })
            });
            // Setting a password directly returns neither an invitation nor a
            // temporary password, so there is no result to show.
            if (data.invitationSent || data.temporaryPassword) {
                setCreationResult({
                    user,
                    invitationSent: data.invitationSent ?? false,
                    temporaryPassword: data.temporaryPassword,
                    emailDeliveryFailed: data.emailDeliveryFailed ?? false
                });
            } else {
                onClose();
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : t("error_resetting_password", { defaultValue: "Error resetting password" }));
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
        <Dialog open={open} onOpenChange={(o) => !o ? onClose() : undefined} maxWidth="xl">
            <DialogTitle variant="h5" gutterBottom={false}>
                {t("reset_password", { defaultValue: "Reset Password" })}
            </DialogTitle>
            <DialogContent>
                <div className="flex flex-col gap-4 py-2">
                    <Typography variant="body2" color="secondary">
                        {user.email}
                    </Typography>

                    <RadioGroup value={mode} onValueChange={(v) => {
                        setMode(v as "email" | "manual");
                        setError(null);
                    }}>
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="email" id="reset-password-mode-email"/>
                            <Label htmlFor="reset-password-mode-email">
                                {t("reset_password_send_email", { defaultValue: "Send a password reset email" })}
                            </Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <RadioGroupItem value="manual" id="reset-password-mode-manual"/>
                            <Label htmlFor="reset-password-mode-manual">
                                {t("reset_password_set_manually", { defaultValue: "Set a password manually" })}
                            </Label>
                        </div>
                    </RadioGroup>

                    {mode === "manual" && <>
                        <TextField
                            type="password"
                            value={password}
                            autoFocus
                            autoComplete="new-password"
                            label={t("new_password", { defaultValue: "New Password" })}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                setError(null);
                            }}
                        />
                        <TextField
                            type="password"
                            value={confirmPassword}
                            autoComplete="new-password"
                            error={confirmPassword.length > 0 && !passwordsMatch}
                            label={t("confirm_password", { defaultValue: "Confirm New Password" })}
                            onChange={(e) => {
                                setConfirmPassword(e.target.value);
                                setError(null);
                            }}
                        />
                        <Typography variant="caption" color="secondary">
                            {t("reset_password_set_manually_description", {
                                defaultValue: "The password is updated immediately and no email is sent. Share it with the user securely."
                            })}
                        </Typography>
                    </>}

                    {error && <Alert color="error">
                        <Typography variant="body2">{error}</Typography>
                    </Alert>}
                </div>
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={onClose} disabled={loading}>
                    {t("cancel")}
                </Button>
                <LoadingButton variant="filled" onClick={handleConfirm} loading={loading} disabled={!canSubmit}>
                    {t("reset_password", { defaultValue: "Reset Password" })}
                </LoadingButton>
            </DialogActions>
        </Dialog>
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

