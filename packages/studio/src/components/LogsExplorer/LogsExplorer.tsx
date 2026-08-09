import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownToLineIcon, Checkbox, cls, defaultBorderMixin, Label, Select, SelectItem, TextField, Typography } from "@rebasepro/ui";
import { useApiBase, useApiConfig } from "@rebasepro/app";

interface LogEntry {
    id: string;
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    source: "api" | "auth" | "storage" | "realtime" | "system";
    message: string;
    metadata?: Record<string, unknown>;
}

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

// Ids are `log_<n>` with a monotonic counter, so numeric comparison tells
// old entries from new ones across polls.
const idNum = (entry: LogEntry): number => Number(entry.id.slice("log_".length));

// The window is contiguous and ordered, so identical ends mean identical content.
const sameLogs = (a: LogEntry[], b: LogEntry[]): boolean =>
    a.length === b.length &&
    a[0]?.id === b[0]?.id &&
    a[a.length - 1]?.id === b[b.length - 1]?.id;

// How close to the bottom edge still counts as "at the bottom".
const STICK_THRESHOLD = 40;

export function LogsExplorer() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [level, setLevel] = useState<string>("all");
    const [source, setSource] = useState<string>("all");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [autoScroll, setAutoScroll] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Entries that arrived while the user was scrolled away from the bottom.
    const [newCount, setNewCount] = useState(0);
    const [atBottom, setAtBottom] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);
    // Whether the view is stuck to the bottom right now. A ref, not state:
    // the scroll handler and the fetch loop both read it synchronously.
    const stickRef = useRef(true);
    const lastMaxIdRef = useRef<number | null>(null);
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();

    // Debounce the search box so typing doesn't refetch per keystroke.
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const fetchLogs = useCallback(async () => {
        if (!apiConfig?.apiUrl) {
            setError("No API URL configured — cannot load logs.");
            return;
        }
        try {
            const params = new URLSearchParams();
            if (level && level !== "all") params.set("level", level);
            if (source && source !== "all") params.set("source", source);
            if (search) params.set("search", search);
            params.set("limit", "200");

            // Logs are admin-only, so the request must carry the auth token. The
            // URL is absolute: a relative one would resolve against the frontend
            // origin, which serves index.html rather than the API.
            const headers: Record<string, string> = {};
            const token = apiConfig.getAuthToken ? await apiConfig.getAuthToken() : null;
            if (token) headers["Authorization"] = `Bearer ${token}`;

            const resp = await fetch(`${apiBase}/logs?${params}`, { headers });
            if (!resp.ok) {
                setError(resp.status === 401 || resp.status === 403
                    ? "Not authorised to read logs — an admin role is required."
                    : `Could not load logs (HTTP ${resp.status}).`);
                return;
            }
            const data: { entries?: LogEntry[] } = await resp.json();
            // The API returns newest-first; the view tails like a terminal, so
            // flip to chronological order (newest at the bottom).
            const entries = (data.entries || []).slice().reverse();

            const prevMax = lastMaxIdRef.current;
            if (prevMax != null && !stickRef.current) {
                const fresh = entries.filter(e => idNum(e) > prevMax).length;
                if (fresh > 0) setNewCount(c => c + fresh);
            }
            if (entries.length > 0) lastMaxIdRef.current = idNum(entries[entries.length - 1]);

            // Unchanged window → keep the previous array so React leaves the
            // DOM alone (hover states and text selection survive the poll).
            setLogs(prev => sameLogs(prev, entries) ? prev : entries);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not load logs.");
        }
    }, [level, source, search, apiConfig, apiBase]);

    // A filter change replaces the window wholesale — "new entries since last
    // poll" stops meaning anything, so the counter starts over.
    useEffect(() => {
        lastMaxIdRef.current = null;
        setNewCount(0);
    }, [level, source, search]);

    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;

        fetchLogs();

        const scheduleNext = () => {
            if (cancelled) return;
            timeoutId = setTimeout(async () => {
                if (document.visibilityState === "visible") {
                    await fetchLogs();
                }
                scheduleNext();
            }, 3000);
        };

        scheduleNext();

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                fetchLogs();
            }
        };
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [fetchLogs]);

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
        <div className="flex flex-col h-[calc(100vh-64px)] w-full bg-surface-50 dark:bg-surface-800">
            {/* Toolbar */}
            <div className={cls(
                "flex gap-2 p-3 border-b items-center flex-wrap shrink-0",
                defaultBorderMixin
            )}>
                <Select
                    value={level}
                    onValueChange={setLevel}
                    size="small"
                    placeholder="All Levels"
                >
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="debug">Debug</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warn">Warn</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                </Select>
                <Select
                    value={source}
                    onValueChange={setSource}
                    size="small"
                    placeholder="All Sources"
                >
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="api">API</SelectItem>
                    <SelectItem value="auth">Auth</SelectItem>
                    <SelectItem value="storage">Storage</SelectItem>
                    <SelectItem value="realtime">Realtime</SelectItem>
                    <SelectItem value="system">System</SelectItem>
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
                <div className="ml-auto pl-4">
                    <Typography variant="caption" color="secondary">
                        {logs.length} entries
                    </Typography>
                </div>
            </div>

            {/* A failing poll must stay visible even while stale logs are on
                screen — otherwise the view quietly freezes. */}
            {error && logs.length > 0 && (
                <div className={cls(
                    "px-4 py-1.5 border-b bg-amber-50 dark:bg-amber-950/20 shrink-0",
                    defaultBorderMixin
                )}>
                    <Typography variant="caption" className="text-amber-700 dark:text-amber-400">
                        {error}
                    </Typography>
                </div>
            )}

            {/* Log entries */}
            <div className="relative flex-1 min-h-0">
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    className="h-full overflow-auto py-2"
                >
                    {logs.map(log => (
                        <div
                            key={log.id}
                            className={cls(
                                "flex gap-4 px-4 py-[6px] border-b hover:bg-surface-100 dark:hover:bg-surface-900 transition-colors",
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
                                {error ?? "No log entries yet. Logs will appear here as requests come in."}
                            </Typography>
                        </div>
                    )}
                </div>

                {autoScroll && !atBottom && newCount > 0 && (
                    <button
                        onClick={scrollToBottom}
                        className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary text-white text-xs font-medium pl-2.5 pr-3 py-1.5 shadow-md hover:bg-primary-dark transition-colors"
                    >
                        <ArrowDownToLineIcon size={14}/>
                        {newCount} new {newCount === 1 ? "entry" : "entries"}
                    </button>
                )}
            </div>
        </div>
    );
}
