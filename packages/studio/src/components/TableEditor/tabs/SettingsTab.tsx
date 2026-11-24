import React, { useEffect, useState } from "react";
import {
    Alert,
    BooleanSwitchWithLabel,
    Button,
    Card,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    TextField,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { useAdminFetch } from "../../../utils/adminFetch";
import { useDdlConfirm } from "../DdlConfirm";
import type { DbTableInfo } from "../tableModel";

interface SettingsTabProps {
    table: DbTableInfo;
    onChanged: () => void;
    /** After a rename or drop: the table the shell should select next (`null` for none). */
    onTableReplaced: (key: string | null) => void;
}

/** How the API serves the table (`rebase.table_meta`), its name, and dropping it. */
export function SettingsTab({ table, onChanged, onTableReplaced }: SettingsTabProps) {
    const { t } = useTranslation();
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const { confirm, dialog } = useDdlConfirm();
    const base = `/admin/db/tables/${encodeURIComponent(table.name)}`;

    const [slug, setSlug] = useState("");
    const [description, setDescription] = useState("");
    const [exposed, setExposed] = useState(true);
    const [softDelete, setSoftDelete] = useState(false);
    const [history, setHistory] = useState(false);
    const [readOnly, setReadOnly] = useState(false);
    const [saving, setSaving] = useState(false);
    const [rename, setRename] = useState(table.name);
    const [dropOpen, setDropOpen] = useState(false);
    const [dropConfirm, setDropConfirm] = useState("");
    const [dropping, setDropping] = useState(false);

    useEffect(() => {
        setSlug(table.meta?.slug ?? table.slug);
        setDescription(table.meta?.description ?? "");
        setExposed(table.meta?.exposed ?? table.exposed);
        setSoftDelete(table.meta?.softDelete ?? false);
        setHistory(table.meta?.history ?? false);
        setReadOnly(table.meta?.readOnly ?? false);
        setRename(table.name);
    }, [table]);

    const saveMeta = async () => {
        setSaving(true);
        try {
            const nonPkColumns = table.columns.filter(column => !column.primaryKey).map(column => column.name);
            await requestJson(base, {
                method: "PATCH",
                body: {
                    schema: table.schema,
                    meta: {
                        slug: slug.trim() || null,
                        description: description.trim() || null,
                        exposed,
                        softDeleteColumn: softDelete ? (table.meta?.softDeleteColumn ?? "deleted_at") : null,
                        historyEnabled: history,
                        readonlyColumns: readOnly ? nonPkColumns : []
                    }
                }
            });
            snackbar.open({ type: "success", message: t("studio_tables_meta_saved") });
            onChanged();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_meta_save_failed") });
        } finally {
            setSaving(false);
        }
    };

    const drop = async () => {
        setDropping(true);
        try {
            await requestJson(base, { method: "DELETE", body: { schema: table.schema, confirm: dropConfirm } });
            snackbar.open({ type: "success", message: t("studio_tables_table_dropped", { name: table.name }) });
            setDropOpen(false);
            onTableReplaced(null);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_drop_failed") });
        } finally {
            setDropping(false);
        }
    };

    return (
        <div className="max-w-2xl flex flex-col gap-5">
            <Card className="p-4 flex flex-col gap-4">
                <Typography variant="subtitle1">{t("studio_tables_meta_heading")}</Typography>
                <TextField label={t("studio_tables_slug_label")} value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={table.name}/>
                <TextField label={t("description")} value={description} onChange={(event) => setDescription(event.target.value)}
                    placeholder={t("studio_tables_description_placeholder")}/>
                <BooleanSwitchWithLabel label={t("studio_tables_expose_label")} value={exposed} onValueChange={setExposed}/>
                <BooleanSwitchWithLabel label={t("studio_tables_read_only_label")} value={readOnly} onValueChange={setReadOnly}/>
                <BooleanSwitchWithLabel label={t("studio_tables_soft_delete_label")} value={softDelete} onValueChange={setSoftDelete}/>
                <BooleanSwitchWithLabel label={t("studio_tables_history_label")} value={history} onValueChange={setHistory}/>
                <div className="flex justify-end">
                    <Button variant="filled" color="primary" disabled={saving} onClick={() => void saveMeta()}>
                        {saving ? t("saving") : t("studio_tables_save_settings")}
                    </Button>
                </div>
            </Card>

            {table.kind === "table" && (
                <Card className="p-4 flex flex-col gap-3">
                    <Typography variant="subtitle1">{t("studio_tables_rename_heading")}</Typography>
                    <div className="flex items-end gap-2">
                        <TextField className="flex-1" label={t("studio_tables_name_label")} value={rename} onChange={(event) => setRename(event.target.value)}/>
                        <Button variant="outlined" disabled={!rename.trim() || rename.trim() === table.name}
                            onClick={() => void confirm({
                                title: t("studio_tables_rename_heading"),
                                path: base,
                                method: "PATCH",
                                body: { schema: table.schema, renameTo: rename.trim() },
                                done: t("studio_tables_renamed", { from: table.name, to: rename.trim() }),
                                onDone: () => onTableReplaced(`${table.schema}.${rename.trim()}`)
                            })}>
                            {t("studio_tables_rename")}
                        </Button>
                    </div>
                </Card>
            )}

            {table.kind === "table" && (
                <Card className="p-4 flex items-center justify-between gap-4">
                    <div>
                        <Typography variant="subtitle2">{t("studio_tables_danger_zone")}</Typography>
                        <Typography variant="body2" color="secondary">{t("studio_tables_drop_description", { name: table.name })}</Typography>
                    </div>
                    <Button variant="outlined" color="error" onClick={() => setDropOpen(true)}>{t("studio_tables_drop_table")}</Button>
                </Card>
            )}

            <Dialog open={dropOpen} onOpenChange={setDropOpen} maxWidth="sm" fullWidth>
                <DialogTitle>{t("studio_tables_drop_table")}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <Alert color="error">{t("studio_tables_drop_warning", { name: table.name })}</Alert>
                    <TextField label={t("studio_tables_drop_confirm_label", { name: table.name })} value={dropConfirm}
                        onChange={(event) => setDropConfirm(event.target.value)}/>
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDropOpen(false)}>{t("cancel")}</Button>
                    <Button variant="filled" color="error" disabled={dropping || dropConfirm !== table.name} onClick={() => void drop()}>
                        {dropping ? t("studio_tables_dropping") : t("studio_tables_drop_table")}
                    </Button>
                </DialogActions>
            </Dialog>
            {dialog}
        </div>
    );
}
