import React, { useState, useEffect } from "react";

type Row = { id: string; name: string; status: string; updated: string };

type Phase = "idle" | "move" | "click" | "travel" | "applied";

/** One simulated edit: who made it, which row, and what it became. */
const SCRIPT: { origin: "a" | "b"; rowId: string; status: string }[] = [
    { origin: "a", rowId: "1", status: "active" },
    { origin: "b", rowId: "3", status: "active" },
    { origin: "a", rowId: "4", status: "pending" },
    { origin: "b", rowId: "2", status: "pending" },
];

const INITIAL_ROWS: Row[] = [
    { id: "1", name: "Alice", status: "pending", updated: "2m ago" },
    { id: "2", name: "Bob", status: "active", updated: "5m ago" },
    { id: "3", name: "Carol", status: "inactive", updated: "1h ago" },
    { id: "4", name: "Dave", status: "active", updated: "12m ago" },
];

// Row geometry, in px — the cursor is absolutely positioned, so it has to
// agree with the list layout below (header, then one ROW_H per row). The
// right offset lands the pointer on the status pill, which is right-aligned.
const HEADER_H = 18;
const ROW_H = 30;
const STATUS_FROM_RIGHT = 66;

export function RealtimeMiniDemo() {
    const [rows, setRows] = useState<Row[]>(INITIAL_ROWS);
    const [step, setStep] = useState(0);
    const [phase, setPhase] = useState<Phase>("idle");

    useEffect(() => {
        let isMounted = true;
        const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

        const loop = async () => {
            let i = 0;
            while (isMounted) {
                const event = SCRIPT[i % SCRIPT.length];
                setStep(i % SCRIPT.length);

                setPhase("idle");
                await wait(900);
                if (!isMounted) return;

                setPhase("move");
                await wait(750);
                if (!isMounted) return;

                // The pane the cursor is in applies the write locally...
                setPhase("click");
                setRows(prev => prev.map(r => r.id === event.rowId
                    ? { ...r, status: event.status, updated: "just now" }
                    : r.updated === "just now" ? { ...r, updated: "1m ago" } : r));
                await wait(320);
                if (!isMounted) return;

                // ...the frame crosses the socket...
                setPhase("travel");
                await wait(520);
                if (!isMounted) return;

                // ...and the other pane repaints from the same change.
                setPhase("applied");
                await wait(1700);
                if (!isMounted) return;

                i++;
            }
        };
        loop();
        return () => { isMounted = false; };
    }, []);

    const event = SCRIPT[step];
    const targetIndex = INITIAL_ROWS.findIndex(r => r.id === event.rowId);

    // The originating pane shows the row as changed from the click onward; the
    // remote pane only catches up once the frame has landed.
    const localChanged = phase === "click" || phase === "travel" || phase === "applied";
    const remoteChanged = phase === "applied";

    const paneRows = (side: "a" | "b"): Row[] => {
        const applied = side === event.origin ? localChanged : remoteChanged;
        if (applied) return rows;
        // This pane hasn't seen the frame yet: hold the target row at whatever
        // the previous event left it at.
        return rows.map(r => r.id === event.rowId
            ? { ...r, status: previousStatus(r.id, step), updated: previousUpdated(r.id, step) }
            : r);
    };

    // Before a frame lands, the remote pane still shows what it had *before*
    // this event — i.e. the state the previous event left behind.
    function previousStatus(rowId: string, at: number): string {
        let status = INITIAL_ROWS.find(r => r.id === rowId)!.status;
        for (let k = 0; k < at; k++) {
            if (SCRIPT[k].rowId === rowId) status = SCRIPT[k].status;
        }
        return status;
    }

    function previousUpdated(rowId: string, at: number): string {
        const last = [...Array(at).keys()].reverse().find(k => SCRIPT[k].rowId === rowId);
        if (last === undefined) return INITIAL_ROWS.find(r => r.id === rowId)!.updated;
        return at - last === 1 ? "just now" : "1m ago";
    }

    // The product's chip palette (CHIP_COLORS, dark) rather than a tinted
    // Tailwind pill — these are enum values in a collection cell, and they
    // should read as the same object they are in the admin panel.
    const statusColor = (s: string) => {
        if (s === "active") return "chip-green";
        if (s === "pending") return "chip-yellow";
        return "chip-gray";
    };

    // A plain function, not a nested component: a component defined inside the
    // render body gets a new identity every render, so React would remount both
    // windows and the cursor would teleport instead of gliding.
    const renderPane = (side: "a" | "b", label: string) => {
        const isOrigin = side === event.origin;
        const data = paneRows(side);
        const showCursor = isOrigin && phase !== "idle";
        const justApplied = !isOrigin && phase === "applied";
        const cursorTop = HEADER_H + targetIndex * ROW_H + ROW_H / 2 - 2;

        return (
            <div className={`flex-1 min-w-0 flex flex-col relative rounded-lg overflow-hidden bg-surface-950 border transition-colors duration-300 shadow-[0_6px_20px_rgba(0,0,0,0.5)] ${justApplied ? "border-primary/40" : "border-surface-800"}`}>
                {/* Each client is its own window: own traffic lights, own URL bar */}
                <div className="flex items-center gap-1 px-2 py-1 border-b border-surface-800/70 bg-[#161618] shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500/70"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400/70"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/70"></div>
                    <span className="ml-1 text-[8px] text-surface-400 truncate">{label}</span>
                    {justApplied && (
                        <span className="ml-auto text-[7px] text-primary uppercase tracking-wider rt-fade shrink-0">synced</span>
                    )}
                    {isOrigin && (phase === "click" || phase === "travel") && (
                        <span className="ml-auto text-[7px] text-amber-400 uppercase tracking-wider rt-fade shrink-0">writing</span>
                    )}
                </div>

                {/* Table */}
                <div className="relative flex-1 overflow-hidden">
                    <div className="flex px-2 items-center border-b border-surface-800/50 bg-surface-900/20" style={{ height: HEADER_H }}>
                        <div className="flex-1 text-[7px] font-semibold text-surface-500 uppercase tracking-wider">name</div>
                        <div className="w-12 text-[7px] font-semibold text-surface-500 uppercase tracking-wider">status</div>
                        <div className="w-10 text-[7px] font-semibold text-surface-500 uppercase tracking-wider text-right">upd</div>
                    </div>

                    {data.map(row => {
                        const isTarget = row.id === event.rowId;
                        const lit = isTarget && ((isOrigin && localChanged) || justApplied);
                        return (
                            <div
                                key={row.id}
                                className={`flex px-2 items-center border-b border-surface-800/25 transition-colors duration-300 ${lit ? "bg-primary/10 ring-1 ring-inset ring-primary/25" : ""}`}
                                style={{ height: ROW_H }}
                            >
                                <div className="flex-1 text-[9px] text-white truncate">{row.name}</div>
                                <div className="w-12">
                                    <span className={`chip text-[8px] px-1 py-0.5 rounded-md transition-colors duration-300 ${statusColor(row.status)}`}>{row.status}</span>
                                </div>
                                <div className={`w-10 text-[8px] text-right truncate ${lit ? "text-primary" : "text-surface-500"}`}>{row.updated}</div>
                            </div>
                        );
                    })}

                    {/* Simulated pointer, only in the pane making the edit */}
                    <div
                        className="absolute pointer-events-none transition-all duration-500 ease-out"
                        style={{
                            right: showCursor ? STATUS_FROM_RIGHT : "62%",
                            top: showCursor ? cursorTop : "82%",
                            opacity: showCursor ? 1 : 0,
                        }}
                    >
                        {phase === "click" && (
                            <span className="absolute -left-2 -top-2 w-6 h-6 rounded-full bg-primary/30 rt-ping"></span>
                        )}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1.5" className="relative drop-shadow">
                            <path d="M5 3l14 8-6.5 1.5L10 20z"/>
                        </svg>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="h-full w-full flex flex-col gap-2 px-3 py-3 pointer-events-none select-none overflow-hidden relative font-mono">
            <div className="flex flex-1 min-h-0 items-stretch">
                {renderPane("a", "your app — web")}

                {/* The socket between the two windows */}
                <div className="w-12 shrink-0 flex flex-col items-center justify-center gap-1 relative">
                    <span className="text-[7px] text-surface-500 uppercase tracking-wider">ws</span>
                    <div className="relative w-full h-px bg-surface-800">
                        {(phase === "travel" || phase === "click") && (
                            <span
                                className={`absolute -top-[2px] w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(0,112,244,0.9)] ${event.origin === "a" ? "rt-travel-right" : "rt-travel-left"}`}
                            ></span>
                        )}
                    </div>
                    <span className={`text-[7px] uppercase tracking-wider transition-colors duration-300 ${phase === "travel" ? "text-primary" : "text-surface-500"}`}>
                        {phase === "travel" ? (event.origin === "a" ? "a→b" : "b→a") : "live"}
                    </span>
                </div>

                {renderPane("b", "admin panel")}
            </div>

            {/* Event log, on the card itself — it belongs to neither window */}
            <div className="flex items-center gap-1.5 shrink-0 overflow-hidden">
                {phase === "idle" ? (
                    <span className="text-[8px] text-surface-500 italic truncate">Both clients subscribed to users…</span>
                ) : (
                    <span className="text-[8px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-sm truncate rt-fade">
                        {`UPDATE users SET status='${event.status}' WHERE id=${event.rowId}`}
                    </span>
                )}
                <span className="ml-auto text-[8px] text-surface-500 shrink-0">ws://localhost:3000/realtime</span>
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes rtFade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
                .rt-fade { animation: rtFade 0.25s ease-out both; }
                @keyframes rtPing { 0% { transform: scale(0.4); opacity: 0.9; } 100% { transform: scale(1.6); opacity: 0; } }
                .rt-ping { animation: rtPing 0.5s ease-out forwards; }
                @keyframes rtTravelRight { from { left: 0; opacity: 0; } 20% { opacity: 1; } to { left: 100%; opacity: 0; } }
                @keyframes rtTravelLeft { from { left: 100%; opacity: 0; } 20% { opacity: 1; } to { left: 0; opacity: 0; } }
                .rt-travel-right { animation: rtTravelRight 0.8s ease-in-out infinite; }
                .rt-travel-left { animation: rtTravelLeft 0.8s ease-in-out infinite; }
                @media (prefers-reduced-motion: reduce) {
                    .rt-ping, .rt-travel-right, .rt-travel-left { animation: none; }
                }
            `}} />
        </div>
    );
}
