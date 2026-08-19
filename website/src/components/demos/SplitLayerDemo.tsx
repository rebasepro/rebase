import React, { useState } from "react";

/**
 * The BaaS / admin-panel split, made touchable.
 *
 * Toggle the admin layer on and off: the project grows one dependency and one
 * nested block, the admin panel appears — and the API response on the right
 * never moves. That last part is the whole argument.
 */

type Mode = "backend" | "full";

const BACKEND_DEPS = [
    "@rebasepro/server",
    "@rebasepro/server-postgres",
    "@rebasepro/client"
];

const ADMIN_DEPS = [
    "@rebasepro/admin",
    "@rebasepro/admin-types"
];

export function SplitLayerDemo() {
    const [mode, setMode] = useState<Mode>("backend");
    const full = mode === "full";

    return (
        <div className="frame w-full overflow-hidden">

            {/* Segmented control */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-5 py-4 border-b border-surface-800/80 bg-surface-900/50">
                <div className="inline-flex rounded-lg bg-surface-950/80 p-1 ring-1 ring-surface-800 self-start">
                    <button
                        type="button"
                        onClick={() => setMode("backend")}
                        aria-pressed={!full}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                            !full ? "bg-primary text-white" : "text-surface-400 hover:text-white"
                        }`}>
                        Backend only
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode("full")}
                        aria-pressed={full}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                            full ? "bg-primary text-white" : "text-surface-400 hover:text-white"
                        }`}>
                        Backend + admin panel
                    </button>
                </div>
                <p className="text-xs text-surface-500">
                    {full
                        ? "One dependency and one nested block added. The API below is untouched."
                        : "A headless project: no React, no admin block, no panel."}
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-surface-800/60">

                {/* 1 — the project */}
                <div className="p-4 sm:p-5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-3">
                        Your project
                    </p>

                    <div className="font-mono text-[11px] leading-relaxed text-surface-400 mb-4">
                        <div>config/</div>
                        <div className="pl-3">collections/users.ts</div>
                        {full && <div className="pl-3 text-emerald-400">admin.d.ts</div>}
                    </div>

                    <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">
                        Dependencies
                    </p>
                    <ul className="space-y-1 font-mono text-[11px]">
                        {BACKEND_DEPS.map((dep) => (
                            <li key={dep} className="text-surface-400">{dep}</li>
                        ))}
                        {full && ADMIN_DEPS.map((dep) => (
                            <li key={dep} className="text-emerald-400">+ {dep}</li>
                        ))}
                    </ul>

                    <p className="mt-4 text-[11px] leading-relaxed text-surface-500">
                        {full
                            ? "The reference in admin.d.ts is what makes an `admin` block legal anywhere in the project."
                            : "Without admin.d.ts, an `admin` key on a collection is a type error."}
                    </p>
                </div>

                {/* 2 — the collection file */}
                <div className="p-4 sm:p-5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-3">
                        config/collections/users.ts
                    </p>

                    <pre className="font-mono text-[11px] leading-relaxed text-surface-300 overflow-x-auto"><code>{`export const users = {
  name: "Users",
  table: "users",
  properties: {
    email: { type: "string" },
    displayName: { type: "string" },
  },
  securityRules: [
    { operation: "select",
      using: "id = rebase.uid()::uuid" },
  ],`}</code></pre>

                    <div className={`transition-all duration-300 ${full ? "opacity-100 mt-1" : "opacity-30"}`}>
                        <pre className={`font-mono text-[11px] leading-relaxed overflow-x-auto rounded-r-lg border-l-2 pl-3 py-1 transition-colors duration-300 ${
                            full
                                ? "border-emerald-400/60 bg-emerald-400/[0.04] text-surface-300"
                                : "border-surface-700 text-surface-600 line-through decoration-surface-600/60"
                        }`}><code>{`  admin: {
    icon: "Users",
    group: "Settings",
    listProperties: ["displayName", "email"],
  },`}</code></pre>
                    </div>

                    <pre className="font-mono text-[11px] leading-relaxed text-surface-300">{`};`}</pre>

                    <p className="mt-4 text-[11px] leading-relaxed text-surface-500">
                        The server loads this file either way — and never reads inside <code className="font-mono">admin</code>.
                    </p>
                </div>

                {/* 3 — what actually runs */}
                <div className="p-4 sm:p-5 space-y-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                                Your API
                            </p>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20">
                                identical
                            </span>
                        </div>
                        <div className="rounded-lg bg-surface-950 ring-1 ring-surface-800/60 p-3 font-mono text-[10px] leading-relaxed">
                            <div className="text-surface-400">
                                <span className="text-emerald-400">GET</span> /api/data/users
                            </div>
                            <div className="mt-1 text-surface-500">200 OK · application/json</div>
                            <pre className="mt-2 text-surface-300">{`[{ "id": "9f2…", "email": "ada@…",
   "displayName": "Ada" }]`}</pre>
                        </div>
                    </div>

                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">
                            Admin panel
                        </p>

                        {full ? (
                            <div className="rounded-lg bg-surface-950 ring-1 ring-surface-800/60 overflow-hidden">
                                <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-surface-800/60">
                                    <span className="h-2 w-2 rounded-full bg-primary"/>
                                    <span className="text-[10px] text-surface-400">Users</span>
                                </div>
                                <div className="grid grid-cols-2 text-[10px]">
                                    <div className="px-2.5 py-1.5 text-surface-500 border-b border-surface-800/40">Name</div>
                                    <div className="px-2.5 py-1.5 text-surface-500 border-b border-surface-800/40">Email</div>
                                    <div className="px-2.5 py-1.5 text-surface-300 border-b border-surface-800/20">Ada</div>
                                    <div className="px-2.5 py-1.5 text-surface-300 border-b border-surface-800/20 truncate">ada@…</div>
                                    <div className="px-2.5 py-1.5 text-surface-300">Grace</div>
                                    <div className="px-2.5 py-1.5 text-surface-300 truncate">grace@…</div>
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-lg border border-dashed border-surface-800 p-4 text-center">
                                <p className="text-[11px] text-surface-500">Not installed.</p>
                                <p className="mt-1 text-[10px] text-surface-600">Nothing is served, nothing is bundled.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="px-4 sm:px-5 py-3 border-t border-surface-800/80 bg-surface-900/40">
                <p className="text-xs text-surface-400">
                    The only thing that changed is what a human can see.
                </p>
            </div>
        </div>
    );
}

export default SplitLayerDemo;
