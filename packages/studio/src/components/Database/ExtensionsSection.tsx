import React, { useState } from "react";
import {
    Button,
    Checkbox,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    Label,
    PuzzleIcon,
    RefreshCwIcon,
    SearchBar,
    StatusDot,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { asBoolean, asNullableString, isRecord } from "../../utils/adminFetch";
import { EmptyState, LoadingRow, SectionHeader, SectionLoadFailure, statementsOf, useConfirmSql } from "./shared";
import { matches, useCatalogList } from "./useCatalogList";

interface DbExtension {
    name: string;
    defaultVersion: string | null;
    installedVersion: string | null;
    schema: string | null;
    comment: string | null;
    installed: boolean;
}

function parseExtension(raw: unknown): DbExtension | null {
    if (!isRecord(raw) || typeof raw.name !== "string") return null;
    return {
        name: raw.name,
        defaultVersion: asNullableString(raw.defaultVersion),
        installedVersion: asNullableString(raw.installedVersion),
        schema: asNullableString(raw.schema),
        comment: asNullableString(raw.comment),
        installed: asBoolean(raw.installed)
    };
}

/** The server's own procedural language: listed, never dropped. */
const CORE_EXTENSIONS = new Set(["plpgsql"]);

export function ExtensionsSection() {
    const { t } = useTranslation();
    const snackbar = useSnackbarController();
    const { items, failure, reload, requestJson, sourcePath } = useCatalogList("extensions", "extensions", parseExtension);
    const [search, setSearch] = useState("");
    const [installing, setInstalling] = useState<string | null>(null);
    const [confirmDialog, confirm] = useConfirmSql();

    const install = async (extension: DbExtension) => {
        setInstalling(extension.name);
        try {
            await requestJson(sourcePath(`/admin/db/catalog/extensions/${encodeURIComponent(extension.name)}`), { method: "POST", body: {} });
            snackbar.open({ type: "success", message: t("studio_database_extensions_installed_message", { name: extension.name }) });
            await reload();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_database_action_failed") });
        } finally {
            setInstalling(null);
        }
    };

    const askDrop = (extension: DbExtension, cascade: boolean) => {
        const path = `/admin/db/catalog/extensions/${encodeURIComponent(extension.name)}`;
        confirm({
            title: t("studio_database_extensions_drop_title", { name: extension.name }),
            body: (
                <div className="flex flex-col gap-3">
                    <Typography variant="body2">{t(cascade ? "studio_database_extensions_drop_body_cascade" : "studio_database_extensions_drop_body")}</Typography>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="drop-extension-cascade"
                            size="small"
                            checked={cascade}
                            onCheckedChange={(checked: boolean) => askDrop(extension, checked)}
                        />
                        <Label htmlFor="drop-extension-cascade">{t("studio_database_cascade")}</Label>
                    </div>
                </div>
            ),
            confirmLabel: t("studio_database_drop"),
            preview: async () => statementsOf(await requestJson(sourcePath(path), { method: "DELETE", body: { cascade, dryRun: true } })),
            run: async () => {
                await requestJson(sourcePath(path), { method: "DELETE", body: { cascade } });
                snackbar.open({ type: "success", message: t("studio_database_dropped", { name: extension.name }) });
                await reload();
            }
        });
    };

    const shown = (items ?? []).filter(extension => matches(search, extension.name, extension.comment));
    return (
        <div className="flex flex-col gap-4">
            <SectionHeader
                title={t("studio_database_section_extensions")}
                description={t("studio_database_extensions_description")}
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
                <EmptyState icon={<PuzzleIcon size={iconSize.large}/>} message={t("studio_database_extensions_empty")}/>
            ) : (
                <div className={cls("rounded-lg border divide-y divide-hairline overflow-hidden", defaultBorderMixin)}>
                    {shown.map(extension => (
                        <div key={extension.name} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <Typography variant="mono" className="text-sm">{extension.name}</Typography>
                                    <Typography variant="caption" color="secondary">
                                        {extension.installedVersion ?? extension.defaultVersion ?? ""}
                                    </Typography>
                                </div>
                                {extension.comment && (
                                    <Typography variant="caption" color="secondary" className="block truncate">{extension.comment}</Typography>
                                )}
                            </div>
                            {extension.installed ? (
                                <>
                                    <StatusDot tone="ok" size="small">
                                        {extension.schema
                                            ? t("studio_database_extensions_installed_in", { schema: extension.schema })
                                            : t("studio_database_extensions_installed")}
                                    </StatusDot>
                                    {!CORE_EXTENSIONS.has(extension.name) && (
                                        <Tooltip title={t("studio_database_drop")}>
                                            <IconButton size="small" aria-label={t("studio_database_extensions_drop_aria", { name: extension.name })} onClick={() => askDrop(extension, false)}>
                                                <Trash2Icon size={iconSize.smallest} className="text-text-secondary hover:text-red-500 transition-colors"/>
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </>
                            ) : (
                                <Button size="small" disabled={installing !== null} onClick={() => void install(extension)}>
                                    {installing === extension.name ? t("studio_database_extensions_installing") : t("studio_database_extensions_install")}
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {confirmDialog}
        </div>
    );
}
