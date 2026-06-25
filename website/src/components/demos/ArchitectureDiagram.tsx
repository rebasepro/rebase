import React, { useState, type ReactNode } from "react";

/* ─── Tooltip ────────────────────────────────────────────────────────────────── */

function Tip({ children, text }: { children: ReactNode; text: string }) {
    const [show, setShow] = useState(false);
    return (
        <span className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
            {children}
            {show && (
                <span
                    className="absolute z-50 bottom-full left-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-surface-800 text-[10px] text-surface-300 leading-snug shadow-2xl shadow-black/60 max-w-[220px] w-max pointer-events-none"
                    style={{ animation: "archTip 100ms ease-out", transform: "translateX(-50%)" }}
                >
                    {text}
                    <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                        <span className="block w-1.5 h-1.5 rotate-45 bg-[#09090b] border-r border-b border-surface-800" />
                    </span>
                </span>
            )}
        </span>
    );
}

/* ─── Chip with optional accent ──────────────────────────────────────────────── */

function Chip({ children, tip, accent }: { children: ReactNode; tip?: string; accent?: string }) {
    const base = accent
        ? `border-${accent}-500/20 bg-${accent}-500/5 text-${accent}-300 hover:border-${accent}-400/40`
        : "border-surface-800/60 bg-surface-900/50 text-surface-300 hover:border-primary/30 hover:text-white";
    const el = (
        <span className={`inline-flex items-center px-2 py-[3px] rounded border text-[10px] font-medium transition-all duration-150 cursor-default select-none whitespace-nowrap ${base}`}>
            {children}
        </span>
    );
    return tip ? <Tip text={tip}>{el}</Tip> : el;
}

/* ─── Mono code chip with optional accent ────────────────────────────────────── */

function Code({ children, tip, accent }: { children: ReactNode; tip?: string; accent?: string }) {
    const base = accent
        ? `border-${accent}-500/20 bg-${accent}-500/5 text-${accent}-400`
        : "border-surface-800 bg-surface-900 text-surface-400";
    const el = (
        <code className={`inline-flex items-center px-1.5 py-[2px] rounded border text-[9px] font-mono hover:text-surface-200 transition-colors cursor-default select-none whitespace-nowrap ${base}`}>
            {children}
        </code>
    );
    return tip ? <Tip text={tip}>{el}</Tip> : el;
}

/* ─── Mini card ──────────────────────────────────────────────────────────────── */

function MiniCard({ icon, title, desc, className = "" }: {
    icon: ReactNode; title: string; desc: string; className?: string;
}) {
    return (
        <div className={`rounded-lg border border-surface-800/40 bg-[#0f0f11] p-2.5 hover:border-surface-700/60 transition-colors ${className}`}>
            <div className="flex items-start gap-2">
                <div className="shrink-0 mt-0.5">{icon}</div>
                <div className="min-w-0">
                    <div className="text-[11px] font-bold text-white leading-tight">{title}</div>
                    <div className="text-[9px] text-surface-500 leading-snug mt-0.5">{desc}</div>
                </div>
            </div>
        </div>
    );
}

/* ─── Stat ───────────────────────────────────────────────────────────────────── */

function Stat({ value, label }: { value: string; label: string }) {
    return (
        <div className="text-center px-2">
            <div className="text-[13px] font-bold text-white leading-none">{value}</div>
            <div className="text-[8px] text-surface-600 uppercase tracking-wider mt-0.5">{label}</div>
        </div>
    );
}

/* ─── Section label ──────────────────────────────────────────────────────────── */

function Label({ children, color = "text-surface-500" }: { children: ReactNode; color?: string }) {
    return <div className={`text-[9px] font-bold uppercase tracking-[0.1em] mb-1.5 ${color}`}>{children}</div>;
}

/* ─── Connector ──────────────────────────────────────────────────────────────── */

function Conn() {
    return (
        <div className="flex justify-center" aria-hidden="true" style={{ height: 14 }}>
            <div className="w-px h-full bg-gradient-to-b from-surface-700/40 to-surface-800/20" />
        </div>
    );
}

/* ─── Colored icon box ───────────────────────────────────────────────────────── */

function IconBox({ color, children }: { color: string; children: ReactNode }) {
    return (
        <div className={`h-6 w-6 rounded-lg bg-${color}-500/10 border border-${color}-500/20 flex items-center justify-center shrink-0`}>
            {children}
        </div>
    );
}

/* ─── Branded driver card ────────────────────────────────────────────────────── */

function DriverCard({ bgColor, borderColor, iconColor, icon, title, desc }: {
    bgColor: string; borderColor: string; iconColor: string;
    icon: ReactNode; title: string; desc: string;
}) {
    return (
        <div className={`rounded-lg border ${borderColor} bg-[#0f0f11] p-3 flex items-center gap-3 hover:brightness-110 transition-all`}>
            <div className={`h-9 w-9 rounded-lg ${bgColor} flex items-center justify-center shrink-0`}>
                {icon}
            </div>
            <div>
                <div className={`text-[11px] font-bold ${iconColor}`}>{title}</div>
                <div className="text-[9px] text-surface-500 leading-snug">{desc}</div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════════ */

export function ArchitectureDiagram() {
    return (
        <div className="rounded-2xl border border-surface-800 bg-surface-950/80 shadow-2xl overflow-hidden">

            {/* Main grid: stack + CLI sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px]">

                {/* ──── Core Stack ──── */}
                <div className="p-5 sm:p-6 bg-[#09090b] space-y-0">

                    {/* ▸ DATABASE ────────────────────────────────────────── */}
                    <div className="rounded-xl border border-rose-500/10 bg-surface-900/30 p-4">
                        <div className="flex items-center gap-2.5 mb-3">
                            <IconBox color="rose">
                                <svg className="w-3.5 h-3.5 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>
                            </IconBox>
                            <span className="text-xs font-bold text-white">Database Layer</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                            <DriverCard
                                bgColor="bg-[#336791]/15 border border-[#336791]/25"
                                borderColor="border-[#336791]/20"
                                iconColor="text-[#6d9ec4]"
                                title="PostgreSQL"
                                desc="Drizzle ORM · Connection pooling · Direct connections"
                                icon={<img src="/img/postgresql-logo.svg" alt="PostgreSQL" className="h-6 w-auto" />}
                            />
                            <DriverCard
                                bgColor="bg-[#4DB33D]/10 border border-[#4DB33D]/20"
                                borderColor="border-[#4DB33D]/15"
                                iconColor="text-[#6cc75f]"
                                title="MongoDB"
                                desc="v7 document driver"
                                icon={<img src="/img/mongodb-logo.svg" alt="MongoDB" className="h-5 w-auto" />}
                            />
                            <div className="flex flex-wrap gap-1 items-center content-center">
                                <Chip tip="CREATE DATABASE … TEMPLATE for isolated feature branches" accent="rose">Branching</Chip>
                                <Chip tip="Drizzle-based push (dev) and migrate (prod)" accent="rose">Migrations</Chip>
                                <Chip tip="Reverse-engineer existing DB → Rebase collections" accent="rose">Introspection</Chip>
                            </div>
                        </div>
                    </div>

                    <Conn />

                    {/* ▸ BaaS CORE ───────────────────────────────────────── */}
                    <div className="rounded-xl border border-amber-500/10 bg-surface-900/30 p-4">
                        <div className="flex items-center gap-2.5 mb-3">
                            <IconBox color="amber">
                                <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            </IconBox>
                            <span className="text-xs font-bold text-white">BaaS Core</span>
                            <code className="text-[8px] bg-surface-900 border border-surface-800 px-1 py-px rounded text-surface-500 font-mono">server-core</code>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {/* Auth */}
                            <div className="rounded-lg border border-amber-500/10 bg-[#0f0f11] p-3">
                                <Label color="text-amber-500/70">Auth & Security</Label>
                                <div className="space-y-1.5">
                                    <MiniCard
                                        icon={<IconBox color="amber"><svg className="w-3 h-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></IconBox>}
                                        title="Auth Engine"
                                        desc="Email/password, JWT, refresh tokens, rate limiting"
                                        className="!bg-transparent !border-surface-800/20 !p-1.5"
                                    />
                                    <div className="flex flex-wrap gap-1">
                                        <Chip tip="Google, GitHub, Apple, Microsoft, Facebook, Twitter, Discord, LinkedIn, GitLab, Bitbucket, Slack, Spotify" accent="amber">12 OAuth Providers</Chip>
                                        <Chip tip="TOTP multi-factor authentication" accent="amber">MFA</Chip>
                                        <Chip tip="Per-collection CRUD scoping" accent="amber">API Keys</Chip>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        <Code tip="SET LOCAL ROLE + user/role context injection, fail-closed" accent="amber">Row-Level Security</Code>
                                        <Code tip="Role-based access control with default assignment" accent="amber">Roles</Code>
                                    </div>
                                </div>
                            </div>

                            {/* Realtime */}
                            <div className="rounded-lg border border-cyan-500/10 bg-[#0f0f11] p-3">
                                <Label color="text-cyan-500/70">Realtime Engine</Label>
                                <MiniCard
                                    icon={<IconBox color="cyan"><svg className="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg></IconBox>}
                                    title="WebSocket Server"
                                    desc="PostgreSQL LISTEN/NOTIFY powered, auto-reconnect"
                                    className="!bg-transparent !border-surface-800/20 !p-1.5 mb-1.5"
                                />
                                <div className="flex flex-wrap gap-1">
                                    <Chip tip="Typed pub/sub between connected clients" accent="cyan">Broadcast</Chip>
                                    <Chip tip="Per-channel online/offline user state tracking" accent="cyan">Presence</Chip>
                                    <Chip tip="Filtered/sorted/paginated with RLS" accent="cyan">Collection Subs</Chip>
                                    <Chip tip="Individual entity change notifications" accent="cyan">Entity Subs</Chip>
                                </div>
                            </div>

                            {/* Storage */}
                            <div className="rounded-lg border border-emerald-500/10 bg-[#0f0f11] p-3">
                                <Label color="text-emerald-500/70">Storage & Files</Label>
                                <div className="space-y-1.5">
                                    <div className="text-[9px] text-surface-500 leading-snug">
                                        <span className="text-emerald-400/70 font-medium">S3-compatible:</span> AWS, MinIO, R2, Hetzner, DO, B2, GCS
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        <Chip tip="Local filesystem for development" accent="emerald">Local FS</Chip>
                                        <Chip tip="Resumable uploads for large files" accent="emerald">TUS Uploads</Chip>
                                        <Chip tip="Server-side resize/optimize via Sharp" accent="emerald">Image Transforms</Chip>
                                        <Chip tip="Configurable expiration for secure access" accent="emerald">Signed URLs</Chip>
                                    </div>
                                </div>
                            </div>

                            {/* Compute */}
                            <div className="rounded-lg border border-violet-500/10 bg-[#0f0f11] p-3">
                                <Label color="text-violet-500/70">Compute & Services</Label>
                                <div className="space-y-1.5">
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <MiniCard
                                            icon={<IconBox color="violet"><svg className="w-3 h-3 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></IconBox>}
                                            title="Cron Scheduler"
                                            desc="5-field parser, DB logs"
                                            className="!bg-transparent !border-surface-800/20 !p-1.5"
                                        />
                                        <MiniCard
                                            icon={<IconBox color="violet"><svg className="w-3 h-3 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></IconBox>}
                                            title="Custom Functions"
                                            desc="Hono routes, auth + DB"
                                            className="!bg-transparent !border-surface-800/20 !p-1.5"
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        <Chip tip="SMTP, SES, Resend, Postmark + templates" accent="violet">Email</Chip>
                                        <Chip tip="Signed outbound HTTP notifications on entity changes" accent="violet">Webhooks</Chip>
                                        <Chip tip="Versioned audit trail with revert support" accent="violet">History</Chip>
                                        <Chip tip="Postgres tsvector via SDK" accent="violet">Search</Chip>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <Conn />

                    {/* ▸ API LAYER ───────────────────────────────────────── */}
                    <div className="rounded-xl border border-blue-500/10 bg-surface-900/30 p-4">
                        <div className="flex items-center gap-2.5 mb-2.5">
                            <IconBox color="blue">
                                <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
                            </IconBox>
                            <span className="text-xs font-bold text-white">API Layer</span>
                            <span className="text-[9px] text-surface-600 font-mono">auto-generated from schema</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            <MiniCard icon={<IconBox color="blue"><svg className="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg></IconBox>} title="REST" desc="CRUD, filters, sort, pagination, eager-loading" className="!bg-[#0f0f11]" />
                            <MiniCard icon={<IconBox color="blue"><svg className="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></IconBox>} title="GraphQL" desc="Schema + GraphiQL IDE" className="!bg-[#0f0f11]" />
                            <MiniCard icon={<IconBox color="cyan"><svg className="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg></IconBox>} title="WebSocket" desc="Subs, broadcast, presence" className="!bg-[#0f0f11]" />
                            <MiniCard icon={<IconBox color="blue"><svg className="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></IconBox>} title="OpenAPI" desc="3.0 spec + Swagger UI" className="!bg-[#0f0f11]" />
                        </div>
                    </div>

                    <Conn />

                    {/* ▸ TYPED SDK ─────────────────────────────────────────── */}
                    <div className="rounded-xl border border-primary/10 bg-surface-900/30 p-4">
                        <div className="flex items-center gap-2.5 mb-3">
                            <IconBox color="blue">
                                <svg className="w-3.5 h-3.5 text-primary-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                            </IconBox>
                            <span className="text-xs font-bold text-white">Typed SDK</span>
                            <code className="text-[8px] bg-primary/5 border border-primary/15 px-1 py-px rounded text-primary-light font-mono">@rebasepro/client</code>
                            <span className="ml-auto text-[8px] text-surface-600">Browser · Node · Serverless · Edge</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2">
                            <div className="rounded-lg border border-primary/10 bg-[#0f0f11] p-2.5">
                                <Label color="text-primary/50">Generator</Label>
                                <div className="space-y-1">
                                    <Code tip="Generates Row, Insert, Update TS interfaces" accent="blue">database.types.ts</Code>
                                    <div className="text-[8px] text-surface-600 leading-snug">Enums · Relations · Nested maps</div>
                                </div>
                            </div>
                            <div className="rounded-lg border border-primary/10 bg-[#0f0f11] p-2.5">
                                <Label color="text-primary/50">Client Modules</Label>
                                <div className="flex flex-wrap gap-1">
                                    <Code tip="Typed CRUD, auto camelCase ↔ snake_case" accent="blue">rebase.data.*</Code>
                                    <Code tip="signIn, signUp, signOut, onAuthStateChange" accent="blue">rebase.auth.*</Code>
                                    <Code tip="WebSocket subs, auto-reconnect, backoff" accent="blue">rebase.realtime.*</Code>
                                    <Code tip="Upload, download, delete, signed URLs" accent="blue">rebase.storage.*</Code>
                                    <Code tip="Invoke server-side Hono routes" accent="blue">rebase.functions.*</Code>
                                    <Code tip="Manage scheduled tasks" accent="blue">rebase.cron.*</Code>
                                    <Code tip="User management, role assignment" accent="blue">rebase.admin.*</Code>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ──── CLI Sidebar (beside DB → BaaS → API → SDK) ──── */}
                <div className="p-4 bg-[#0c0c0e] border-t lg:border-t-0 lg:border-l border-surface-800/40 flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                        <IconBox color="slate">
                            <svg className="w-3.5 h-3.5 text-surface-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                        </IconBox>
                        <span className="text-xs font-bold text-white">CLI</span>
                    </div>
                    <code className="text-[8px] text-surface-600 font-mono mb-3">@rebasepro/cli</code>
                    <div className="space-y-[3px] flex-1">
                        {([
                            ["init", "Scaffold project"],
                            ["dev", "Dev server + HMR"],
                            ["schema generate", "Collections → Drizzle"],
                            ["schema introspect", "DB → Collections"],
                            ["db push", "Apply (dev)"],
                            ["db migrate", "Migrate (prod)"],
                            ["db branch", "Branch management"],
                            ["generate-sdk", "→ database.types.ts"],
                            ["doctor", "Schema drift check"],
                            ["build", "Production build"],
                            ["start", "Production server"],
                            ["skills install", "AI agent skills"],
                        ] as const).map(([cmd, desc]) => (
                            <div key={cmd} className="flex items-center gap-1.5 px-2 py-[3px] rounded border border-surface-800/30 bg-surface-900/20 hover:border-surface-700/50 hover:bg-surface-900/40 transition-all duration-150 cursor-default group">
                                <span className="text-[8px] font-mono text-primary/40 group-hover:text-primary/70">$</span>
                                <span className="text-[9px] font-mono text-surface-400 group-hover:text-white transition-colors">{cmd}</span>
                                <span className="text-[7px] text-surface-600 ml-auto hidden lg:inline">{desc}</span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-dashed border-surface-800/30">
                        <p className="text-[8px] text-surface-600 leading-relaxed">
                            Orchestrates schema, migrations, SDK codegen, dev server, and production builds.
                        </p>
                    </div>
                </div>
            </div>

            {/* ──── Full-width: Frontend Layer ──── */}
            <div className="p-5 sm:p-6 bg-[#09090b] border-t border-surface-800/40 space-y-0">

                <div className="rounded-xl border border-violet-500/10 bg-surface-900/30 p-4">
                    <div className="flex items-center gap-2.5 mb-3">
                        <IconBox color="violet">
                            <svg className="w-3.5 h-3.5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                        </IconBox>
                        <span className="text-xs font-bold text-white">Frontend Layer</span>
                    </div>

                    {/* Rebase Platform: Studio + Admin */}
                    <div className="rounded-lg border border-surface-800/30 bg-[#0c0c0e] p-2.5 mb-2">
                        <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-surface-500 mb-2">Rebase Platform</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {/* Studio */}
                            <div className="rounded-lg border border-emerald-500/10 bg-[#0f0f11] p-3">
                                <div className="flex items-center gap-1.5 mb-2.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-[10px] font-bold text-emerald-400">Rebase Studio</span>
                                    <span className="text-[8px] text-surface-600 font-mono ml-auto">dev tools</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                    {([
                                        ["SQL Console", "Monaco + EXPLAIN"],
                                        ["JS Console", "Live SDK sandbox"],
                                        ["RLS Editor", "Visual policies"],
                                        ["Schema Viz", "Interactive ERD"],
                                        ["API Explorer", "Test endpoints"],
                                        ["Storage Mgr", "File browser"],
                                        ["Cron Jobs", "Task scheduler"],
                                        ["Logs", "Real-time viewer"],
                                        ["Branches", "DB branching"],
                                    ] as const).map(([title, desc]) => (
                                        <div key={title} className="px-1.5 py-1 rounded border border-emerald-500/8 bg-emerald-500/[0.02] hover:border-emerald-500/20 transition-colors cursor-default">
                                            <div className="text-[9px] font-medium text-emerald-300/80 leading-none">{title}</div>
                                            <div className="text-[7px] text-surface-600 mt-0.5">{desc}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* Admin */}
                            <div className="rounded-lg border border-violet-500/10 bg-[#0f0f11] p-3">
                                <div className="flex items-center gap-1.5 mb-2.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                    <span className="text-[10px] font-bold text-violet-400">Rebase Admin</span>
                                    <span className="text-[8px] text-surface-600 font-mono ml-auto">CMS</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                    {([
                                        ["Collections", "Table · Card · List · Kanban"],
                                        ["Entity Forms", "20+ field bindings"],
                                        ["Rich Text", "Notion-like editor"],
                                        ["Import/Export", "CSV · JSON · Excel"],
                                        ["Schema Editor", "Visual builder"],
                                        ["History", "Timeline + revert"],
                                        ["Side Panels", "Slide-over editing"],
                                        ["Home Builder", "DnD dashboard"],
                                        ["i18n", "7 languages"],
                                    ] as const).map(([title, desc]) => (
                                        <div key={title} className="px-1.5 py-1 rounded border border-violet-500/8 bg-violet-500/[0.02] hover:border-violet-500/20 transition-colors cursor-default">
                                            <div className="text-[9px] font-medium text-violet-300/80 leading-none">{title}</div>
                                            <div className="text-[7px] text-surface-600 mt-0.5">{desc}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* UI Kit */}
                    <div className="rounded-lg border border-primary/10 bg-[#0f0f11] p-3 mb-2">
                        <div className="flex items-center gap-1.5 mb-2">
                            <span className="text-[10px] font-bold text-primary-light">UI Kit</span>
                            <code className="text-[8px] bg-primary/5 border border-primary/15 px-1 py-px rounded text-primary-light/70 font-mono">@rebasepro/ui</code>
                            <div className="ml-auto flex items-center gap-2">
                                <Stat value="55+" label="components" />
                                <Stat value="4" label="views" />
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            <Chip tip="High-performance virtualized table for large datasets" accent="blue">VirtualTable</Chip>
                            <Chip tip="Drag-and-drop columns with sortable lists" accent="blue">Kanban Board</Chip>
                            <Chip tip="Split-pane layouts with draggable dividers" accent="blue">Resizable Panels</Chip>
                            <Chip tip="TextField, Select, MultiSelect, DatePicker, ColorPicker, Slider, FileUpload" accent="blue">Form Controls</Chip>
                            <Chip tip="Modal dialogs, side sheets, popovers, tooltips (Radix UI)" accent="blue">Dialogs & Sheets</Chip>
                            <Chip tip="Cards, Badges, Chips, Avatars, Skeletons, Tabs" accent="blue">Data Display</Chip>
                            <Chip tip="Markdown renderer with syntax highlighting" accent="blue">Markdown</Chip>
                            <Chip tip="Container, Separator, Collapse, ExpandablePanel" accent="blue">Layout</Chip>
                        </div>
                    </div>

                    {/* Your Application */}
                    <div className="rounded-lg border border-surface-800/40 bg-[#0f0f11] p-3 border-dashed">
                        <div className="flex items-center gap-2.5 mb-2">
                            <div className="h-5 w-5 rounded bg-surface-800/40 border border-surface-700/30 flex items-center justify-center">
                                <svg className="w-3 h-3 text-surface-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                            </div>
                            <span className="text-[10px] font-bold text-white">Your Application</span>
                            <span className="text-[8px] text-surface-600">built with the SDK + UI Kit</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {([
                                ["React", "#61DAFB"],
                                ["Next.js", "#ffffff"],
                                ["Remix", "#E8F2FF"],
                                ["Astro", "#FF5D01"],
                                ["Vue", "#4FC08D"],
                                ["Svelte", "#FF3E00"],
                                ["Angular", "#DD0031"],
                                ["Node.js", "#339933"],
                                ["Mobile", "#A4C639"],
                            ] as const).map(([name, color]) => (
                                <div key={name} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-surface-800/40 bg-surface-900/30 hover:border-surface-700/60 transition-colors cursor-default">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, opacity: 0.7 }} />
                                    <span className="text-[10px] font-medium text-surface-300">{name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 border-t border-surface-800/60 bg-surface-900/30">
                <p className="text-center text-[10px] text-surface-500 font-mono">
                    Schema-as-Code · Git-Backed · Hot Reload · Self-Hostable · TypeScript End-to-End · 21 Packages
                </p>
            </div>

            <style>{`@keyframes archTip{from{opacity:0;transform:translateX(-50%) translateY(3px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
        </div>
    );
}
