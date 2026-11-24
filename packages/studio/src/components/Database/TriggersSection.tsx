import React, { useState } from "react";
import { useNavigate } from "react-router";
import {
    Alert,
    Button,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    LockIcon,
    RefreshCwIcon,
    SearchBar,
    StatusDot,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TerminalIcon,
    Tooltip,
    Typography,
    ZapIcon
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { asBoolean, asString, asStringArray, isRecord } from "../../utils/adminFetch";
import { sqlDraftLink, tableLink } from "./links";
import { EmptyState, LoadingRow, SectionHeader } from "./shared";
import { matches, useCatalogList } from "./useCatalogList";

interface DbTrigger {
    schema: string;
    table: string;
    name: string;
    definition: string;
    enabled: boolean;
    timing: string;
    events: string[];
    level: string;
    function: string;
    protected: boolean;
}

function parseTrigger(raw: unknown): DbTrigger | null {
    if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.table !== "string") return null;
    return {
        schema: asString(raw.schema),
        table: raw.table,
        name: raw.name,
        definition: asString(raw.definition),
        enabled: asBoolean(raw.enabled, true),
        timing: asString(raw.timing),
        events: asStringArray(raw.events),
        level: asString(raw.level),
        function: asString(raw.function),
        protected: asBoolean(raw.protected)
    };
}

export function TriggersSection() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { items, error, reload } = useCatalogList("triggers", "triggers", parseTrigger);
    const [search, setSearch] = useState("");
    const shown = (items ?? []).filter(trigger => matches(search, trigger.name, trigger.table, trigger.function));

    return (
        <div className="flex flex-col gap-4">
            <SectionHeader
                title={t("studio_database_section_triggers")}
                description={t("studio_database_triggers_description")}
                actions={<>
                    <SearchBar size="small" placeholder={t("studio_database_search")} onTextSearch={(value) => setSearch(value ?? "")}/>
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_database_refresh_aria")} onClick={() => void reload()}>
                            <RefreshCwIcon size={iconSize.small}/>
                        </IconButton>
                    </Tooltip>
                </>}
            />
            {error && <Alert color="error">{error}</Alert>}
            {items === null ? (error ? null : <LoadingRow/>) : shown.length === 0 ? (
                <EmptyState icon={<ZapIcon size={iconSize.large}/>} message={t("studio_database_triggers_empty")}/>
            ) : (
                <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                    <Table className="w-full">
                        <TableHeader>
                            <TableCell header>{t("name")}</TableCell>
                            <TableCell header>{t("studio_database_triggers_table")}</TableCell>
                            <TableCell header>{t("studio_database_triggers_when")}</TableCell>
                            <TableCell header>{t("studio_database_triggers_function")}</TableCell>
                            <TableCell header>{t("studio_enabled")}</TableCell>
                            <TableCell header className="text-right">{t("actions")}</TableCell>
                        </TableHeader>
                        <TableBody>
                            {shown.map(trigger => (
                                <TableRow key={`${trigger.schema}.${trigger.table}.${trigger.name}`}>
                                    <TableCell>
                                        <div className="flex items-center gap-1.5">
                                            <Typography variant="mono" className="text-sm">{trigger.name}</Typography>
                                            {trigger.protected && (
                                                <LockIcon size={iconSize.smallest} className="text-text-disabled dark:text-text-disabled-dark" aria-label={t("studio_database_protected")}/>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Button size="small" variant="text" onClick={() => navigate(tableLink(`${trigger.schema}.${trigger.table}`))}>
                                            {trigger.schema}.{trigger.table}
                                        </Button>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2">{trigger.timing} {trigger.events.join(" OR ")}</Typography>
                                        <Typography variant="caption" color="secondary">
                                            {t(trigger.level === "ROW" ? "studio_database_triggers_for_each_row" : "studio_database_triggers_for_each_statement")}
                                        </Typography>
                                    </TableCell>
                                    <TableCell><Typography variant="mono" className="text-xs">{trigger.function}()</Typography></TableCell>
                                    <TableCell>
                                        <StatusDot tone={trigger.enabled ? "ok" : "idle"} size="small">
                                            {trigger.enabled ? t("studio_enabled") : t("studio_database_disabled")}
                                        </StatusDot>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Tooltip title={t("studio_database_open_in_sql")}>
                                            <IconButton size="small" aria-label={t("studio_database_open_in_sql")} onClick={() => navigate(sqlDraftLink(`${trigger.definition};`))}>
                                                <TerminalIcon size={iconSize.small}/>
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
