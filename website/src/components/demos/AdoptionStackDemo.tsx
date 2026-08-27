import React, { useState } from "react";

/**
 * The adoption story as one figure instead of three card grids.
 *
 * A tilted stack of slabs — Postgres, backend, admin panel, Studio. The bottom
 * two are fixed; the top two toggle. Turning a layer on lights the slab and adds
 * its dependencies and capabilities on the right, while the API strip at the
 * bottom never changes. That constant is the whole point of the split.
 */

export interface LayerCopy {
    title: string;
    desc: string;
    tag: string;
}

export interface AdoptionStackDemoProps {
    backend: LayerCopy;
    admin: LayerCopy;
    studio: LayerCopy;
    labels: {
        deps: string;
        capabilities: string;
        alwaysOn: string;
        optional: string;
        apiNote: string;
        unchanged: string;
        hint: string;
    };
}

type Optional = "admin" | "studio";
type Layer = "backend" | Optional;

const CAPABILITIES: { label: string; layer: Layer }[] = [
    { label: "REST, auth, storage and realtime over your Postgres", layer: "backend" },
    { label: "Row-level security enforced by the database", layer: "backend" },
    { label: "A typed SDK generated from your schema", layer: "backend" },
    { label: "A back office your team can edit data in", layer: "admin" },
    { label: "Kanban, media, history, import & export", layer: "admin" },
    { label: "SQL editor, schema visualizer, RLS policy editor", layer: "studio" }
];

const DEPS: { name: string; layer: Layer }[] = [
    { name: "@rebasepro/server", layer: "backend" },
    { name: "@rebasepro/server-postgres", layer: "backend" },
    { name: "@rebasepro/client", layer: "backend" },
    { name: "@rebasepro/cms", layer: "admin" },
    { name: "@rebasepro/cms-types", layer: "admin" },
    { name: "@rebasepro/studio", layer: "studio" }
];

export function AdoptionStackDemo({ backend, admin, studio, labels }: AdoptionStackDemoProps) {
    // Opens with the panel on — the surprising move is switching it *off* and
    // watching the API strip refuse to budge.
    const [on, setOn] = useState<Record<Optional, boolean>>({ admin: true, studio: false });
    const toggle = (key: Optional) => setOn((prev) => ({ ...prev, [key]: !prev[key] }));
    const isOn = (layer: Layer) => layer === "backend" || on[layer];

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-12 items-stretch">

            {/* ── The stack ─────────────────────────────────────────── */}
            <div className="relative flex flex-col justify-center">
                {/* light pooling under the stack */}
                <div className="pointer-events-none absolute -inset-x-16 -inset-y-10 -z-10"
                     aria-hidden="true"
                     style={{ background: "radial-gradient(58% 52% at 50% 48%, rgba(0,112,244,0.14), transparent 72%)" }}/>

                <div className="[perspective:1600px]">
                    <div className="flex flex-col items-center gap-3.5 [transform-style:preserve-3d] [transform:rotateX(12deg)]">
                        <Slab width="w-[74%]" copy={studio} active={on.studio} optional
                              optionalLabel={labels.optional} onClick={() => toggle("studio")}/>
                        <Slab width="w-[87%]" copy={admin} active={on.admin} optional
                              optionalLabel={labels.optional} onClick={() => toggle("admin")}/>
                        <Slab width="w-full" copy={backend} active alwaysLabel={labels.alwaysOn}/>

                        {/* Base plate — your database */}
                        <div className="frame w-full px-6 py-4">
                            <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-2.5 text-base font-semibold text-surface-200">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                         className="text-surface-400">
                                        <ellipse cx="12" cy="5" rx="9" ry="3"/>
                                        <path d="M3 5v14a9 3 0 0 0 18 0V5"/>
                                        <path d="M3 12a9 3 0 0 0 18 0"/>
                                    </svg>
                                    Your Postgres
                                </span>
                                <span className="text-[11px] uppercase tracking-wider text-surface-500">
                                    your instance · your data
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <p className="mt-7 text-center text-sm text-surface-400">{labels.hint}</p>
            </div>

            {/* ── What that costs you ──────────────────────────────── */}
            <div className="frame overflow-hidden">

                <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-800/60 bg-surface-950/50">
                    <span className="font-mono text-[11px] text-surface-500">package.json</span>
                </div>

                <div className="px-6 pt-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-400 mb-3">
                        {labels.deps}
                    </p>
                    <ul className="font-mono text-xs space-y-1.5">
                        {DEPS.map((dep) => {
                            const active = isOn(dep.layer);
                            const added = dep.layer !== "backend";
                            return (
                                <li key={dep.name}
                                    className={`transition-colors duration-300 ${
                                        active
                                            ? added ? "text-emerald-300" : "text-surface-300"
                                            : "text-surface-600/70 line-through decoration-surface-700"
                                    }`}>
                                    <span className={added ? "text-emerald-400" : "text-surface-600"}>
                                        {added ? (active ? "+ " : "  ") : "  "}
                                    </span>
                                    {dep.name}
                                </li>
                            );
                        })}
                    </ul>
                </div>

                <div className="px-6 pt-7">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-400 mb-3">
                        {labels.capabilities}
                    </p>
                    <ul className="space-y-2.5">
                        {CAPABILITIES.map((cap) => {
                            const active = isOn(cap.layer);
                            return (
                                <li key={cap.label} className="flex items-start gap-3">
                                    <span className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full transition-all duration-300 ${
                                        active
                                            ? "bg-primary text-white shadow-[0_0_14px_rgba(0,112,244,0.6)]"
                                            : "bg-white/5 text-transparent ring-1 ring-inset ring-white/10"
                                    }`}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                             strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="m5 12 5 5L20 7"/>
                                        </svg>
                                    </span>
                                    <span className={`text-sm leading-snug transition-colors duration-300 ${
                                        active ? "text-surface-200" : "text-surface-600"
                                    }`}>
                                        {cap.label}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                {/* The constant */}
                <div className="mt-7 border-t border-surface-800/60 bg-surface-950/50 px-6 py-5">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="font-mono text-sm text-surface-200">
                            <span className="text-emerald-400 font-semibold">GET</span> /api/data/users
                        </span>
                        <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                            {labels.unchanged}
                        </span>
                    </div>
                    <p className="text-xs leading-relaxed text-surface-400">{labels.apiNote}</p>
                </div>
            </div>
        </div>
    );
}

interface SlabProps {
    width: string;
    copy: LayerCopy;
    active: boolean;
    optional?: boolean;
    optionalLabel?: string;
    alwaysLabel?: string;
    onClick?: () => void;
}

function Slab({ width, copy, active, optional, optionalLabel, alwaysLabel, onClick }: SlabProps) {
    const Tag = optional ? "button" : "div";

    return (
        <Tag
            {...(optional ? { type: "button" as const, onClick, "aria-pressed": active } : {})}
            className={`${width} group relative block text-left rounded-2xl px-6 py-5 transition-all duration-300 ${
                active
                    ? "border border-primary/40 bg-gradient-to-br from-surface-900/90 to-surface-950/80 shadow-[0_10px_0_-3px_rgba(10,12,18,0.9),0_18px_44px_rgba(0,112,244,0.12)]"
                    : "border border-dashed border-surface-700/80 bg-surface-950/60 translate-y-2 hover:border-surface-600"
            } ${optional ? "cursor-pointer" : ""}`}>

            {/* the same hover pool the rest of the page's cards use */}
            {active && (
                <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-60"
                     aria-hidden="true"
                     style={{ background: "radial-gradient(300px 300px at 50% 0%, rgba(0,112,244,0.15), transparent 80%)" }}/>
            )}
            <div className="relative">

                <div className="flex items-center justify-between gap-4">
                    <span className="flex items-baseline gap-3 min-w-0">
                        <span className={`text-base font-semibold transition-colors duration-300 ${
                            active ? "text-white" : "text-surface-400"
                        }`}>
                            {copy.title}
                        </span>
                        {/* off slabs keep their one-liner so they never read as an empty bar */}
                        {!active && (
                            <span className="truncate text-xs text-surface-600">{copy.tag}</span>
                        )}
                    </span>

                    {optional ? (
                        <span className="flex items-center gap-2.5 flex-none">
                            <span className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors duration-300 ${
                                active
                                    ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20"
                                    : "bg-surface-800/60 text-surface-400 ring-1 ring-inset ring-surface-700/50"
                            }`}>
                                {active ? "on" : optionalLabel}
                            </span>
                            <span className={`relative inline-flex h-4 w-7 rounded-full transition-colors duration-300 ${
                                active ? "bg-primary" : "bg-surface-700"
                            }`}>
                                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-300 ${
                                    active ? "left-3.5" : "left-0.5 opacity-60"
                                }`}/>
                            </span>
                        </span>
                    ) : (
                        <span className="flex-none px-2 py-1 rounded-lg text-[11px] font-medium bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                            {alwaysLabel}
                        </span>
                    )}
                </div>

                {/* The slab grows when the layer is on */}
                <div className={`grid transition-all duration-300 ${
                    active ? "grid-rows-[1fr] opacity-100 mt-2.5" : "grid-rows-[0fr] opacity-0"
                }`}>
                    <div className="overflow-hidden">
                        <p className="text-sm leading-relaxed text-surface-400">{copy.desc}</p>
                        <p className="mt-2.5 text-xs text-surface-500">{copy.tag}</p>
                    </div>
                </div>
            </div>
        </Tag>
    );
}

export default AdoptionStackDemo;
