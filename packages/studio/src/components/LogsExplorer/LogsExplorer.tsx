import React, { useState, useEffect, useRef, useCallback } from "react";
import { Select, SelectItem, TextField, Checkbox, Label } from "@rebasepro/ui";

interface LogEntry {
    id: string;
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    source: "api" | "auth" | "storage" | "realtime" | "system";
    message: string;
    metadata?: Record<string, unknown>;
}

const LEVEL_COLORS: Record<string, string> = {
    debug: "#6c7086",
    info: "#89b4fa",
    warn: "#f9e2af",
    error: "#f38ba8"
};

const SOURCE_COLORS: Record<string, string> = {
    api: "#74c7ec",
    auth: "#cba6f7",
    storage: "#a6e3a1",
    realtime: "#fab387",
    system: "#6c7086"
};

export function LogsExplorer() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [level, setLevel] = useState<string>("");
    const [source, setSource] = useState<string>("");
    const [search, setSearch] = useState("");
    const [autoScroll, setAutoScroll] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);
    const fetchLogs = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (level) params.set("level", level);
            if (source) params.set("source", source);
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

    const selectStyle: React.CSSProperties = {
        background: "#313244",
        color: "#cdd6f4",
        border: "1px solid #45475a",
        borderRadius: 4,
        padding: "4px 8px"
    };

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            height: "calc(100vh - 64px)",
            background: "#1e1e2e",
            color: "#cdd6f4"
        }}>
            {/* Toolbar */}
            <div style={{
                display: "flex",
                gap: 8,
                padding: "8px 16px",
                borderBottom: "1px solid #313244",
                alignItems: "center",
                flexWrap: "wrap"
            }}>
                <Select
                    value={level}
                    onValueChange={setLevel}
                    size="small"
                    placeholder="All Levels"
                >
                    <SelectItem value="">All Levels</SelectItem>
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
                    <SelectItem value="">All Sources</SelectItem>
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
                <div className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                        id="auto-scroll"
                        checked={autoScroll}
                        onCheckedChange={setAutoScroll}
                        size="small"
                        padding={false}
                    />
                    <Label
                        htmlFor="auto-scroll"
                        className="text-xs select-none cursor-pointer"
                    >
                        Auto-scroll
                    </Label>
                </div>
                <span style={{ fontSize: 12, color: "#6c7086" }}>
                    {logs.length} entries
                </span>
            </div>
            {/* Log entries */}
            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    overflow: "auto",
                    fontFamily: "monospace",
                    fontSize: 12,
                    padding: "8px 0"
                }}
            >
                {logs.map(log => (
                    <div
                        key={log.id}
                        style={{
                            padding: "2px 16px",
                            display: "flex",
                            gap: 8,
                            borderBottom: "1px solid #181825"
                        }}
                    >
                        <span style={{ color: "#6c7086", flexShrink: 0 }}>
                            {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span style={{
                            color: LEVEL_COLORS[log.level] || "#cdd6f4",
                            width: 40,
                            flexShrink: 0,
                            textTransform: "uppercase",
                            fontWeight: 600
                        }}>
                            {log.level}
                        </span>
                        <span style={{
                            color: SOURCE_COLORS[log.source] || "#cdd6f4",
                            width: 64,
                            flexShrink: 0
                        }}>
                            [{log.source}]
                        </span>
                        <span style={{ color: "#cdd6f4", flex: 1 }}>
                            {log.message}
                        </span>
                    </div>
                ))}
                {logs.length === 0 && (
                    <div style={{
                        padding: 32,
                        textAlign: "center",
                        color: "#6c7086"
                    }}>
                        No log entries yet. Logs will appear here as requests come in.
                    </div>
                )}
            </div>
        </div>
    );
}
