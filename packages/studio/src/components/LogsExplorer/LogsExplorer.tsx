import React, { useState, useEffect, useRef, useCallback } from "react";
import { Select, SelectItem, TextField, Checkbox, Label, Typography, cls, defaultBorderMixin } from "@rebasepro/ui";

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

export function LogsExplorer() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [level, setLevel] = useState<string>("all");
    const [source, setSource] = useState<string>("all");
    const [search, setSearch] = useState("");
    const [autoScroll, setAutoScroll] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);
    const fetchLogs = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (level && level !== "all") params.set("level", level);
            if (source && source !== "all") params.set("source", source);
            if (search) params.set("search", search);
            params.set("limit", "200");

            const resp = await fetch(`/api/logs?${params}`);
            if (resp.ok) {
                const data: { entries?: LogEntry[] } = await resp.json();
                setLogs(data.entries || []);
            }
        } catch {
            /* ignore poll failures */
        }
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

    useEffect(() => {
        if (autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
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
                    placeholder="Search logs..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="flex-1 min-w-[200px]"
                />
                <div className="flex items-center gap-1.5 cursor-pointer ml-2">
                    <Checkbox
                        id="auto-scroll"
                        checked={autoScroll}
                        onCheckedChange={setAutoScroll}
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
            
            {/* Log entries */}
            <div
                ref={containerRef}
                className="flex-1 overflow-auto py-2"
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
                        <Typography variant="body2" color="secondary">
                            No log entries yet. Logs will appear here as requests come in.
                        </Typography>
                    </div>
                )}
            </div>
        </div>
    );
}
