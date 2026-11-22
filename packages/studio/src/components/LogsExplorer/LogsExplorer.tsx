import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, ArrowDownToLineIcon, Checkbox, cls, defaultBorderMixin, Label, Select, SelectItem, StatusDot, TextField, Typography, type StatusTone } from "@rebasepro/ui";
import { idNum, useLogTail } from "./useLogTail";
import type { LogTransport } from "./useLogTail";
import { useTranslation } from "@rebasepro/app";

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

const LEVELS = ["debug", "info", "warn", "error"] as const;
const SOURCES = ["api", "auth", "storage", "realtime", "system"] as const;

// How close to the bottom edge still counts as "at the bottom".
const STICK_THRESHOLD = 40;

export function LogsExplorer() {
    const { t } = useTranslation();
    const [level, setLevel] = useState<string>("all");
    const [source, setSource] = useState<string>("all");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [autoScroll, setAutoScroll] = useState(true);
    // Entries that arrived while the user was scrolled away from the bottom.
    const [newCount, setNewCount] = useState(0);
    const [atBottom, setAtBottom] = useState(true);
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

    // A filter change replaces the window wholesale — "new since you looked
    // away" stops meaning anything, so the counter starts over. So does a
    // reconnect that lands on another instance: its ids come from its own
    // counter, and comparing them with this one's counts nothing true.
    useEffect(() => {
        setNewCount(0);
        lastMaxIdRef.current = null;
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

    return (
        <div className="flex flex-col h-[calc(100vh-64px)] w-full bg-surface-sheet">
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
                    {LEVELS.map(l => <SelectItem key={l} value={l}>{t(`studio_logs_level_${l}`)}</SelectItem>)}
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
                    aria-label="Search logs"
                    placeholder="Search logs..."
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
                        Auto-scroll
                    </Label>
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
                            {instance ? `This instance: ${instance}` : "This instance only"}
                        </Typography>
                    </div>
                    <Typography variant="caption" color="secondary">
                        {logs.length} entries
                    </Typography>
                </div>
            </div>

            {/* A broken tail must stay visible even while stale logs are on
                screen — otherwise the view quietly freezes. */}
            {error && logs.length > 0 && (
                <Alert color="warning" size="small" outerClassName="mx-4 my-1.5 shrink-0">
                    {error}
                </Alert>
            )}

            {/* The server bounds what it holds per connection, so a burst big
                enough leaves a hole in what is on screen. Say so: a tail that
                silently skips entries is worse than one that admits it. */}
            {dropped > 0 && (
                <Alert color="warning" size="small" outerClassName="mx-4 my-1.5 shrink-0">
                    {dropped} {dropped === 1 ? "entry was" : "entries were"} dropped — the log is
                    arriving faster than this view can read it. Narrow the filter to keep up.
                </Alert>
            )}

            {/* Log entries */}
            <div className="relative flex-1 min-h-0 bg-surface-card">
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    className="h-full overflow-auto py-2"
                >
                    {logs.map(log => (
                        <div
                            key={log.id}
                            className={cls(
                                "flex gap-4 px-4 py-[6px] border-b hover:bg-surface-hover transition-colors",
                                defaultBorderMixin
                            )}
                        >
                            <Typography variant="body2" color="secondary" className="w-[72px] shrink-0 font-mono">
                                {new Date(log.timestamp).toLocaleTimeString()}
                            </Typography>
                            <Typography variant="body2" className={cls("w-[48px] shrink-0 uppercase font-semibold font-mono", LEVEL_COLORS[log.level] || "text-surface-500")}>
                                {log.level}
                            </Typography>
                            <Typography variant="body2" className={cls("w-[80px] shrink-0 font-mono", SOURCE_COLORS[log.source] || "text-surface-500")}>
                                [{log.source}]
                            </Typography>
                            <Typography variant="body2" className="flex-1 font-mono break-all whitespace-pre-wrap text-surface-900 dark:text-surface-100">
                                {log.message}
                            </Typography>
                        </div>
                    ))}
                    {logs.length === 0 && (
                        <div className="p-8 text-center">
                            <Typography
                                variant="body2"
                                className={error ? "text-red-600 dark:text-red-500" : undefined}
                                color={error ? undefined : "secondary"}
                            >
                                {error ?? "No log entries yet. Logs will appear here as this instance serves requests."}
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
                        {newCount} new {newCount === 1 ? "entry" : "entries"}
                    </button>
                )}
            </div>
        </div>
    );
}
