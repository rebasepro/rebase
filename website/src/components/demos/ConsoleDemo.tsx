import React, { useEffect, useMemo, useState } from "react";
import {
    LayoutGrid, Network, TerminalSquare, ShieldCheck, Folder, Clock, Globe, KeyRound, Users, ScrollText,
    AppWindow, Activity, Rocket, FileText, HeartPulse, Bell, Database, HardDrive, Link2,
    Search, ExternalLink, Plug, Cpu, Archive, Server, Zap, Table2, ChevronDown, ArrowLeft,
} from "lucide-react";

/**
 * The Rebase Cloud project overview, drawn in HTML for the home page (2026-11-23).
 *
 * It follows the real console (saas `frontend/src/views/project`): the
 * Services / Consumers / Infrastructure sidebar, the breadcrumb bar, the stat
 * tiles, the topology card and the activity strip. The content is a sample
 * project with traffic, because an idle canary reads as a dead product. The
 * sidebar is the point: every service is named in one glance.
 */

type IconType = React.ComponentType<{ size?: number | string; className?: string }>;

const NAV: { group?: string; items: { label: string; Icon: IconType }[] }[] = [
    { items: [{ label: "Overview", Icon: LayoutGrid }] },
    {
        group: "Services",
        items: [
            { label: "Schema", Icon: Network },
            { label: "SQL editor", Icon: TerminalSquare },
            { label: "Policies", Icon: ShieldCheck },
            { label: "Files", Icon: Folder },
            { label: "Scheduled jobs", Icon: Clock },
            { label: "API", Icon: Globe },
            { label: "API keys", Icon: KeyRound },
            { label: "Users & roles", Icon: Users },
            { label: "Request logs", Icon: ScrollText },
        ],
    },
    {
        group: "Consumers",
        items: [
            { label: "Apps", Icon: AppWindow },
            { label: "Traffic", Icon: Activity },
        ],
    },
    {
        group: "Infrastructure",
        items: [
            { label: "Deployments", Icon: Rocket },
            { label: "Container logs", Icon: FileText },
            { label: "Health", Icon: HeartPulse },
            { label: "Alerts", Icon: Bell },
            { label: "Database instance", Icon: Database },
            { label: "Storage buckets", Icon: HardDrive },
            { label: "Domains & SSL", Icon: Link2 },
        ],
    },
];

type Range = "60m" | "24h" | "7d";

// Requests per bucket. Two series: everything, and the share that went
// through auth. Hand-shaped so the curve has a believable working day in it.
const SERIES: Record<Range, { all: number[]; auth: number[]; labels: string[] }> = {
    "60m": {
        all: [310, 340, 290, 360, 420, 395, 450, 480, 430, 510, 560, 520, 590, 610, 570, 640],
        auth: [40, 46, 38, 52, 60, 55, 62, 70, 58, 74, 80, 72, 85, 90, 82, 94],
        labels: ["−60m", "−45m", "−30m", "−15m", "now"],
    },
    "24h": {
        all: [180, 140, 120, 110, 130, 210, 380, 620, 840, 910, 870, 960, 1020, 980, 1090, 1150, 1040, 920, 760, 640, 520, 430, 330, 240],
        auth: [20, 16, 14, 12, 15, 30, 60, 110, 150, 160, 140, 170, 180, 165, 190, 200, 175, 150, 120, 95, 80, 60, 45, 30],
        labels: ["00:00", "06:00", "12:00", "18:00", "now"],
    },
    "7d": {
        all: [14200, 15800, 16400, 15100, 17900, 9800, 8700],
        auth: [2100, 2400, 2500, 2300, 2700, 1300, 1100],
        labels: ["Mon", "Wed", "Fri", "Sun"],
    },
};

const COUNTERS: { label: string; Icon: IconType; base: Record<Range, number>; errors: string }[] = [
    { label: "Data", Icon: Database, base: { "60m": 7420, "24h": 148_300, "7d": 961_000 }, errors: "0 errors" },
    { label: "Auth", Icon: KeyRound, base: { "60m": 1060, "24h": 21_400, "7d": 139_000 }, errors: "0 errors" },
    { label: "Storage", Icon: HardDrive, base: { "60m": 880, "24h": 17_900, "7d": 118_000 }, errors: "0 errors" },
    { label: "Functions", Icon: Zap, base: { "60m": 1310, "24h": 26_200, "7d": 171_000 }, errors: "2 errors" },
    { label: "Realtime", Icon: Activity, base: { "60m": 214, "24h": 214, "7d": 214 }, errors: "live sockets" },
];

// The feed under the chart. Every row names the Postgres role it ran as,
// which is the one thing this console shows that a request log usually hides.
const FEED: { method: string; path: string; status: number; ms: number; role: string }[] = [
    { method: "GET", path: "/api/data/orders?status=pending", status: 200, ms: 18, role: "authenticated" },
    { method: "POST", path: "/api/auth/sign-in", status: 200, ms: 64, role: "anon" },
    { method: "PATCH", path: "/api/data/orders/4821", status: 200, ms: 22, role: "authenticated" },
    { method: "PUT", path: "/api/storage/receipts/4821.pdf", status: 201, ms: 91, role: "authenticated" },
    { method: "POST", path: "/api/functions/send-invoice", status: 200, ms: 140, role: "service" },
    { method: "GET", path: "/api/data/customers/77", status: 403, ms: 9, role: "authenticated" },
    { method: "GET", path: "/api/data/products?limit=24", status: 200, ms: 14, role: "anon" },
    { method: "POST", path: "/api/data/orders", status: 201, ms: 27, role: "authenticated" },
];

const fmt = (n: number) =>
    n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString("en-US");

/** A smooth path through the points (Catmull-Rom as cubic Béziers). */
function smoothPath(points: [number, number][]): string {
    if (points.length < 2) return "";
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] ?? points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] ?? p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
    }
    return d;
}

function Chart({ range }: { range: Range }) {
    const W = 640;
    const H = 150;
    const { all, auth, labels } = SERIES[range];
    const max = Math.max(...all) * 1.12;
    const toPoints = (values: number[]): [number, number][] =>
        values.map((v, i) => [(i / (values.length - 1)) * W, H - (v / max) * H]);
    const allPath = smoothPath(toPoints(all));
    const authPath = smoothPath(toPoints(auth));
    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[150px] w-full overflow-visible" aria-hidden="true">
                <defs>
                    <linearGradient id="console-demo-fill" x1="0" x2="0" y1="0" y2="1" className="text-primary-light">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75].map((f) => (
                    <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="stroke-tone-max/[0.06]" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                ))}
                <g className="text-primary-light">
                    <path d={`${allPath} L ${W} ${H} L 0 ${H} Z`} fill="url(#console-demo-fill)" />
                    <path d={allPath} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </g>
                <path d={authPath} fill="none" className="stroke-emerald-400" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-tone-500">
                {labels.map((l) => <span key={l}>{l}</span>)}
            </div>
        </div>
    );
}

export function ConsoleDemo() {
    const [range, setRange] = useState<Range>("24h");
    const [tick, setTick] = useState(0);
    const [feedOffset, setFeedOffset] = useState(0);

    // Live feel: counters creep up and the feed rotates. Off for reduced motion.
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const id = window.setInterval(() => {
            setTick((t) => t + 1);
            setFeedOffset((o) => (o + 1) % FEED.length);
        }, 2200);
        return () => window.clearInterval(id);
    }, []);

    const feed = useMemo(
        () => Array.from({ length: 5 }, (_, i) => FEED[(feedOffset + i) % FEED.length]),
        [feedOffset],
    );

    return (
        <div className="frame overflow-hidden text-left">
            {/* top bar — breadcrumb, actions, search */}
            <div className="flex items-center gap-3 border-b border-hairline bg-surface-well/70 px-4 py-2.5">
                <span className="flex min-w-0 items-center gap-2 text-[13px]">
                    <span className="hidden sm:inline text-tone-400">Bloom</span>
                    <span className="hidden sm:inline text-tone-600">/</span>
                    <span className="font-semibold text-tone-max">bloom-shop</span>
                    <ChevronDown size={13} className="text-tone-500" />
                    <span className="flex items-center gap-1.5 text-tone-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                        Running
                    </span>
                </span>
                <span className="ml-auto hidden md:flex items-center gap-1.5 text-[12px] text-tone-300">
                    <span className="flex items-center gap-1.5 rounded-md px-2 py-1"><ExternalLink size={13} />Open</span>
                    <span className="flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1"><Plug size={13} />Connect</span>
                </span>
                <span className="hidden lg:flex w-56 items-center gap-2 rounded-md border border-hairline bg-surface-sheet px-2.5 py-1 text-[12px] text-tone-500">
                    <Search size={13} className="flex-none" />
                    <span className="truncate">Search…</span>
                    <span className="ml-auto rounded border border-hairline px-1 font-mono text-[10px]">⌘K</span>
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[208px_minmax(0,1fr)]">
                {/* sidebar — the whole product, one glance */}
                <nav className="hidden lg:block border-r border-hairline bg-surface-well/40 px-2.5 py-3 text-[12.5px]">
                    <div className="mb-2 flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-primary-light">
                        <ArrowLeft size={13} />All projects
                    </div>
                    {NAV.map((section, si) => (
                        <div key={si} className={section.group ? "mt-3" : ""}>
                            {section.group && (
                                <p className="mb-1 flex items-center gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-tone-500">
                                    <ChevronDown size={11} />{section.group}
                                </p>
                            )}
                            {section.items.map(({ label, Icon }) => {
                                const on = label === "Overview";
                                return (
                                    <div
                                        key={label}
                                        className={`flex items-center gap-2.5 rounded-md px-2.5 py-[5px] ${on ? "bg-surface-active text-tone-max" : "text-tone-300"}`}
                                    >
                                        <Icon size={14} className={on ? "text-primary-light" : "text-tone-500"} />
                                        {label}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </nav>

                {/* overview */}
                <div className="min-w-0 p-5 sm:p-7">
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-6">
                        <div className="min-w-0">
                            {/* Not a heading: the demo sits between the hero h1 and the first h2. */}
                            <p className="font-headers text-2xl sm:text-3xl text-tone-max">bloom-shop</p>
                            <p className="mt-2 flex items-center gap-2 text-[12.5px] text-tone-400">
                                Admin panel <span className="font-mono text-tone-200">bloom-shop.rebase.website</span>
                            </p>
                            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
                                {[
                                    { k: "Status", v: "Running", s: "", Icon: Activity, dot: true },
                                    { k: "Compute", v: "1 vCPU · 2 GB", s: "2 instances", Icon: Cpu },
                                    { k: "Last deploy", v: "4 min ago", s: "main · a41c9e2", Icon: Rocket },
                                    { k: "Last backup", v: "2 h ago", s: "Point-in-time on", Icon: Archive },
                                ].map(({ k, v, s, Icon, dot }) => (
                                    <div key={k} className="flex items-start gap-3">
                                        <span className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-hairline bg-surface-sheet text-tone-400">
                                            <Icon size={16} />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-tone-500">{k}</span>
                                            <span className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold text-tone-max">
                                                {dot && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />}
                                                {v}
                                            </span>
                                            {s && <span className="block text-[11px] text-tone-400">{s}</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* topology */}
                        <div className="rounded-xl border border-hairline bg-[radial-gradient(circle,rgb(255_255_255/0.05)_1px,transparent_1px)] [background-size:14px_14px] p-4">
                            <div className="flex justify-center">
                                <span className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface-sheet px-3 py-1 font-mono text-[11px] text-tone-300">
                                    <Globe size={12} />api.bloom.shop
                                </span>
                            </div>
                            <div className="mx-auto h-4 w-px bg-tone-max/15" />
                            <div className="rounded-lg border border-hairline bg-surface-sheet">
                                <div className="flex items-center gap-3 px-3.5 py-3">
                                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-400/10 text-emerald-400"><Server size={16} /></span>
                                    <span className="min-w-0">
                                        <span className="block text-[13px] font-semibold text-tone-max">Backend service</span>
                                        <span className="block font-mono text-[10.5px] text-tone-500">eu-central · Falkenstein</span>
                                    </span>
                                    <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-tone-300">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />Running
                                    </span>
                                </div>
                                <div className="flex items-center gap-4 border-t border-hairline px-3.5 py-2 font-mono text-[10.5px] text-tone-400">
                                    <span>CPU {18 + (tick % 5)}%</span><span>RAM 41%</span><span>0 restarts</span>
                                    <span className="ml-auto text-emerald-400/90">RLS on 23/23 tables</span>
                                </div>
                            </div>
                            <div className="mt-2.5 grid grid-cols-3 gap-2 text-[12px] text-tone-200">
                                <span className="flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-sheet/80 px-2.5 py-2"><Table2 size={13} className="text-tone-500" />23 tables</span>
                                <span className="flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-sheet/80 px-2.5 py-2"><Zap size={13} className="text-tone-500" />12 functions</span>
                                <span className="flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-sheet/80 px-2.5 py-2"><Clock size={13} className="text-tone-500" />4 cron jobs</span>
                            </div>
                        </div>
                    </div>

                    {/* activity */}
                    <div className="mt-7 flex flex-wrap items-center gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-tone-500">Activity</span>
                        <span className="flex items-center gap-3 text-[11px] text-tone-400">
                            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary-light" />All requests</span>
                            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Auth</span>
                        </span>
                        <span className="ml-auto flex rounded-md border border-hairline bg-surface-sheet p-0.5 text-[11px]">
                            {(["60m", "24h", "7d"] as Range[]).map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => setRange(r)}
                                    aria-pressed={range === r}
                                    className={`cursor-pointer rounded px-2.5 py-1 transition-colors ${range === r ? "bg-surface-active text-tone-max" : "text-tone-400 hover:text-tone-200"}`}
                                >
                                    {r === "60m" ? "60 min" : r === "24h" ? "24 h" : "7 d"}
                                </button>
                            ))}
                        </span>
                    </div>

                    <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6">
                        <Chart range={range} />
                        <div className="min-w-0 rounded-lg border border-hairline bg-surface-well/60">
                            <div className="flex items-center justify-between border-b border-hairline px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-tone-500">
                                <span>Request logs</span><span className="normal-case tracking-normal">ran as</span>
                            </div>
                            <ul className="divide-y divide-tone-max/[0.05] font-mono text-[10.5px]">
                                {feed.map((r, i) => (
                                    <li key={`${feedOffset}-${i}`} className={`flex items-center gap-2 px-3 py-[7px] ${i === 0 ? "animate-[console-demo-in_400ms_ease-out]" : ""}`}>
                                        <span className={`w-11 flex-none ${r.method === "GET" ? "text-tone-400" : "text-cyan-300"}`}>{r.method}</span>
                                        <span className="min-w-0 flex-1 truncate text-tone-200">{r.path}</span>
                                        <span className={`flex-none ${r.status >= 400 ? "text-amber-300" : "text-emerald-400"}`}>{r.status}</span>
                                        <span className="w-10 flex-none text-right text-tone-500">{r.ms}ms</span>
                                        <span className="hidden sm:inline w-[86px] flex-none text-right text-tone-400">{r.role}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
                        {COUNTERS.map(({ label, Icon, base, errors }) => (
                            <div key={label} className="rounded-lg border border-hairline bg-surface-sheet/70 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-tone-400"><Icon size={12} />{label}</span>
                                    <span className={`text-[10px] ${errors.startsWith("0") || errors === "live sockets" ? "text-tone-500" : "text-amber-300/90"}`}>{errors}</span>
                                </div>
                                <p className="mt-1.5 text-lg font-semibold tabular-nums text-tone-max">
                                    {fmt(base[range] + (label === "Realtime" ? (tick % 7) - 3 : tick * (label === "Data" ? 7 : 2)))}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <style>{`@keyframes console-demo-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }`}</style>
        </div>
    );
}

export default ConsoleDemo;
