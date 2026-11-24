import React, { useCallback, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { asStringArray, isRecord, useAdminFetch, type AdminFetchOptions } from "../../utils/adminFetch";
import { SqlBlock } from "./SqlBlock";

interface PendingChange {
    title: string;
    path: string;
    method: NonNullable<AdminFetchOptions["method"]>;
    body: Record<string, unknown>;
    statements: string[];
    done: string;
    destructive: boolean;
    onDone?: () => void;
}

export interface DdlChange {
    /** The dialog's title: what is about to happen, in words. */
    title: string;
    path: string;
    method: NonNullable<AdminFetchOptions["method"]>;
    body: Record<string, unknown>;
    /** The snackbar's sentence once it ran. */
    done: string;
    /** Draws the run button in the error ink. */
    destructive?: boolean;
    onDone?: () => void;
}

/**
 * A schema change, shown as the SQL it will run before it runs: the route is
 * asked with `dryRun: true` first, the statements are shown, and only "Run"
 * sends it for real. Every DDL route under `/api/admin/db` answers a dry run.
 */
export function useDdlConfirm() {
    const { t } = useTranslation();
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const [pending, setPending] = useState<PendingChange | null>(null);
    const [running, setRunning] = useState(false);

    const confirm = useCallback(async (change: DdlChange) => {
        try {
            const preview = await requestJson(change.path, { method: change.method, body: { ...change.body, dryRun: true } });
            const statements = isRecord(preview) ? asStringArray(preview.statements) : [];
            setPending({ ...change, destructive: change.destructive ?? false, statements });
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : String(err) });
        }
    }, [requestJson, snackbar]);

    const run = async () => {
        if (!pending) return;
        setRunning(true);
        try {
            await requestJson(pending.path, { method: pending.method, body: pending.body });
            snackbar.open({ type: "success", message: pending.done });
            pending.onDone?.();
            setPending(null);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
            setRunning(false);
        }
    };

    const dialog = (
        <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !running) setPending(null); }} maxWidth="2xl" fullWidth>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogContent className="flex flex-col gap-3">
                <Typography variant="body2" color="secondary">{t("studio_tables_ddl_preview_intro")}</Typography>
                <SqlBlock sql={pending?.statements.join("\n") ?? ""}/>
            </DialogContent>
            <DialogActions>
                <Button variant="text" disabled={running} onClick={() => setPending(null)}>{t("cancel")}</Button>
                <Button variant="filled" color={pending?.destructive ? "error" : "primary"} disabled={running} onClick={() => void run()}>
                    {running ? t("studio_tables_ddl_running") : t("studio_tables_ddl_run")}
                </Button>
            </DialogActions>
        </Dialog>
    );

    return { confirm, dialog };
}
