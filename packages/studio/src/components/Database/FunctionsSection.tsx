import React, { useState } from "react";
import { useNavigate } from "react-router";
import {
    Button,
    Chip,
    cls,
    defaultBorderMixin,
    FunctionSquareIcon,
    IconButton,
    iconSize,
    LockIcon,
    RefreshCwIcon,
    SearchBar,
    TerminalIcon,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { asBoolean, asNullableString, asString, isRecord } from "../../utils/adminFetch";
import { sqlDraftLink } from "./links";
import { EmptyState, LoadingRow, SectionHeader, SectionLoadFailure, SqlBlock, statementsOf, useConfirmSql } from "./shared";
import { matches, useCatalogList } from "./useCatalogList";

interface DbFunction {
    schema: string;
    name: string;
    args: string;
    returns: string | null;
    language: string;
    kind: "function" | "procedure";
    securityDefiner: boolean;
    volatility: string;
    comment: string | null;
    definition: string;
    protected: boolean;
}

function parseFunction(raw: unknown): DbFunction | null {
    if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.schema !== "string") return null;
    return {
        schema: raw.schema,
        name: raw.name,
        args: asString(raw.args),
        returns: asNullableString(raw.returns),
        language: asString(raw.language),
        kind: raw.kind === "procedure" ? "procedure" : "function",
        securityDefiner: asBoolean(raw.securityDefiner),
        volatility: asString(raw.volatility),
        comment: asNullableString(raw.comment),
        definition: asString(raw.definition),
        protected: asBoolean(raw.protected)
    };
}

const signature = (fn: DbFunction) => `${fn.schema}.${fn.name}(${fn.args})`;

export function FunctionsSection() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const snackbar = useSnackbarController();
    const { items, failure, reload, requestJson, sourcePath } = useCatalogList("functions", "functions", parseFunction);
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState<string | null>(null);
    const [confirmDialog, confirm] = useConfirmSql();

    const path = (fn: DbFunction) => `/admin/db/catalog/functions/${encodeURIComponent(fn.schema)}/${encodeURIComponent(fn.name)}`;
    const askDrop = (fn: DbFunction) => confirm({
        title: t("studio_database_functions_drop_title", { name: signature(fn) }),
        body: t("studio_database_functions_drop_body"),
        confirmLabel: t("studio_database_drop"),
        preview: async () => statementsOf(await requestJson(sourcePath(path(fn)), { method: "DELETE", body: { args: fn.args, dryRun: true } })),
        run: async () => {
            await requestJson(sourcePath(path(fn)), { method: "DELETE", body: { args: fn.args } });
            snackbar.open({ type: "success", message: t("studio_database_dropped", { name: signature(fn) }) });
            setOpen(null);
            await reload();
        }
    });

    const shown = (items ?? []).filter(fn => matches(search, fn.name, fn.schema, fn.comment));
    return (
        <div className="flex flex-col gap-4">
            <SectionHeader
                title={t("studio_database_section_functions")}
                description={t("studio_database_functions_description")}
                actions={<>
                    <SearchBar size="small" placeholder={t("studio_database_search")} onTextSearch={(value) => setSearch(value ?? "")}/>
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_database_refresh_aria")} onClick={() => void reload()}>
                            <RefreshCwIcon size={iconSize.small}/>
                        </IconButton>
                    </Tooltip>
                </>}
            />
            {failure && <SectionLoadFailure failure={failure} stale={items !== null} onRetry={() => void reload()}/>}
            {items === null ? (failure ? null : <LoadingRow/>) : shown.length === 0 ? (
                <EmptyState icon={<FunctionSquareIcon size={iconSize.large}/>} message={t("studio_database_functions_empty")}/>
            ) : (
                <div className={cls("rounded-lg border divide-y divide-hairline overflow-hidden", defaultBorderMixin)}>
                    {shown.map(fn => {
                        const key = signature(fn);
                        const expanded = open === key;
                        return (
                            <div key={key} className="flex flex-col gap-2 px-4 py-2.5">
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        className="min-w-0 flex-1 text-left rounded-lg hover:bg-surface-hover -mx-2 px-2 py-1"
                                        aria-expanded={expanded}
                                        onClick={() => setOpen(expanded ? null : key)}
                                    >
                                        <Typography variant="mono" className="text-sm truncate block">
                                            {fn.name}({fn.args})
                                        </Typography>
                                        <Typography variant="caption" color="secondary" className="block truncate">
                                            {[fn.schema, fn.kind === "procedure" ? t("studio_database_functions_procedure") : fn.returns, fn.language, fn.volatility].filter(Boolean).join(" · ")}
                                        </Typography>
                                    </button>
                                    {fn.securityDefiner && <Chip size="smallest" colorScheme="orangeLight">{t("studio_database_functions_security_definer")}</Chip>}
                                    {fn.protected ? (
                                        <Tooltip title={t("studio_database_protected")}>
                                            <LockIcon size={iconSize.smallest} className="text-text-disabled dark:text-text-disabled-dark" aria-label={t("studio_database_protected")}/>
                                        </Tooltip>
                                    ) : (
                                        <Tooltip title={t("studio_database_drop")}>
                                            <IconButton size="small" aria-label={t("studio_database_functions_drop_aria", { name: key })} onClick={() => askDrop(fn)}>
                                                <Trash2Icon size={iconSize.smallest} className="text-text-secondary hover:text-red-500 transition-colors"/>
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </div>
                                {expanded && (
                                    <div className="flex flex-col gap-2">
                                        {fn.comment && <Typography variant="body2" color="secondary">{fn.comment}</Typography>}
                                        <SqlBlock sql={fn.definition}/>
                                        <div>
                                            <Button size="small" onClick={() => navigate(sqlDraftLink(fn.definition))}>
                                                <TerminalIcon size={iconSize.smallest}/>
                                                {t("studio_database_edit_in_sql")}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {confirmDialog}
        </div>
    );
}
