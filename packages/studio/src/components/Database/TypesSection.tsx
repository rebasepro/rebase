import React, { useState } from "react";
import {
    Alert,
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
    LockIcon,
    PlusIcon,
    RefreshCwIcon,
    SearchBar,
    Select,
    SelectItem,
    ShapesIcon,
    TextField,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { asBoolean, asNullableString, asString, asStringArray, isRecord } from "../../utils/adminFetch";
import { EmptyState, LoadingRow, SectionHeader, SectionLoadFailure, SqlBlock, statementsOf } from "./shared";
import { matches, useCatalogList } from "./useCatalogList";

interface DbType {
    schema: string;
    name: string;
    kind: "enum" | "composite" | "domain";
    values: string[];
    attributes: string[];
    baseType: string | null;
    comment: string | null;
    protected: boolean;
}

function parseType(raw: unknown): DbType | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    const kind = raw.kind === "enum" || raw.kind === "composite" || raw.kind === "domain" ? raw.kind : null;
    if (!kind) return null;
    return {
        schema: asString(raw.schema),
        name: raw.name,
        kind,
        values: asStringArray(raw.values),
        attributes: asStringArray(raw.attributes),
        baseType: asNullableString(raw.baseType),
        comment: asNullableString(raw.comment),
        protected: asBoolean(raw.protected)
    };
}

/** The value that goes last, in the `after` select. */
const AT_END = "__end__";

export function TypesSection() {
    const { t } = useTranslation();
    const snackbar = useSnackbarController();
    const { items, failure, reload, requestJson, sourcePath } = useCatalogList("types", "types", parseType);
    const [search, setSearch] = useState("");
    const [adding, setAdding] = useState<DbType | null>(null);
    const [value, setValue] = useState("");
    const [after, setAfter] = useState(AT_END);
    const [preview, setPreview] = useState<string[] | null>(null);
    const [saving, setSaving] = useState(false);
    const [dialogError, setDialogError] = useState<string | null>(null);

    const openAdd = (type: DbType) => {
        setAdding(type);
        setValue("");
        setAfter(AT_END);
        setPreview(null);
        setDialogError(null);
    };
    const body = (dryRun: boolean) => ({ value, ...(after !== AT_END ? { after } : {}), dryRun });
    const path = (type: DbType) => `/admin/db/catalog/types/${encodeURIComponent(type.schema)}/${encodeURIComponent(type.name)}/values`;

    const showPreview = async () => {
        if (!adding) return;
        setDialogError(null);
        try {
            setPreview(statementsOf(await requestJson(sourcePath(path(adding)), { method: "POST", body: body(true) })));
        } catch (err: unknown) {
            setDialogError(err instanceof Error ? err.message : t("studio_database_action_failed"));
        }
    };
    const save = async () => {
        if (!adding) return;
        setSaving(true);
        setDialogError(null);
        try {
            await requestJson(sourcePath(path(adding)), { method: "POST", body: body(false) });
            snackbar.open({ type: "success", message: t("studio_database_types_value_added", { value, type: `${adding.schema}.${adding.name}` }) });
            setAdding(null);
            await reload();
        } catch (err: unknown) {
            setDialogError(err instanceof Error ? err.message : t("studio_database_action_failed"));
        } finally {
            setSaving(false);
        }
    };

    const shown = (items ?? []).filter(type => matches(search, type.name, type.schema, ...type.values));
    return (
        <div className="flex flex-col gap-4">
            <SectionHeader
                title={t("studio_database_section_types")}
                description={t("studio_database_types_description")}
                actions={<>
                    <SearchBar size="small" placeholder={t("studio_database_search")} onTextSearch={(text) => setSearch(text ?? "")}/>
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_database_refresh_aria")} onClick={() => void reload()}>
                            <RefreshCwIcon size={iconSize.small}/>
                        </IconButton>
                    </Tooltip>
                </>}
            />
            {failure && <SectionLoadFailure failure={failure} stale={items !== null} onRetry={() => void reload()}/>}
            {items === null ? (failure ? null : <LoadingRow/>) : shown.length === 0 ? (
                <EmptyState icon={<ShapesIcon size={iconSize.large}/>} message={t("studio_database_types_empty")}/>
            ) : (
                <div className={cls("rounded-lg border divide-y divide-hairline overflow-hidden", defaultBorderMixin)}>
                    {shown.map(type => (
                        <div key={`${type.schema}.${type.name}`} className="flex flex-col gap-2 px-4 py-3">
                            <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                    <Typography variant="mono" className="text-sm truncate block">{type.schema}.{type.name}</Typography>
                                    <Typography variant="caption" color="secondary" className="block">
                                        {t(`studio_database_types_kind_${type.kind}`)}
                                        {type.baseType ? ` · ${type.baseType}` : ""}
                                        {type.comment ? ` · ${type.comment}` : ""}
                                    </Typography>
                                </div>
                                {type.protected ? (
                                    <LockIcon size={iconSize.smallest} className="text-text-disabled dark:text-text-disabled-dark" aria-label={t("studio_database_protected")}/>
                                ) : type.kind === "enum" && (
                                    <Button size="small" onClick={() => openAdd(type)}>
                                        <PlusIcon size={iconSize.smallest}/>
                                        {t("studio_database_types_add_value")}
                                    </Button>
                                )}
                            </div>
                            {(type.kind === "enum" ? type.values : type.attributes).length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {(type.kind === "enum" ? type.values : type.attributes).map(entry => (
                                        <Chip key={entry} size="smallest" colorScheme="grayLight">{entry}</Chip>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={adding !== null} onOpenChange={(open) => { if (!open && !saving) setAdding(null); }} maxWidth="md" fullWidth>
                <DialogTitle>{t("studio_database_types_add_value_title", { type: adding ? `${adding.schema}.${adding.name}` : "" })}</DialogTitle>
                <DialogContent className="flex flex-col gap-4">
                    <TextField
                        label={t("studio_database_types_value")}
                        value={value}
                        onChange={(event) => { setValue(event.target.value); setPreview(null); }}
                    />
                    <Select
                        label={t("studio_database_types_position")}
                        value={after}
                        onValueChange={(next) => { setAfter(next); setPreview(null); }}
                    >
                        <SelectItem value={AT_END}>{t("studio_database_types_position_end")}</SelectItem>
                        {(adding?.values ?? []).map(label => (
                            <SelectItem key={label} value={label}>{t("studio_database_types_position_after", { value: label })}</SelectItem>
                        ))}
                    </Select>
                    <Typography variant="caption" color="secondary">{t("studio_database_types_add_value_note")}</Typography>
                    {preview && <SqlBlock sql={preview.join("\n")}/>}
                    {dialogError && <Alert color="error">{dialogError}</Alert>}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setAdding(null)} disabled={saving}>{t("cancel")}</Button>
                    <Button variant="text" onClick={() => void showPreview()} disabled={!value || saving}>{t("studio_database_preview_sql")}</Button>
                    <Button variant="filled" color="primary" onClick={() => void save()} disabled={!value || saving}>
                        {t("studio_database_types_add_value")}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
