import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
    ActivityIcon,
    cls,
    FunctionSquareIcon,
    GaugeIcon,
    IconButton,
    iconSize,
    PuzzleIcon,
    RefreshCwIcon,
    Select,
    SelectItem,
    ServerCogIcon,
    ShapesIcon,
    ShieldAlertIcon,
    Tooltip,
    Typography,
    ZapIcon
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { asNumber, asString, asStringArray, isRecord, useAdminFetch } from "../../utils/adminFetch";
import { formatBytes, formatCount } from "./format";
import { AdvisorsSection } from "./AdvisorsSection";
import { QueriesSection } from "./QueriesSection";
import { ActivitySection } from "./ActivitySection";
import { FunctionsSection } from "./FunctionsSection";
import { TriggersSection } from "./TriggersSection";
import { TypesSection } from "./TypesSection";
import { ExtensionsSection } from "./ExtensionsSection";
import { DatabaseSourceProvider, DEFAULT_SOURCE, withSource } from "./source";

export const DATABASE_SECTIONS = ["advisors", "queries", "activity", "functions", "triggers", "types", "extensions"] as const;
export type DatabaseSection = (typeof DATABASE_SECTIONS)[number];

const isSection = (value: string | null): value is DatabaseSection =>
    value !== null && DATABASE_SECTIONS.some(section => section === value);

const SECTION_ICONS: Record<DatabaseSection, React.ComponentType<{ size?: number }>> = {
    advisors: ShieldAlertIcon,
    queries: GaugeIcon,
    activity: ActivityIcon,
    functions: FunctionSquareIcon,
    triggers: ZapIcon,
    types: ShapesIcon,
    extensions: PuzzleIcon
};

/** Below this width the section list folds into a select above the content. */
const SIDE_LIST_MIN_WIDTH = 720;

interface Overview {
    engine: "postgres" | "pglite";
    serverVersion: string;
    database: string;
    sizeBytes: number | null;
    connectionsUsed: number | null;
    connectionsMax: number | null;
}

function parseOverview(raw: unknown): Overview | null {
    if (!isRecord(raw)) return null;
    const connections = isRecord(raw.connections) ? raw.connections : {};
    return {
        engine: raw.engine === "pglite" ? "pglite" : "postgres",
        serverVersion: asString(raw.serverVersion),
        database: asString(raw.database),
        sizeBytes: typeof raw.sizeBytes === "number" ? raw.sizeBytes : null,
        connectionsUsed: typeof connections.used === "number" ? asNumber(connections.used) : null,
        connectionsMax: typeof connections.max === "number" ? asNumber(connections.max) : null
    };
}

function Readout({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col min-w-0">
            <Typography variant="micro" color="secondary" className="uppercase">{label}</Typography>
            <Typography variant="body2" className="tabular-nums font-medium truncate">{value}</Typography>
        </div>
    );
}

/**
 * The database as a whole: advice, the queries that take the time, the
 * sessions doing work now, and the objects besides tables — functions,
 * triggers, types, extensions.
 *
 * The open section is in the URL (`?section=`), so a link can land on one.
 * So is the database (`?source=`), when the backend serves more than one —
 * the default, and each declared with `database("…")`.
 */
export function DatabaseView() {
    const { t, i18n } = useTranslation();
    const { requestJson } = useAdminFetch();
    const [searchParams, setSearchParams] = useSearchParams();
    const requested = searchParams.get("section");
    const section: DatabaseSection = isSection(requested) ? requested : "advisors";
    const source = searchParams.get("source") || DEFAULT_SOURCE;
    const [sources, setSources] = useState<string[]>([DEFAULT_SOURCE]);
    const [overview, setOverview] = useState<Overview | null>(null);
    const [advisorCount, setAdvisorCount] = useState<number | null>(null);

    const rootRef = useRef<HTMLDivElement>(null);
    const [wide, setWide] = useState(true);
    useLayoutEffect(() => {
        const element = rootRef.current;
        if (!element || typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= SIDE_LIST_MIN_WIDTH));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const loadOverview = useCallback(async () => {
        try {
            setOverview(parseOverview(await requestJson(withSource("/admin/db/insights/overview", source))));
        } catch {
            setOverview(null);
        }
    }, [requestJson, source]);
    useEffect(() => { void loadOverview(); }, [loadOverview]);

    useEffect(() => {
        requestJson("/admin/db/insights/sources").then(raw => {
            const keys = isRecord(raw) && Array.isArray(raw.sources)
                ? asStringArray(raw.sources.filter(isRecord).map(entry => entry.key))
                : [];
            if (keys.length > 0) setSources(keys);
        }, () => undefined);
    }, [requestJson]);

    const setParam = (name: string, value: string | null) => {
        setSearchParams(params => {
            const updated = new URLSearchParams(params);
            if (value === null) updated.delete(name);
            else updated.set(name, value);
            return updated;
        });
    };
    const select = (next: DatabaseSection) => setParam("section", next === "advisors" ? null : next);
    const selectSource = (next: string) => {
        setAdvisorCount(null);
        setParam("source", next === DEFAULT_SOURCE ? null : next);
    };

    const locale = i18n.language;
    const engine = overview?.engine === "pglite" ? t("studio_database_engine_pglite") : t("studio_database_engine_postgres");
    const connections = overview?.connectionsUsed !== null && overview?.connectionsUsed !== undefined
        ? overview.connectionsMax !== null
            ? t("studio_database_connections_of", { used: formatCount(overview.connectionsUsed, locale), max: formatCount(overview.connectionsMax, locale) })
            : formatCount(overview.connectionsUsed, locale)
        : "—";

    return (
        <div ref={rootRef} className="flex flex-col h-full w-full bg-surface-sheet overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-x-8 gap-y-3 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                    <ServerCogIcon size={iconSize.medium} className="text-text-secondary dark:text-text-secondary-dark shrink-0"/>
                    <div className="min-w-0">
                        <Typography variant="h6">{t("studio_tool_database")}</Typography>
                        <Typography variant="caption" color="secondary" className="block truncate">
                            {overview?.database ? t("studio_database_subtitle_named", { database: overview.database }) : t("studio_tool_database_description")}
                        </Typography>
                    </div>
                </div>
                <div className="flex items-center gap-8 flex-wrap">
                    {sources.length > 1 && (
                        <Select
                            size="small"
                            label={t("studio_database_source")}
                            labelPlacement="above"
                            value={source}
                            onValueChange={selectSource}
                            renderValue={(value) => value === DEFAULT_SOURCE ? t("studio_database_source_default") : value}
                        >
                            {sources.map(key => (
                                <SelectItem key={key} value={key}>
                                    {key === DEFAULT_SOURCE ? t("studio_database_source_default") : key}
                                </SelectItem>
                            ))}
                        </Select>
                    )}
                    <Readout
                        label={t("studio_database_overview_version")}
                        value={overview ? `${engine} ${overview.serverVersion.split(" ")[0]}` : "—"}
                    />
                    <Readout
                        label={t("studio_database_overview_size")}
                        value={overview?.sizeBytes !== null && overview?.sizeBytes !== undefined ? formatBytes(overview.sizeBytes, locale) : "—"}
                    />
                    <Readout label={t("studio_database_overview_connections")} value={connections}/>
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("studio_database_overview_refresh_aria")} onClick={() => void loadOverview()}>
                            <RefreshCwIcon size={iconSize.small}/>
                        </IconButton>
                    </Tooltip>
                </div>
            </div>

            <div className="flex flex-1 min-h-0">
                {wide && (
                    <nav aria-label={t("studio_database_sections_aria")} className="w-[220px] shrink-0 px-2 pb-4 flex flex-col gap-0.5 overflow-y-auto">
                        {DATABASE_SECTIONS.map(entry => {
                            const Icon = SECTION_ICONS[entry];
                            const active = entry === section;
                            return (
                                <button
                                    key={entry}
                                    type="button"
                                    aria-current={active ? "page" : undefined}
                                    onClick={() => select(entry)}
                                    className={cls(
                                        "group/nav flex items-center gap-2.5 h-[30px] px-3 rounded-lg text-left transition-colors",
                                        "hover:bg-surface-hover",
                                        active && "bg-surface-active"
                                    )}
                                >
                                    <span className="text-text-secondary dark:text-text-secondary-dark group-hover/nav:text-text-primary dark:group-hover/nav:text-text-primary-dark">
                                        <Icon size={iconSize.smallest}/>
                                    </span>
                                    <Typography variant="body2" className="flex-1 truncate text-[13px] font-medium">
                                        {t(`studio_database_section_${entry}`)}
                                    </Typography>
                                    {entry === "advisors" && advisorCount !== null && advisorCount > 0 && (
                                        <Typography variant="caption" color="secondary" className="tabular-nums">{advisorCount}</Typography>
                                    )}
                                </button>
                            );
                        })}
                    </nav>
                )}
                <div className={cls("flex-1 min-w-0 overflow-auto bg-surface-card p-5", wide && "rounded-tl-xl")}>
                    {!wide && (
                        <div className="mb-4">
                            <Select
                                size="small"
                                fullWidth
                                label={t("studio_database_sections_aria")}
                                labelPlacement="above"
                                value={section}
                                onValueChange={(value) => { if (isSection(value)) select(value); }}
                            >
                                {DATABASE_SECTIONS.map(entry => (
                                    <SelectItem key={entry} value={entry}>{t(`studio_database_section_${entry}`)}</SelectItem>
                                ))}
                            </Select>
                        </div>
                    )}
                    {/* Keyed by the database, so a section switched to another
                        one starts over rather than showing the last one's rows. */}
                    <DatabaseSourceProvider key={source} source={source}>
                        {section === "advisors" && <AdvisorsSection onCount={setAdvisorCount}/>}
                        {section === "queries" && <QueriesSection/>}
                        {section === "activity" && <ActivitySection/>}
                        {section === "functions" && <FunctionsSection/>}
                        {section === "triggers" && <TriggersSection/>}
                        {section === "types" && <TypesSection/>}
                        {section === "extensions" && <ExtensionsSection/>}
                    </DatabaseSourceProvider>
                </div>
            </div>
        </div>
    );
}
