import React, { useState } from "react";
import {
    Button,
    CopyIcon,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    iconSize,
    KeyRoundIcon,
    LockIcon,
    ShieldIcon,
    Tooltip,
    Typography,
    UserCheckIcon
} from "@rebasepro/ui";
import { useAdminUserRequest, useSnackbarController, useTableDescriptors, useTranslation } from "@rebasepro/app";
import type { DbTableInfo } from "../tableModel";

/**
 * Whether `table` is the auth table this backend serves — the one whose rows
 * are the users, by the server's own description (`descriptor.auth`).
 */
export function useIsAuthTable(table: DbTableInfo): boolean {
    const { tables } = useTableDescriptors();
    return tables.some(descriptor => descriptor.auth !== undefined
        && (descriptor.schema ?? "public") === table.schema
        && descriptor.table.split(".").pop() === table.name);
}

type Row = Record<string, unknown>;

/** Whether the row's account is switched off: its `disabled_at` is set. */
function isDisabled(row: Row): boolean {
    const value = row.disabled_at ?? row.disabledAt;
    return value !== null && value !== undefined && value !== "";
}

/**
 * The account actions on a row of the auth table: reset its password, reset
 * its two-step verification, switch it off or on. The same requests the admin
 * panel's users collection sends (`useAdminUserRequest`), so a Studio running
 * without the panel manages accounts the same way, under the same rules —
 * `users:write`, and never an account that holds more than the caller.
 */
export function AuthUserRowActions({ row, uid, iconClassName, onChanged }: {
    row: Row;
    uid: string;
    iconClassName?: string;
    onChanged: () => void;
}) {
    const { t } = useTranslation();
    const request = useAdminUserRequest();
    const snackbar = useSnackbarController();
    const [dialog, setDialog] = useState<"password" | "mfa" | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ temporaryPassword?: string; invitationSent?: boolean } | null>(null);
    const disabled = isDisabled(row);
    const email = typeof row.email === "string" ? row.email : uid;

    const fail = (err: unknown) => snackbar.open({ type: "error", message: err instanceof Error ? err.message : String(err) });

    const resetPassword = async () => {
        setBusy(true);
        try {
            const data = await request<{ temporaryPassword?: string; invitationSent?: boolean }>(
                `${encodeURIComponent(uid)}/reset-password`, { method: "POST", body: {} });
            snackbar.open({ type: "success", message: t("reset_password_success") });
            if (data.temporaryPassword || data.invitationSent) setResult(data);
            else setDialog(null);
        } catch (err) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const resetMfa = async () => {
        setBusy(true);
        try {
            await request(`${encodeURIComponent(uid)}/mfa`, { method: "DELETE" });
            snackbar.open({ type: "success", message: t("reset_mfa_success") });
            setDialog(null);
        } catch (err) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const toggleAccess = async () => {
        try {
            await request(encodeURIComponent(uid), { method: "PUT", body: { disabled: !disabled } });
            snackbar.open({ type: "success", message: t(disabled ? "account_enabled_success" : "account_disabled_success") });
            onChanged();
        } catch (err) {
            fail(err);
        }
    };

    const close = () => {
        setDialog(null);
        setResult(null);
    };

    return (
        <>
            <Tooltip title={t("reset_password")}>
                <IconButton size="small" aria-label={t("reset_password")} className={iconClassName} onClick={() => setDialog("password")}>
                    <KeyRoundIcon size={iconSize.smallest}/>
                </IconButton>
            </Tooltip>
            <Tooltip title={t("reset_mfa_title")}>
                <IconButton size="small" aria-label={t("reset_mfa_title")} className={iconClassName} onClick={() => setDialog("mfa")}>
                    <ShieldIcon size={iconSize.smallest}/>
                </IconButton>
            </Tooltip>
            <Tooltip title={t(disabled ? "account_enabled_success" : "account_disabled_label")}>
                <IconButton size="small" aria-label={t("account_access_action")} className={iconClassName} onClick={() => void toggleAccess()}>
                    {disabled ? <UserCheckIcon size={iconSize.smallest}/> : <LockIcon size={iconSize.smallest}/>}
                </IconButton>
            </Tooltip>

            <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) close(); }} maxWidth="sm" fullWidth>
                <DialogTitle>{dialog === "mfa" ? t("reset_mfa_title") : t("reset_password")}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    {result?.temporaryPassword ? (
                        <>
                            <Typography variant="body2">{t("temporary_password_description")}</Typography>
                            <div className="flex items-center gap-2">
                                <code className="font-mono text-sm px-2 py-1 rounded bg-surface-card">{result.temporaryPassword}</code>
                                <IconButton size="small" aria-label={t("copy_password")} onClick={() => {
                                    void navigator.clipboard?.writeText(result.temporaryPassword ?? "");
                                    snackbar.open({ type: "success", message: t("password_copied") });
                                }}>
                                    <CopyIcon size={iconSize.smallest}/>
                                </IconButton>
                            </div>
                        </>
                    ) : result?.invitationSent ? (
                        <Typography variant="body2">{t("invitation_sent", { email })}</Typography>
                    ) : (
                        <Typography variant="body2">
                            {dialog === "mfa" ? t("reset_mfa_description") : t("reset_password_confirmation")}
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={close} disabled={busy}>{t(result ? "close" : "cancel")}</Button>
                    {!result && (
                        <Button variant="filled" color="primary" disabled={busy}
                            onClick={() => void (dialog === "mfa" ? resetMfa() : resetPassword())}>
                            {dialog === "mfa" ? t("reset_mfa_confirm") : t("reset_password")}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>
        </>
    );
}
