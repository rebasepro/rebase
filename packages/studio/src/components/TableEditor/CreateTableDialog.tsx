import React, { useState } from "react";
import {
    Button,
    Chip,
    cls,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    iconSize,
    PlusIcon,
    Select,
    SelectItem,
    TextField,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { compilePolicyExpression } from "@rebasepro/common";
import { policy as policyExpr } from "@rebasepro/types";
import { asStringArray, isRecord, useAdminFetch } from "../../utils/adminFetch";
import { SIGNED_IN_SQL } from "../RLSEditor/policy-presets";
import { SQL_TYPES } from "./tabs/StructureTab";
import { SqlBlock } from "./SqlBlock";

/**
 * The "Owner only" preset's condition: the row's `user_id` is the signed-in
 * user. Compiled, as `SIGNED_IN_SQL` is, rather than written out: the
 * hand-written `user_id = rebase.uid()` compared a uuid column with text and
 * Postgres refused the table, and the old "signed in" clause — a bare
 * `rebase.uid() IS NOT NULL` — let anonymous visitors through.
 */
const OWNS_ROW_BY_USER_ID_SQL = compilePolicyExpression(
    policyExpr.compare(policyExpr.field("user_id"), "eq", policyExpr.authUid())
);

const RLS_PRESETS = [
    { value: "authenticated", labelKey: "studio_tables_preset_authenticated" },
    { value: "public-read", labelKey: "studio_tables_preset_public_read" },
    { value: "owner", labelKey: "studio_tables_preset_owner" },
    { value: "admin-only", labelKey: "studio_tables_preset_admin_only" }
] as const;

interface DraftColumn {
    name: string;
    type: string;
    primaryKey: boolean;
    nullable: boolean;
    unique: boolean;
    defaultExpr: string;
}

const INITIAL_COLUMNS: DraftColumn[] = [
    { name: "id", type: "uuid", primaryKey: true, nullable: false, unique: false, defaultExpr: "gen_random_uuid()" },
    { name: "title", type: "text", primaryKey: false, nullable: false, unique: false, defaultExpr: "" },
    { name: "created_at", type: "timestamptz", primaryKey: false, nullable: false, unique: false, defaultExpr: "now()" }
];

export function CreateTableDialog({ open, onOpenChange, schema, onCreated }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    schema: string;
    /** The table was created: the shell reloads the list and reports whether it is served. */
    onCreated: (name: string) => void;
}) {
    const { t } = useTranslation();
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const [name, setName] = useState("");
    const [rlsPreset, setRlsPreset] = useState<string>("authenticated");
    const [columns, setColumns] = useState<DraftColumn[]>(INITIAL_COLUMNS);
    const [previewSql, setPreviewSql] = useState<string[] | null>(null);
    const [creating, setCreating] = useState(false);

    const payload = (dryRun: boolean) => {
        const policies: Array<{ name: string; operation: string; using?: string; withCheck?: string }> = [];
        if (rlsPreset === "authenticated") {
            policies.push({ name: "authenticated_all", operation: "ALL", using: SIGNED_IN_SQL, withCheck: SIGNED_IN_SQL });
        } else if (rlsPreset === "public-read") {
            policies.push({ name: "public_read", operation: "SELECT", using: "true" });
            policies.push({ name: "authenticated_write", operation: "ALL", using: SIGNED_IN_SQL, withCheck: SIGNED_IN_SQL });
        } else if (rlsPreset === "owner") {
            policies.push({ name: "owner_all", operation: "ALL", using: OWNS_ROW_BY_USER_ID_SQL, withCheck: OWNS_ROW_BY_USER_ID_SQL });
        }
        return {
            schema,
            name: name.trim(),
            columns: columns
                .filter(column => column.name.trim() !== "")
                .map(column => ({
                    name: column.name.trim(),
                    type: column.type,
                    primaryKey: column.primaryKey,
                    nullable: column.nullable,
                    unique: column.unique,
                    ...(column.defaultExpr.trim() ? { default: column.defaultExpr.trim() } : {})
                })),
            enableRls: true,
            policies,
            dryRun
        };
    };

    const preview = async () => {
        try {
            const raw = await requestJson("/admin/db/tables", { method: "POST", body: payload(true) });
            setPreviewSql(isRecord(raw) ? asStringArray(raw.statements ?? raw.sql) : []);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_sql_preview_failed") });
        }
    };

    const create = async () => {
        setCreating(true);
        try {
            const created = name.trim();
            await requestJson("/admin/db/tables", { method: "POST", body: payload(false) });
            onOpenChange(false);
            setName("");
            setPreviewSql(null);
            setColumns(INITIAL_COLUMNS);
            onCreated(created);
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_tables_create_failed") });
        } finally {
            setCreating(false);
        }
    };

    const update = (index: number, change: Partial<DraftColumn>) =>
        setColumns(prev => prev.map((column, i) => (i === index ? { ...column, ...change } : column)));

    return (
        <Dialog open={open} onOpenChange={onOpenChange} maxWidth="2xl" fullWidth>
            <DialogTitle>{t("studio_tables_create_table")}</DialogTitle>
            <DialogContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <TextField label={t("studio_tables_name_label")} value={name} onChange={(event) => setName(event.target.value)} placeholder="projects"/>
                    <Select label={t("studio_tables_initial_rls")} value={rlsPreset} onValueChange={(value) => setRlsPreset(String(value))}>
                        {RLS_PRESETS.map(preset => <SelectItem key={preset.value} value={preset.value}>{t(preset.labelKey)}</SelectItem>)}
                    </Select>
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <Typography variant="subtitle2">{t("studio_columns")}</Typography>
                        <Button size="small" variant="outlined"
                            onClick={() => setColumns(prev => [...prev, { name: "", type: "text", primaryKey: false, nullable: true, unique: false, defaultExpr: "" }])}>
                            <PlusIcon size={iconSize.small}/>
                            {t("studio_tables_add_column")}
                        </Button>
                    </div>
                    <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                        {columns.map((column, index) => (
                            <div key={index} className={cls("grid grid-cols-12 gap-2 items-center p-2 rounded-md border", defaultBorderMixin)}>
                                <div className="col-span-3">
                                    <TextField size="small" placeholder="column_name" value={column.name} onChange={(event) => update(index, { name: event.target.value })}/>
                                </div>
                                <div className="col-span-3">
                                    <Select size="small" value={column.type} onValueChange={(value) => update(index, { type: String(value) })}>
                                        {SQL_TYPES.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                                    </Select>
                                </div>
                                <div className="col-span-3">
                                    <TextField size="small" placeholder={t("studio_tables_default_optional_placeholder")} value={column.defaultExpr}
                                        onChange={(event) => update(index, { defaultExpr: event.target.value })}/>
                                </div>
                                <div className="col-span-2 flex items-center gap-1">
                                    <Chip size="small" colorScheme={column.primaryKey ? "blueLight" : "grayLight"}
                                        onClick={() => update(index, { primaryKey: !column.primaryKey, nullable: !column.primaryKey ? false : column.nullable })}>
                                        PK
                                    </Chip>
                                    <Chip size="small" colorScheme={!column.nullable ? "orangeLight" : "grayLight"}
                                        onClick={() => update(index, { nullable: !column.nullable })}>
                                        NN
                                    </Chip>
                                </div>
                                <div className="col-span-1 flex justify-end">
                                    <IconButton size="small" aria-label={t("studio_tables_remove_draft_column")}
                                        onClick={() => setColumns(prev => prev.filter((_, i) => i !== index))}>
                                        <Trash2Icon size={iconSize.small}/>
                                    </IconButton>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {previewSql && previewSql.length > 0 && <SqlBlock sql={previewSql.join("\n")}/>}
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
                <Button variant="outlined" disabled={!name.trim()} onClick={() => void preview()}>{t("studio_tables_preview_sql")}</Button>
                <Button variant="filled" color="primary" disabled={creating || !name.trim()} onClick={() => void create()}>
                    {creating ? t("studio_tables_creating") : t("studio_tables_create_table")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
