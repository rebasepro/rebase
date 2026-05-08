import React, { useState, useEffect } from "react";

export function RealtimeMiniDemo() {
    const [syncState, setSyncState] = useState(0);

    useEffect(() => {
        let isMounted = true;
        const loop = async () => {
            while (isMounted) {
                setSyncState(0); // initial table state
                await new Promise(r => setTimeout(r, 1200));
                if (!isMounted) return;
                setSyncState(1); // row update arrives
                await new Promise(r => setTimeout(r, 300));
                if (!isMounted) return;
                setSyncState(2); // row highlighted, value changed
                await new Promise(r => setTimeout(r, 2000));
                if (!isMounted) return;
                setSyncState(3); // new row insert pulse
                await new Promise(r => setTimeout(r, 300));
                if (!isMounted) return;
                setSyncState(4); // new row visible
                await new Promise(r => setTimeout(r, 2000));
                if (!isMounted) return;
                setSyncState(5); // delete row pulse
                await new Promise(r => setTimeout(r, 300));
                if (!isMounted) return;
                setSyncState(6); // row removed
                await new Promise(r => setTimeout(r, 2000));
            }
        };
        loop();
        return () => { isMounted = false; };
    }, []);

    const headerCols = ["id", "name", "status", "updated"];

    const rows = [
        { id: "1", name: "Alice", status: syncState >= 2 ? "active" : "pending", updated: syncState >= 2 ? "just now" : "2m ago" },
        { id: "2", name: "Bob", status: "active", updated: "5m ago" },
        { id: "3", name: "Carol", status: "inactive", updated: "1h ago" },
    ];

    const showNewRow = syncState >= 4 && syncState < 6;
    const newRow = { id: "4", name: "Dave", status: "active", updated: "just now" };

    const statusColor = (s: string) => {
        if (s === "active") return "text-emerald-400 bg-emerald-400/10";
        if (s === "pending") return "text-amber-400 bg-amber-400/10";
        return "text-surface-500 bg-surface-800";
    };

    return (
        <div className="h-full w-full bg-surface-950 flex flex-col pointer-events-none select-none overflow-hidden relative font-mono">
            {/* Connection status bar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-800/60 bg-[#161618] shrink-0">
                <div className={`w-1.5 h-1.5 rounded-full ${syncState === 1 || syncState === 3 || syncState === 5 ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`}></div>
                <span className="text-[8px] text-surface-500 uppercase tracking-wider font-semibold">
                    {syncState === 1 || syncState === 3 || syncState === 5 ? "syncing..." : "connected"}
                </span>
                <span className="text-[8px] text-surface-600 ml-auto">ws://localhost:3000/realtime</span>
            </div>

            {/* Event log */}
            <div className="flex items-center gap-1.5 px-3 py-1 border-b border-surface-800/40 bg-surface-900/30 shrink-0 overflow-hidden">
                {syncState >= 2 && (
                    <span className="text-[8px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-sm animate-[fade-in_0.2s_ease-out]">
                        UPDATE users SET status=&apos;active&apos; WHERE id=1
                    </span>
                )}
                {syncState >= 4 && syncState < 6 && (
                    <span className="text-[8px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-sm animate-[fade-in_0.2s_ease-out]">
                        INSERT users (Dave)
                    </span>
                )}
                {syncState >= 6 && (
                    <span className="text-[8px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-sm animate-[fade-in_0.2s_ease-out]">
                        DELETE users WHERE id=4
                    </span>
                )}
                {syncState < 2 && (
                    <span className="text-[8px] text-surface-600 italic">Listening for changes...</span>
                )}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-hidden">
                {/* Header */}
                <div className="flex px-3 py-1.5 border-b border-surface-800/60 bg-surface-900/20">
                    {headerCols.map(col => (
                        <div key={col} className="flex-1 text-[8px] font-semibold text-surface-500 uppercase tracking-wider">{col}</div>
                    ))}
                </div>

                {/* Rows */}
                {rows.map((row, i) => {
                    const isUpdated = i === 0 && syncState >= 1 && syncState <= 2;
                    return (
                        <div key={row.id} className={`flex px-3 py-2 border-b border-surface-800/30 transition-all duration-300 ${isUpdated ? "bg-primary/5 ring-1 ring-inset ring-primary/20" : ""}`}>
                            <div className="flex-1 text-[9px] text-surface-500">{row.id}</div>
                            <div className="flex-1 text-[9px] text-white">{row.name}</div>
                            <div className="flex-1">
                                <span className={`text-[8px] px-1.5 py-0.5 rounded ${statusColor(row.status)}`}>{row.status}</span>
                            </div>
                            <div className={`flex-1 text-[9px] ${isUpdated ? "text-primary" : "text-surface-600"}`}>{row.updated}</div>
                        </div>
                    );
                })}

                {/* New row insertion */}
                {showNewRow && (
                    <div className="flex px-3 py-2 border-b border-surface-800/30 bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/20 animate-[fade-in_0.3s_ease-out]">
                        <div className="flex-1 text-[9px] text-surface-500">{newRow.id}</div>
                        <div className="flex-1 text-[9px] text-white">{newRow.name}</div>
                        <div className="flex-1">
                            <span className={`text-[8px] px-1.5 py-0.5 rounded ${statusColor(newRow.status)}`}>{newRow.status}</span>
                        </div>
                        <div className="flex-1 text-[9px] text-emerald-400">{newRow.updated}</div>
                    </div>
                )}
            </div>
        </div>
    );
}
