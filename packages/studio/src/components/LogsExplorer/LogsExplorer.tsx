import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    Alert,
    ArrowDownToLineIcon,
    CheckIcon,
    Checkbox,
    ChevronRightIcon,
    Chip,
    CopyIcon,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    Label,
    Select,
    SelectItem,
    StatusDot,
    TextField,
    Tooltip,
    Typography,
    type StatusTone
} from "@rebasepro/ui";
import { idNum, useLogTail } from "./useLogTail";
import type { LogEntry, LogTransport } from "./useLogTail";
import { useTranslation } from "@rebasepro/app";
import { LoadFailureView } from "../load-failure-view";
import { entriesToJsonLines, entryToJson, formatFieldValue, hasMetadata, isNoisyLogEntry, pillFields, requestSummary, statusTone } from "./logEntryView";

const LEVEL_COLORS: Record<string, string> = {
    debug: "text-surface-500",
    info: "text-blue-600 dark:text-blue-500",
    warn: "text-amber-600 dark:text-amber-500",
    error: "text-red-600 dark:text-red-500"
};

const SOURCE_COLORS: Record<string, string> = {
    api: "text-sky-600 dark:text-sky-400",
    auth: "text-purple-600 dark:text-purple-400",
    storage: "text-green-600 dark:text-green-500",
    realtime: "text-orange-600 dark:text-orange-400",
    system: "text-surface-600 dark:text-surface-400"
};

/** A request's status, by the family it reads as: 5xx red, 4xx amber, the rest green. */
const STATUS_COLORS: Record<ReturnType<typeof statusTone>, string> = {
    error: "text-red-600 dark:text-red-400 font-semibold",
    warn: "text-amber-600 dark:text-amber-400",
    ok: "text-emerald-700 dark:text-emerald-400"
};

const TRANSPORT_LABELS: Record<LogTransport, string> = {
    connecting: "studio_logs_transport_connecting",
    live: "studio_logs_transport_live",
    polling: "studio_logs_transport_polling"
};

const TRANSPORT_TONES: Record<LogTransport, StatusTone> = {
    connecting: "busy",
    live: "ok",
    polling: "idle"
};

const TRANSPORT_TITLES: Record<LogTransport, string> = {
    connecting: "studio_logs_transport_connecting_title",
    live: "studio_logs_transport_live_title",
    polling: "studio_logs_transport_polling_title"
};

/**
 * The level choices, each the lowest level shown: the server reads `level` as
 * a floor. Debug and above is every entry, which "All levels" already says.
 */
const LEVEL_FLOORS = [
    { value: "info", label: "studio_logs_level_min_info" },
    { value: "warn", label: "studio_logs_level_min_warn" },
    { value: "error", label: "studio_logs_level_error" }
] as const;
const SOURCES = ["api", "auth", "storage", "realtime", "system"] as const;

// How close to the bottom edge still counts as "at the bottom".
const STICK_THRESHOLD = 40;

/** How long a copy button shows its tick. */
const COPIED_MS = 1500;

/**
 * Copy `text`, then show the tick for a moment.
 *
 * A clipboard that refuses (no permission, an insecure origin) leaves the
 * button as it was: there is nothing the person can do about it from here,
 * and the text is on screen to select by hand.
 */
function useCopy(): [boolean, (text: string) => void] {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const copy = useCallback((text: string) => {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), COPIED_MS);
        }, () => undefined);
    }, []);
    return [copied, copy];
}

export function LogsExplorer() {
    const { t } = useTranslation();
    const [level, setLevel] = useState<string>("all");
    const [source, setSource] = useState<string>("all");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [autoScroll, setAutoScroll] = useState(true);
    const [hideNoise, setHideNoise] = useState(true);
    // Entries that arrived while the user was scrolled away from the bottom.
    const [newCount, setNewCount] = useState(0);
    const [atBottom, setAtBottom] = useState(true);
    // Open rows, by entry id. Ids are unique within one instance's ring, so
    // the set starts over whenever the window is replaced.
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
    const [copiedVisible, copyVisible] = useCopy();
    const containerRef = useRef<HTMLDivElement>(null);
    // Whether the view is stuck to the bottom right now. A ref, not state:
    // the scroll handler and the entry-counting effect both read it synchronously.
    const stickRef = useRef(true);
    const lastMaxIdRef = useRef<number | null>(null);

    // Debounce the search box so typing doesn't reopen the stream per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchInput), 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    const { logs, error, transport, dropped, instance } = useLogTail({ level,
        source,
        search });

    const visibleLogs = React.useMemo(
        () => (hideNoise ? logs.filter((entry) => !isNoisyLogEntry(entry)) : logs),
        [logs, hideNoise]
    );
    const hiddenNoiseCount = logs.length - visibleLogs.length;

    // A filter change replaces the window wholesale — "new since you looked
    // away" stops meaning anything, so the counter starts over. So does a
    // reconnect that lands on another instance: its ids come from its own
    // counter, and comparing them with this one's counts nothing true.
    useEffect(() => {
        setNewCount(0);
        lastMaxIdRef.current = null;
        setExpanded(new Set());
    }, [level, source, search, instance]);

    // Count what arrived while the user was reading further up. Driven off the
    // rendered window rather than off the transport, so it means the same thing
    // whether the entries were streamed or polled.
    useEffect(() => {
        const max = logs.length > 0 ? idNum(logs[logs.length - 1]) : null;
        const prevMax = lastMaxIdRef.current;
        if (prevMax != null && !stickRef.current) {
            const fresh = logs.filter(e => idNum(e) > prevMax).length;
            if (fresh > 0) setNewCount(c => c + fresh);
        }
        lastMaxIdRef.current = max;
    }, [logs]);

    const scrollToBottom = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        stickRef.current = true;
        setAtBottom(true);
        setNewCount(0);
    }, []);

    // Stick to the bottom only while the user is already there. Scrolling up
    // disengages; scrolling back down re-engages. Our own scrollTop writes
    // always land at the bottom, so they can never disengage it.
    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
        stickRef.current = nearBottom;
        setAtBottom(nearBottom);
        if (nearBottom) setNewCount(0);
    }, []);

    useLayoutEffect(() => {
        if (autoScroll && stickRef.current) {
            const el = containerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
        }
    }, [logs, autoScroll]);

    const toggle = useCallback((id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // A server that does not serve logs has no tail to filter or follow: the
    // failure is the whole pane.
    if (error?.kind === "not_offered" && logs.length === 0) {
        return (
            <div className="flex flex-col h-full w-full bg-surface-sheet">
                <LoadFailureView
                    className="flex-1"
                    failure={error}
                    title={t("studio_logs_read_failed")}
                    deniedTitle={t("studio_logs_denied_title")}
                    deniedHint={t("studio_logs_denied_hint")}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full bg-surface-sheet">
            {/* Toolbar */}
            <div className={cls(
                "flex gap-2 p-3 border-b items-center flex-wrap shrink-0 bg-surface-sheet",
                defaultBorderMixin
            )}>
                <Select
                    value={level}
                    onValueChange={setLevel}
                    size="small"
                    placeholder={t("studio_logs_all_levels")}
                >
                    <SelectItem value="all">{t("studio_logs_all_levels")}</SelectItem>
                    {LEVEL_FLOORS.map(floor => <SelectItem key={floor.value} value={floor.value}>{t(floor.label)}</SelectItem>)}
                </Select>
                <Select
                    value={source}
                    onValueChange={setSource}
                    size="small"
                    placeholder={t("studio_logs_all_sources")}
                >
                    <SelectItem value="all">{t("studio_logs_all_sources")}</SelectItem>
                    {SOURCES.map(src => <SelectItem key={src} value={src}>{t(`studio_logs_source_${src}`)}</SelectItem>)}
                </Select>
                <TextField
                    size="small"
                    aria-label={t("studio_logs_search_label")}
                    placeholder={t("studio_logs_search_placeholder")}
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    className="flex-1 min-w-[200px]"
                />
                <div className="flex items-center gap-1.5 cursor-pointer ml-2">
                    <Checkbox
                        id="auto-scroll"
                        checked={autoScroll}
                        onCheckedChange={(checked: boolean) => {
                            setAutoScroll(checked);
                            if (checked) scrollToBottom();
                        }}
                        size="small"
                        padding={false}
                    />
                    <Label
                        htmlFor="auto-scroll"
                        className="text-xs select-none cursor-pointer text-surface-600 dark:text-surface-400"
                    >
                        {t("studio_logs_auto_scroll")}
                    </Label>
                </div>
                <div className="flex items-center gap-1.5 cursor-pointer ml-2">
                    <Checkbox
                        id="hide-log-noise"
                        checked={hideNoise}
                        onCheckedChange={(checked: boolean) => setHideNoise(checked)}
                        size="small"
                        padding={false}
                    />
                    <Label
                        htmlFor="hide-log-noise"
                        className="text-xs select-none cursor-pointer text-surface-600 dark:text-surface-400"
                    >
                        Hide noise
                    </Label>
                    {hiddenNoiseCount > 0 && (
                        <Chip size="smallest">{`-${hiddenNoiseCount} filtered`}</Chip>
                    )}
                </div>
                {/* Whether the tail is actually attached. A log view with
                    nothing in it is ambiguous — quiet server, or a stream that
                    dropped — and this is the difference. */}
                <div className="ml-auto pl-4 flex items-center gap-3">
                    <div className="flex items-center" title={t(TRANSPORT_TITLES[transport])}>
                        <StatusDot tone={TRANSPORT_TONES[transport]} size="small">
                            {t(TRANSPORT_LABELS[transport])}
                        </StatusDot>
                    </div>
                    <div className="min-w-0" title={t("studio_logs_instance_title")}>
                        <Typography variant="caption" color="secondary" className="block truncate max-w-[18rem]">
                            {instance ? t("studio_logs_this_instance", { instance }) : t("studio_logs_this_instance_only")}
                        </Typography>
                    </div>
                    <Typography variant="caption" color="secondary">
                        {t("studio_logs_entry_count", { count: visibleLogs.length })}
                    </Typography>
                    {/* JSON lines of what is on screen: what a bug report or an
                        agent reads, with the fields the rows only summarise. */}
                    <Tooltip title={copiedVisible ? t("copied") : t("studio_logs_copy_visible")}>
                        <IconButton
                            size="small"
                            aria-label={t("studio_logs_copy_visible")}
                            disabled={visibleLogs.length === 0}
                            onClick={() => copyVisible(entriesToJsonLines(visibleLogs))}
                        >
                            {copiedVisible
                                ? <CheckIcon size={iconSize.smallest} className="text-emerald-500"/>
                                : <CopyIcon size={iconSize.smallest}/>}
                        </IconButton>
                    </Tooltip>
                </div>
            </div>

            {/* A broken tail must stay visible even while stale logs are on
                screen — otherwise the view quietly freezes. */}
            {error && logs.length > 0 && (
                <Alert color="warning" size="small" outerClassName="mx-4 my-1.5 shrink-0">
                    {error.detail}
                </Alert>
            )}

            {/* The server bounds what it holds per connection, so a burst big
                enough leaves a hole in what is on screen. Say so: a tail that
                silently skips entries is worse than one that admits it. */}
            {dropped > 0 && (
                <Alert color="warning" size="small" outerClassName="mx-4 my-1.5 shrink-0">
                    {t("studio_logs_dropped", { count: dropped })}
                </Alert>
            )}

            {/* Log entries */}
            <div className="relative flex-1 min-h-0 bg-surface-card">
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    className="h-full overflow-auto py-2"
                >
                    {visibleLogs.map(log => (
                        <LogRow
                            key={log.id}
                            entry={log}
                            expanded={expanded.has(log.id)}
                            onToggle={toggle}
                        />
                    ))}
                    {/* The tail retries on its own, so the failure offers no
                        Retry of its own. */}
                    {logs.length === 0 && error && (
                        <LoadFailureView
                            failure={error}
                            title={t("studio_logs_read_failed")}
                            deniedTitle={t("studio_logs_denied_title")}
                            deniedHint={t("studio_logs_denied_hint")}
                        />
                    )}
                    {logs.length === 0 && !error && (
                        <div className="p-8 text-center">
                            <Typography variant="body2" color="secondary">
                                {t("studio_logs_empty")}
                            </Typography>
                        </div>
                    )}
                </div>

                {autoScroll && !atBottom && newCount > 0 && (
                    <button
                        onClick={scrollToBottom}
                        className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary text-on-primary text-xs font-medium pl-2.5 pr-3 py-1.5 shadow-md hover:bg-primary-dark transition-colors"
                    >
                        <ArrowDownToLineIcon size={14}/>
                        {t("studio_logs_new_entries", { count: newCount })}
                    </button>
                )}
            </div>
        </div>
    );
}

interface LogRowProps {
    entry: LogEntry;
    expanded: boolean;
    onToggle: (id: string) => void;
}

/**
 * One entry: time, level, source, then the line.
 *
 * A request reads as one sentence (`GET /api/posts 404 · 16 ms`, then its
 * error code and message); anything else reads as its message. Collapsed, the
 * most useful fields ride along as pills; open, the whole metadata is shown as
 * JSON with a copy button. A row with no metadata has nothing more to show and
 * is not a control.
 *
 * Memoised: an append hands every row the same entry object it had, and a tail
 * of a thousand rows re-rendering per frame is what makes a live log stutter.
 */
const LogRow = React.memo(function LogRow({ entry, expanded, onToggle }: LogRowProps) {
    const { t } = useTranslation();
    const [copied, copy] = useCopy();
    const expandable = hasMetadata(entry);
    const request = requestSummary(entry);
    // A request row says method, path, status, time and failure in words, so
    // its pills carry only what that sentence leaves out.
    const { pills, more } = pillFields(request ? request.rest : entry.metadata);
    const failure = request ? [request.errorCode, request.errorMessage].filter(Boolean).join(": ") : "";
    const toggle = () => onToggle(entry.id);

    return (
        <div className={cls("border-b hover:bg-surface-hover transition-colors", defaultBorderMixin)}>
            {/* A row that expands is a control, so it takes a control's
                affordances: reachable by Tab, operable by Enter and Space,
                and announced with its state. */}
            <div
                {...(expandable
                    ? {
                        role: "button",
                        tabIndex: 0,
                        "aria-expanded": expanded,
                        onClick: toggle,
                        onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggle();
                            }
                        }
                    }
                    : {})}
                className={cls(
                    "flex gap-3 px-4 py-[6px]",
                    expandable && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                )}
            >
                <span className="w-3 shrink-0 pt-1 text-text-disabled dark:text-text-disabled-dark">
                    {expandable && (
                        <ChevronRightIcon size={12} className={cls("transition-transform", expanded && "rotate-90")}/>
                    )}
                </span>
                <Typography variant="body2" color="secondary" component="span" className="w-[72px] shrink-0 font-mono" title={entry.timestamp}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                </Typography>
                <Typography
                    variant="body2"
                    component="span"
                    title={t(`studio_logs_level_${entry.level}`)}
                    className={cls("w-[48px] shrink-0 uppercase font-semibold font-mono", LEVEL_COLORS[entry.level] || "text-surface-500")}
                >
                    {entry.level}
                </Typography>
                <Typography variant="body2" component="span" className={cls("w-[80px] shrink-0 font-mono", SOURCE_COLORS[entry.source] || "text-surface-500")}>
                    [{entry.source}]
                </Typography>
                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {request ? (
                        <Typography variant="body2" component="span" className="font-mono break-all whitespace-pre-wrap text-surface-900 dark:text-surface-100">
                            <Typography variant="body2" component="span" color="secondary" className="font-mono">{request.method}</Typography>
                            {` ${request.path} `}
                            <Typography variant="body2" component="span" className={cls("font-mono tabular-nums", STATUS_COLORS[statusTone(request.status)])}>
                                {request.status}
                            </Typography>
                            {request.latencyMs !== null && (
                                <Typography variant="body2" component="span" color="secondary" className="font-mono tabular-nums">
                                    {` · ${request.latencyMs} ms`}
                                </Typography>
                            )}
                            {failure && (
                                <Typography variant="body2" component="span" className={cls("font-mono", STATUS_COLORS[statusTone(request.status)])}>
                                    {` — ${failure}`}
                                </Typography>
                            )}
                        </Typography>
                    ) : (
                        <Typography variant="body2" component="span" className="font-mono break-all whitespace-pre-wrap text-surface-900 dark:text-surface-100">
                            {entry.message}
                        </Typography>
                    )}
                    {/* The extras that make a line useful — a request id, an
                        error code — without opening the row. */}
                    {!expanded && pills.map(([key, value]) => (
                        <Chip key={key} size="smallest" className="font-mono font-normal">
                            <span className="text-text-disabled dark:text-text-disabled-dark">{key}</span>
                            <span className="truncate max-w-[16rem]">{formatFieldValue(value)}</span>
                        </Chip>
                    ))}
                    {!expanded && more > 0 && (
                        <Typography variant="caption" color="secondary" component="span">+{more}</Typography>
                    )}
                </div>
            </div>

            {expanded && (
                <div className="flex items-start gap-2 pb-3 pl-[3.25rem] pr-4">
                    <Typography
                        variant="mono"
                        component="pre"
                        className="flex-1 min-w-0 text-xs bg-surface-field rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all text-surface-700 dark:text-surface-300"
                    >
                        {JSON.stringify(entry.metadata, null, 2)}
                    </Typography>
                    <Tooltip title={copied ? t("copied") : t("studio_logs_copy_entry")}>
                        <IconButton size="small" aria-label={t("studio_logs_copy_entry")} onClick={() => copy(entryToJson(entry))}>
                            {copied
                                ? <CheckIcon size={iconSize.smallest} className="text-emerald-500"/>
                                : <CopyIcon size={iconSize.smallest}/>}
                        </IconButton>
                    </Tooltip>
                </div>
            )}
        </div>
    );
});
