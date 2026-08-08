import React, { useState, type ReactNode } from "react";

/* ─── Tooltip ────────────────────────────────────────────────────────────────── */

function Tip({ children, text }: { children: ReactNode; text: string }) {
    const [show, setShow] = useState(false);
    return (
        <span className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
            {children}
            {show && (
                <span
                    className="absolute z-50 bottom-full left-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-surface-800 text-[11px] text-surface-300 leading-snug shadow-2xl shadow-black/60 max-w-[240px] w-max pointer-events-none"
                    style={{ animation: "archTip 120ms ease-out", transform: "translateX(-50%)" }}
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

/* ─── Tag — subtle colored border, matching the site's pill style ────────────── */

function Tag({ children, tip, color }: { children: ReactNode; tip?: string; color?: string }) {
    const c = color ?? "surface";
    const base = c === "surface"
        ? "border-surface-800/60 bg-surface-900/40 text-surface-300 hover:border-surface-700 hover:text-white"
        : `border-${c}-500/20 bg-${c}-500/5 text-${c}-300/90 hover:border-${c}-500/40 hover:text-${c}-200`;
    const el = (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all duration-150 cursor-default select-none whitespace-nowrap ${base}`}>
            {children}
        </span>
    );
    return tip ? <Tip text={tip}>{el}</Tip> : el;
}

/* ─── Mono code tag ──────────────────────────────────────────────────────────── */

function Mono({ children, tip }: { children: ReactNode; tip?: string }) {
    const el = (
        <code className="inline-flex items-center px-2 py-0.5 rounded-md border border-blue-500/20 bg-blue-500/5 text-[10.5px] font-mono text-blue-300/80 hover:text-blue-200 hover:border-blue-500/35 transition-all duration-150 cursor-default select-none whitespace-nowrap">
            {children}
        </code>
    );
    return tip ? <Tip text={tip}>{el}</Tip> : el;
}

/* ─── Section label ──────────────────────────────────────────────────────────── */

function Label({ children, color = "text-surface-500" }: { children: ReactNode; color?: string }) {
    return <div className={`text-[10px] font-semibold uppercase tracking-[0.1em] mb-2 ${color}`}>{children}</div>;
}

/* ─── Connector ──────────────────────────────────────────────────────────────── */

function Conn() {
    return (
        <div className="flex justify-center" aria-hidden="true" style={{ height: 14 }}>
            <div className="w-px h-full bg-gradient-to-b from-surface-700/40 to-surface-800/20" />
        </div>
    );
}

/* ─── Stat ───────────────────────────────────────────────────────────────────── */

function Stat({ value, label }: { value: string; label: string }) {
    return (
        <div className="text-center px-2">
            <div className="text-sm font-semibold text-white leading-none">{value}</div>
            <div className="text-[9px] text-surface-600 uppercase tracking-wider mt-0.5">{label}</div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════════ */

export function ArchitectureDiagram() {
    return (
        <div className="rounded-2xl border border-surface-800 bg-surface-950/80 shadow-2xl overflow-hidden">

            {/* Main grid: core stack + CLI sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px]">

                {/* ──── Core Stack ──── */}
                <div className="p-5 sm:p-6 space-y-0">

                    {/* ▸ DATABASE ────────────────────────────────────────── */}
                    <div className="rounded-xl border border-surface-800/60 bg-surface-900/20 p-4">
                        <div className="flex items-center gap-2.5 mb-3">
                            <div className="h-7 w-7 rounded-lg bg-surface-800/50 border border-surface-700/40 flex items-center justify-center">
                                <svg className="w-4 h-4 text-surface-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>
                            </div>
                            <span className="text-sm font-semibold text-white">Database Layer</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2.5">
                            {/* PostgreSQL */}
                            <div className="rounded-lg border border-[#336791]/20 bg-[#0f0f11] p-3 flex items-center gap-3 hover:border-[#336791]/35 transition-colors">
                                <div className="h-10 w-10 rounded-lg bg-[#336791]/10 border border-[#336791]/20 flex items-center justify-center shrink-0">
                                    <img src="/img/postgresql-logo.svg" width="432" height="445" alt="PostgreSQL" className="h-6 w-auto" />
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-white">PostgreSQL</div>
                                    <div className="text-[11px] text-surface-500 leading-snug">Drizzle ORM · Pooling · Read replicas</div>
                                </div>
                            </div>
                            {/* MongoDB */}
                            <div className="rounded-lg border border-[#4DB33D]/15 bg-[#0f0f11] p-3 flex items-center gap-3 hover:border-[#4DB33D]/30 transition-colors">
                                <div className="h-10 w-10 rounded-lg bg-[#4DB33D]/8 border border-[#4DB33D]/15 flex items-center justify-center shrink-0">
                                    <img src="/img/mongodb-logo.svg" width="24" height="24" alt="MongoDB" className="h-6 w-auto" />
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-white">MongoDB</div>
                                    <div className="text-[11px] text-surface-500 leading-snug">v7 document driver</div>
                                </div>
                            </div>
                            {/* DB capabilities */}
                            <div className="flex flex-wrap gap-1.5 items-center content-center">
                                <Tag tip="CREATE DATABASE … TEMPLATE for isolated feature branches">Branching</Tag>
                                <Tag tip="Drizzle-based push (dev) and generate (prod)">Migrations</Tag>
                                <Tag tip="Reverse-engineer existing DB → Rebase collections">Introspection</Tag>
                            </div>
                        </div>
                    </div>

                    <Conn />

                    {/* ▸ BaaS CORE ───────────────────────────────────────── */}
                    <div className="rounded-xl border border-amber-500/10 bg-surface-900/20 p-4">
                        <div className="flex items-center gap-2.5 mb-3">
                            <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                                <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            </div>
                            <span className="text-sm font-semibold text-white">BaaS Core</span>
                            <code className="text-[10px] bg-surface-900/60 border border-surface-800/60 px-1.5 py-0.5 rounded text-surface-500 font-mono">server</code>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {/* Auth */}
                            <div className="rounded-lg border border-amber-500/10 bg-[#0f0f11] p-3.5">
                                <Label color="text-amber-500/60">Auth & Security</Label>
                                <div className="space-y-2">
                                    <div className="text-[11px] text-surface-400 leading-snug">
                                        Email/password · JWT · Refresh tokens · Rate limiting
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <Tag tip="Google, GitHub, Apple, Microsoft, Facebook, Twitter, Discord, LinkedIn, GitLab, Bitbucket, Slack, Spotify" color="amber">12 OAuth Providers</Tag>
                                        <Tag tip="TOTP multi-factor authentication with recovery codes" color="amber">MFA</Tag>
                                        <Tag tip="Per-collection CRUD scoping with expiration" color="amber">API Keys</Tag>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <Mono tip="SET LOCAL ROLE + user/role context injection, fail-closed design">Row-Level Security</Mono>
                                        <Mono tip="Role-based access control with default role assignment">Roles</Mono>
                                        <Mono tip="onBeforeSignIn, onAfterSignUp — custom auth pipeline hooks">Lifecycle Hooks</Mono>
                                    </div>
                                </div>
                            </div>

                            {/* Realtime */}
                            <div className="rounded-lg border border-cyan-500/10 bg-[#0f0f11] p-3.5">
                                <Label color="text-cyan-500/60">Realtime Engine</Label>
                                <div className="space-y-2">
                                    <div className="text-[11px] text-surface-400 leading-snug">
                                        WebSocket server · PostgreSQL LISTEN/NOTIFY · Auto-reconnect
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <Tag tip="Typed pub/sub between connected clients" color="cyan">Broadcast</Tag>
                                        <Tag tip="Per-channel online/offline user state tracking" color="cyan">Presence</Tag>
                                        <Tag tip="Filtered/sorted/paginated with RLS enforcement" color="cyan">Collection Subs</Tag>
                                        <Tag tip="Individual entity change notifications" color="cyan">Entity Subs</Tag>
                                    </div>
                                </div>
                            </div>

                            {/* Storage */}
                            <div className="rounded-lg border border-emerald-500/10 bg-[#0f0f11] p-3.5">
                                <Label color="text-emerald-500/60">Storage & Files</Label>
                                <div className="space-y-2">
                                    <div className="text-[11px] text-surface-400 leading-snug">
                                        <span className="text-emerald-400/60 font-medium">S3-compatible:</span> AWS, MinIO, R2, Hetzner, DO, B2, GCS
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <Tag tip="Local filesystem for development" color="emerald">Local FS</Tag>
                                        <Tag tip="Resumable uploads for large files (tus.io protocol)" color="emerald">TUS Uploads</Tag>
                                        <Tag tip="Server-side resize/optimize via Sharp" color="emerald">Image Transforms</Tag>
                                        <Tag tip="Configurable expiration for secure access" color="emerald">Signed URLs</Tag>
                                        <Tag tip="Built-in file browser and media library UI" color="emerald">Media Manager</Tag>
                                    </div>
                                </div>
                            </div>

                            {/* Compute */}
                            <div className="rounded-lg border border-violet-500/10 bg-[#0f0f11] p-3.5">
                                <Label color="text-violet-500/60">Compute & Services</Label>
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-surface-800/40 bg-surface-900/20">
                                            <svg className="w-3.5 h-3.5 text-violet-400/60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                            <div>
                                                <div className="text-[11px] font-semibold text-surface-300">Cron Scheduler</div>
                                                <div className="text-[10px] text-surface-600">5-field parser, DB logs</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-surface-800/40 bg-surface-900/20">
                                            <svg className="w-3.5 h-3.5 text-violet-400/60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                                            <div>
                                                <div className="text-[11px] font-semibold text-surface-300">Custom Functions</div>
                                                <div className="text-[10px] text-surface-600">Hono routes, auth + DB</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <Tag tip="SMTP, SES, Resend, Postmark — templates + transactional" color="violet">Email</Tag>
                                        <Tag tip="Signed outbound HTTP on entity INSERT/UPDATE/DELETE" color="violet">Webhooks</Tag>
                                        <Tag tip="Versioned audit trail with programmatic revert" color="violet">History</Tag>
                                        <Tag tip="Postgres tsvector full-text search via SDK" color="violet">Search</Tag>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <Conn />

                    {/* ▸ API LAYER ───────────────────────────────────────── */}
                    <div className="rounded-xl border border-blue-500/10 bg-surface-900/20 p-4">
                        <div className="flex items-center gap-2.5 mb-2.5">
                            <div className="h-7 w-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
                            </div>
                            <span className="text-sm font-semibold text-white">API Layer</span>
                            <span className="text-[10px] text-surface-600 font-mono">auto-generated from schema</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {([
                                ["REST", "CRUD, filters, sort, pagination, eager-loading"],
                                ["WebSocket", "Subs, broadcast, presence"],
                                ["OpenAPI", "3.0 spec + Swagger UI"],
                            ] as const).map(([title, desc]) => (
                                <div key={title} className="rounded-lg border border-surface-800/40 bg-[#0f0f11] p-3 hover:border-blue-500/20 transition-colors">
                                    <div className="text-xs font-semibold text-white leading-tight">{title}</div>
                                    <div className="text-[10px] text-surface-500 leading-snug mt-0.5">{desc}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <Conn />

                    {/* ▸ TYPED SDK ─────────────────────────────────────────── */}
                    <div className="rounded-xl border border-blue-500/10 bg-blue-500/[0.02] p-4">
                        <div className="flex items-center gap-2.5 mb-3">
                            <div className="h-7 w-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                            </div>
                            <span className="text-sm font-semibold text-white">Typed SDK</span>
                            <code className="text-[10px] bg-blue-500/5 border border-blue-500/15 px-1.5 py-0.5 rounded text-blue-300/70 font-mono">@rebasepro/client</code>
                            <span className="ml-auto text-[10px] text-surface-600">Browser · Node · Serverless · Edge</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-2.5">
                            <div className="rounded-lg border border-blue-500/10 bg-[#0f0f11] p-3">
                                <Label color="text-blue-500/50">Generator</Label>
                                <div className="space-y-1.5">
                                    <Mono tip="Generates Row, Insert, Update TS interfaces per collection">database.types.ts</Mono>
                                    <div className="text-[10px] text-surface-600 leading-snug">Enums · Relations · Nested maps</div>
                                </div>
                            </div>
                            <div className="rounded-lg border border-blue-500/10 bg-[#0f0f11] p-3">
                                <Label color="text-blue-500/50">Client Modules</Label>
                                <div className="flex flex-wrap gap-1.5">
                                    <Mono tip="Typed CRUD: find, findOne, insert, update, delete with auto camelCase ↔ snake_case">rebase.data.*</Mono>
                                    <Mono tip="signIn, signUp, signOut, onAuthStateChange, getSession">rebase.auth.*</Mono>
                                    <Mono tip="WebSocket subscriptions with auto-reconnect and exponential backoff">rebase.realtime.*</Mono>
                                    <Mono tip="Upload, download, delete, getSignedUrl">rebase.storage.*</Mono>
                                    <Mono tip="Invoke server-side Hono custom functions">rebase.functions.*</Mono>
                                    <Mono tip="Schedule, list, trigger, toggle cron jobs">rebase.cron.*</Mono>
                                    <Mono tip="Send transactional emails, manage templates">rebase.email.*</Mono>
                                    <Mono tip="User management, role assignment, impersonation">rebase.admin.*</Mono>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ──── CLI Sidebar ──── */}
                <div className="p-4 bg-[#0c0c0e] border-t lg:border-t-0 lg:border-l border-surface-800/40 flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-1">
                        <div className="h-6 w-6 rounded-lg bg-surface-800/50 border border-surface-700/30 flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-surface-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                        </div>
                        <span className="text-xs font-semibold text-white">CLI</span>
                    </div>
                    <code className="text-[9px] text-surface-600 font-mono mb-3">@rebasepro/cli</code>
                    <div className="flex-1 font-mono text-[10px] leading-[22px] text-surface-400">
                        {([
                            "init",
                            "dev",
                            "schema generate",
                            "schema introspect",
                            "db push",
                            "db migrate",
                            "db branch create",
                            "generate-sdk",
                            "doctor",
                            "build",
                            "start",
                            "deploy",
                            "skills install",
                        ] as const).map((cmd) => (
                            <div key={cmd} className="whitespace-nowrap hover:text-white transition-colors cursor-default">
                                <span className="text-primary/40">$ </span>{cmd}
                            </div>
                        ))}
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-dashed border-surface-800/30">
                        <p className="text-[9px] text-surface-600 leading-relaxed">
                            Orchestrates schema, migrations, SDK codegen, dev server, and builds.
                        </p>
                    </div>
                </div>
            </div>

            {/* ──── Full-width: Frontend Layer ──── */}
            <div className="p-5 sm:p-6 border-t border-surface-800/40">

                <div className="rounded-xl border border-violet-500/10 bg-surface-900/20 p-4">
                    <div className="flex items-center gap-2.5 mb-3">
                        <div className="h-7 w-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                            <svg className="w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                        </div>
                        <span className="text-sm font-semibold text-white">Frontend Layer</span>
                    </div>

                    {/* Rebase Platform + Your Application */}
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-2.5 mb-2.5">

                    {/* Rebase Platform: Studio + Admin */}
                    <div className="rounded-lg border border-surface-800/30 bg-[#0c0c0e] p-3">
                        <div className="flex items-center gap-2 mb-2.5">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-surface-500">Rebase Platform</span>
                            <div className="flex-1 h-px bg-surface-800/30" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {/* Studio */}
                            <div className="rounded-lg border border-emerald-500/10 bg-[#0f0f11] p-3.5">
                                <div className="flex items-center gap-1.5 mb-2.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    <span className="text-xs font-semibold text-emerald-400">Rebase Studio</span>
                                    <span className="text-[9px] text-surface-600 font-mono ml-auto">dev tools</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {([
                                        ["SQL Console", "Monaco + EXPLAIN"],
                                        ["JS Runner", "Live SDK sandbox"],
                                        ["RLS Editor", "Visual policies"],
                                        ["Schema Viz", "Interactive ERD"],
                                        ["API Explorer", "Test endpoints"],
                                        ["Storage Mgr", "File browser"],
                                        ["Cron Jobs", "Task scheduler"],
                                        ["Logs", "Real-time viewer"],
                                        ["Branches", "DB branching"],
                                    ] as const).map(([title, desc]) => (
                                        <div key={title} className="px-2 py-1.5 rounded border border-emerald-500/8 bg-emerald-500/[0.02] hover:border-emerald-500/20 transition-colors cursor-default">
                                            <div className="text-[10px] font-medium text-emerald-300/80 leading-none">{title}</div>
                                            <div className="text-[9px] text-surface-600 mt-0.5">{desc}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* Admin */}
                            <div className="rounded-lg border border-violet-500/10 bg-[#0f0f11] p-3.5">
                                <div className="flex items-center gap-1.5 mb-2.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                    <span className="text-xs font-semibold text-violet-400">Rebase Admin</span>
                                    <span className="text-[9px] text-surface-600 font-mono ml-auto">CMS</span>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {([
                                        ["Collections", "Table · Card · List · Kanban"],
                                        ["Entity Forms", "20+ field bindings"],
                                        ["Rich Text", "Notion-like editor"],
                                        ["Import/Export", "CSV · JSON · Excel"],
                                        ["Custom Views", "Your React pages"],
                                        ["History", "Timeline + revert"],
                                        ["Side Panels", "Slide-over editing"],
                                        ["Home Builder", "DnD dashboard"],
                                        ["i18n", "7 languages"],
                                    ] as const).map(([title, desc]) => (
                                        <div key={title} className="px-2 py-1.5 rounded border border-violet-500/8 bg-violet-500/[0.02] hover:border-violet-500/20 transition-colors cursor-default">
                                            <div className="text-[10px] font-medium text-violet-300/80 leading-none">{title}</div>
                                            <div className="text-[9px] text-surface-600 mt-0.5">{desc}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Your Application */}
                    <div className="rounded-lg border border-dashed border-surface-800/40 bg-surface-900/10 p-3.5 flex flex-col">
                        <div className="flex items-center gap-2.5 mb-2.5">
                            <div className="h-6 w-6 rounded-lg bg-surface-800/40 border border-surface-700/30 flex items-center justify-center">
                                <svg className="w-3.5 h-3.5 text-surface-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                            </div>
                            <span className="text-xs font-semibold text-white">Your Application</span>
                        </div>
                        <div className="text-[10px] text-surface-600 mb-2.5">built with the SDK + UI Kit</div>
                        <div className="grid grid-cols-2 gap-1.5 flex-1 content-start">
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
                                <div key={name} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-surface-800/40 bg-[#0f0f11] hover:border-surface-700/60 transition-colors cursor-default">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, opacity: 0.6 }} />
                                    <span className="text-[10px] font-medium text-surface-300">{name}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    </div>

                    {/* UI Kit */}
                    <div className="rounded-lg border border-surface-800/40 bg-[#0f0f11] p-3.5 mb-2.5">
                        <div className="flex items-center gap-2 mb-2.5">
                            <span className="text-xs font-semibold text-primary-light">UI Kit</span>
                            <code className="text-[10px] bg-primary/5 border border-primary/15 px-1.5 py-0.5 rounded text-primary-light/70 font-mono">@rebasepro/ui</code>
                            <div className="ml-auto flex items-center gap-2">
                                <Stat value="55+" label="components" />
                                <Stat value="4" label="views" />
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <Tag tip="High-performance virtualized table for large datasets" color="blue">VirtualTable</Tag>
                            <Tag tip="Drag-and-drop columns with sortable lists" color="blue">Kanban Board</Tag>
                            <Tag tip="Split-pane layouts with draggable dividers" color="blue">Resizable Panels</Tag>
                            <Tag tip="TextField, Select, MultiSelect, DatePicker, ColorPicker, Slider, FileUpload" color="blue">Form Controls</Tag>
                            <Tag tip="Modal dialogs, side sheets, popovers, tooltips (Radix-based)" color="blue">Dialogs & Sheets</Tag>
                            <Tag tip="Cards, Badges, Chips, Avatars, Skeletons, Tabs" color="blue">Data Display</Tag>
                            <Tag tip="Markdown renderer with syntax highlighting" color="blue">Markdown</Tag>
                            <Tag tip="Container, Separator, Collapse, ExpandablePanel" color="blue">Layout</Tag>
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
