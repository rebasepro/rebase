import React, { useState, useEffect } from "react";
import {
    Search, KeyRound, Zap, Server, Radio, Clock, BookOpen, FileCheck2, FileText, ShieldCheck
} from "lucide-react";

/**
 * Ten agent capabilities folded into one window: a left rail of capabilities,
 * a mock product surface on the right. Same information, one screen, and it
 * looks like the product instead of a list.
 */

interface Capability {
    key: string;
    label: string;
    Icon: React.ComponentType<{ size?: number | string; className?: string }>;
    title: string;
    desc: string;
    pills: string[];
    screen: string;      // the fake filename / endpoint in the inner chrome bar
    body: React.ReactNode;
    guardrailLabel: string;
    guardrailDetail: string;
}

const line = (indent: number, ...parts: React.ReactNode[]) => (
    <div style={{ paddingLeft: indent * 12 }}>{parts.map((part, i) => <React.Fragment key={i}>{part}</React.Fragment>)}</div>
);

const CAPABILITIES: Capability[] = [
    {
        key: "surface",
        label: "A small surface",
        Icon: FileCheck2,
        title: "A surface an agent can hold",
        desc: "No controllers, no serializers, no migrations to hand-write, and nothing for a model to invent between the schema and the route. The whole contract fits in one context window, and the compiler checks whatever it writes back.",
        pills: ["no controllers to review", "fits in one context window", "compiler-checked"],
        screen: "config/collections/orders.ts",
        guardrailLabel: "Compiler + Schema Gate",
        guardrailDetail: "1 collection file → 0 custom controllers to hallucinate · TypeScript + SQL migration verified before apply",
        body: (
            <>
                {line(0, <span className="text-blue-400">export const</span>, <span className="text-surface-200"> orders</span>, <span className="text-surface-300">: </span>, <span className="text-cyan-300">PostgresCollectionConfig</span>, <span className="text-surface-300"> = {"{"}</span>)}
                {line(1, <span className="text-surface-300">table: </span>, <span className="text-emerald-300">"orders"</span>, <span className="text-surface-300">,</span>)}
                {line(1, <span className="text-surface-300">properties: {"{"} total, status, customer {"}"},</span>)}
                {line(1, <span className="text-surface-300">securityRules: [{"{"} operation: </span>, <span className="text-emerald-300">"select"</span>, <span className="text-surface-300">, … {"}"}],</span>)}
                {line(0, <span className="text-surface-300">{"}"};</span>)}
                <div className="mt-3 border-t border-hairline pt-3">
                    {line(0, <span className="text-surface-500">→ REST · typed SDK · RLS policies · admin views</span>)}
                </div>
            </>
        )
    },
    {
        key: "review",
        label: "Human review gates",
        Icon: ShieldCheck,
        title: "Agents draft. Humans approve.",
        desc: "Encode review boundaries directly in the collection and its Postgres policies. An agent holding a scoped key can draft rows or stage updates, while only an operator in the panel can move a record to approved or sent.",
        pills: ["schema-enforced states", "approval queues in Rebase CMS", "RLS write guards"],
        screen: "config/collections/outreach.ts",
        guardrailLabel: "Postgres WITH CHECK Gate",
        guardrailDetail: "Agent INSERT with status='approved' → rejected by Postgres RLS · Operator approval required in Rebase CMS",
        body: (
            <>
                {line(0, <span className="text-surface-300">status: {"{"} type: </span>, <span className="text-emerald-300">"string"</span>, <span className="text-surface-300">, enumValues: [</span>, <span className="text-emerald-300">"draft"</span>, <span className="text-surface-300">, </span>, <span className="text-emerald-300">"approved"</span>, <span className="text-surface-300">] {"}"},</span>)}
                {line(0, <span className="text-surface-300">securityRules: [</span>)}
                {line(1, <span className="text-surface-300">{"{"} role: </span>, <span className="text-amber-300">"agent"</span>, <span className="text-surface-300">, operation: </span>, <span className="text-emerald-300">"insert"</span>, <span className="text-surface-300">, check: </span>, <span className="text-cyan-300">status = 'draft'</span>, <span className="text-surface-300"> {"}"},</span>)}
                {line(1, <span className="text-surface-300">{"{"} role: </span>, <span className="text-primary">"operator"</span>, <span className="text-surface-300">, operation: </span>, <span className="text-emerald-300">"update"</span>, <span className="text-surface-300"> {"}"}</span>)}
                {line(0, <span className="text-surface-300">]</span>)}
                <div className="mt-3 border-t border-hairline pt-3">
                    {line(0, <span className="text-emerald-400">✔ </span>, <span className="text-surface-400">agent drafts in Postgres · operator approves in the panel</span>)}
                </div>
            </>
        )
    },
    {
        key: "keys",
        label: "Service API keys",
        Icon: KeyRound,
        title: "Scoped service API keys",
        desc: "Issue a key with per-collection, per-operation permissions. Rate limited, expiring, revocable — and still subject to row-level security underneath.",
        pills: ["SHA-256 hashed", "per-key rate limits", "soft revocation"],
        screen: "api-keys",
        guardrailLabel: "No Bypass-RLS Master Key",
        guardrailDetail: "Every key binds SET LOCAL role & rebase.uid() inside the Postgres transaction · Revoke in 1 click from the panel",
        body: (
            <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-surface-500 pb-1.5 border-b border-hairline">
                    <span>key</span><span>scope</span><span>rate</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-3">
                    <span className="text-surface-300">rk_live_a91…</span>
                    <span className="text-primary">docs:read</span>
                    <span className="text-surface-500">1000/15m</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-3">
                    <span className="text-surface-300">rk_live_7c2…</span>
                    <span className="text-primary">orders:rw</span>
                    <span className="text-surface-500">5000/15m</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 opacity-50">
                    <span className="text-surface-400 line-through">rk_live_44f…</span>
                    <span className="text-surface-500">revoked</span>
                    <span className="text-surface-600">—</span>
                </div>
            </div>
        )
    },
    {
        key: "context",
        label: "Scaffolded context",
        Icon: FileText,
        title: "Agent context & guardrails, scaffolded",
        desc: "Every new project ships with AGENTS.md and CLAUDE.md already written: the layout, the commands, the conventions, and the verification checks. Your agent is productive on the first prompt and checked before it finishes.",
        pills: ["AGENTS.md", "CLAUDE.md", "rls-check", "rebase init"],
        screen: "my-app/",
        guardrailLabel: "Zero-Prompt Onboarding",
        guardrailDetail: "AGENTS.md & CLAUDE.md pre-loaded with collection conventions, relation rules, and @rebasepro/rls-check verification",
        body: (
            <>
                {line(0, <span className="text-primary">~ </span>, <span className="text-surface-200">pnpm dlx @rebasepro/cli init my-app</span>)}
                <div className="mt-2.5 space-y-1">
                    {line(0, <span className="text-surface-400">my-app/</span>)}
                    {line(1, <span className="text-emerald-300">AGENTS.md</span>, <span className="text-surface-600"> — layout, commands, conventions</span>)}
                    {line(1, <span className="text-emerald-300">CLAUDE.md</span>, <span className="text-surface-600"> — same, for Claude Code</span>)}
                    {line(1, <span className="text-surface-400">config/collections/</span>)}
                    {line(1, <span className="text-surface-400">backend/  frontend/</span>)}
                </div>
            </>
        )
    },
    {
        key: "skills",
        label: "Agent skills",
        Icon: BookOpen,
        title: "Official agent skills",
        desc: "Twenty maintained skills — collections, access rules, auth, realtime, storage, the SDK — written into your agent's own rules directory. It reads how Rebase works instead of guessing.",
        pills: ["Claude Code", "Cursor", "Windsurf", "Gemini CLI"],
        screen: "~/my-app",
        guardrailLabel: "20 Versioned Skills",
        guardrailDetail: "Installed into .claude/skills/ and .cursor/rules/ so coding agents author valid defineCollection() & RLS rules on the first try",
        body: (
            <>
                {line(0, <span className="text-primary">~ </span>, <span className="text-surface-200">rebase skills</span>)}
                {line(0, <span className="text-surface-500">detected .claude/ — installing to .claude/skills/</span>)}
                <div className="mt-2 space-y-1">
                    {line(0, <span className="text-emerald-400">✔ </span>, <span className="text-surface-400">rebase-collections, rebase-security, rebase-auth</span>)}
                    {line(0, <span className="text-emerald-400">✔ </span>, <span className="text-surface-400">rebase-realtime, rebase-sdk, rebase-storage …</span>)}
                    {line(0, <span className="text-surface-300">20 skills installed</span>)}
                </div>
            </>
        )
    },
    {
        key: "mcp",
        label: "MCP server",
        Icon: Server,
        title: "MCP server",
        desc: "Expose the whole project to Claude Code, Cursor or Windsurf over the Model Context Protocol. Agents read the schema, query data and run migrations as tools.",
        pills: ["data tools", "schema tools", "user & role tools"],
        screen: "rebase-mcp",
        guardrailLabel: "Scoped MCP Execution",
        guardrailDetail: "Every MCP tool call executes under the caller's scoped API key and Postgres RLS policies — never a superuser connection",
        body: (
            <>
                {line(0, <span className="text-surface-500">→ initialize</span>)}
                {line(0, <span className="text-emerald-400">← 40 tools registered</span>)}
                <div className="mt-2.5 space-y-1">
                    {line(1, <span className="text-primary">list_documents</span>, <span className="text-surface-500"> — read any collection under RLS</span>)}
                    {line(1, <span className="text-primary">rebase_schema_introspect</span>, <span className="text-surface-500"> — tables, relations, enums</span>)}
                    {line(1, <span className="text-primary">rebase_db_migrate</span>, <span className="text-surface-500"> — apply pending migrations</span>)}
                </div>
            </>
        )
    },
    {
        key: "functions",
        label: "Custom functions",
        Icon: Zap,
        title: "Custom functions & streaming",
        desc: "Drop a route file in functions/ and it mounts itself. Full typed access to your data layer — stream an LLM response, chain agent actions, take a webhook.",
        pills: ["auto-mounted", "typed data access", "streaming"],
        screen: "functions/summarize.ts",
        guardrailLabel: "Authenticated Driver Context",
        guardrailDetail: "Custom functions inherit the request's authenticated Postgres session & RLS policies automatically",
        body: (
            <>
                {line(0, <span className="text-blue-400">export default</span>, <span className="text-surface-300"> </span>, <span className="text-amber-300">async</span>, <span className="text-surface-300"> (req, res) ={">"} {"{"}</span>)}
                {line(1, <span className="text-surface-500">// full typed access to the driver</span>)}
                {line(1, <span className="text-blue-400">const</span>, <span className="text-surface-300"> docs = </span>, <span className="text-blue-400">await</span>, <span className="text-amber-300"> data</span>, <span className="text-surface-300">.docs.find();</span>)}
                {line(1, <span className="text-blue-400">return</span>, <span className="text-surface-300"> stream(summarize(docs));</span>)}
                {line(0, <span className="text-surface-300">{"}"}</span>)}
            </>
        )
    },
    {
        key: "cron",
        label: "Cron & jobs",
        Icon: Clock,
        title: "Cron jobs & background tasks",
        desc: "Schedule recurring agent work with a cron expression and a typed handler. Sync an external API, process an embedding batch, run an LLM pipeline nightly.",
        pills: ["cron expressions", "typed handlers", "execution logs"],
        screen: "cron",
        guardrailLabel: "Audited Background Runs",
        guardrailDetail: "Scheduled jobs run with explicit role bindings and structured execution logs visible in Rebase Studio",
        body: (
            <div className="space-y-1.5">
                <div className="grid grid-cols-[auto_1fr_auto] gap-4 text-surface-500 pb-1.5 border-b border-hairline">
                    <span>schedule</span><span>job</span><span>last run</span>
                </div>
                <div className="grid grid-cols-[auto_1fr_auto] gap-4">
                    <span className="text-amber-300">0 3 * * *</span>
                    <span className="text-surface-300">reindex-embeddings</span>
                    <span className="text-emerald-400">ok · 2m</span>
                </div>
                <div className="grid grid-cols-[auto_1fr_auto] gap-4">
                    <span className="text-amber-300">*/15 * * * *</span>
                    <span className="text-surface-300">sync-crm</span>
                    <span className="text-emerald-400">ok · 4s</span>
                </div>
            </div>
        )
    },
    {
        key: "realtime",
        label: "Realtime engine",
        Icon: Radio,
        title: "Realtime engine",
        desc: "One WebSocket for live data subscriptions, broadcast channels and presence. Agents and humans see the same row change at the same moment.",
        pills: ["data subscriptions", "broadcast", "presence", "auto-reconnect"],
        screen: "ws://localhost:3000/realtime",
        guardrailLabel: "Row-Filtered Subscriptions",
        guardrailDetail: "LISTEN/NOTIFY events are filtered through the subscriber's Postgres SELECT policy before delivery over WebSocket",
        body: (
            <>
                {line(0, <span className="text-emerald-400">● connected</span>, <span className="text-surface-500"> · subscribed to orders</span>)}
                <div className="mt-2.5 space-y-1">
                    {line(0, <span className="text-surface-500">12:04:11 </span>, <span className="text-amber-300">UPDATE</span>, <span className="text-surface-300"> orders/ORD-2026-0042 → shipped</span>)}
                    {line(0, <span className="text-surface-500">12:04:11 </span>, <span className="text-primary">presence</span>, <span className="text-surface-300"> agent-7 joined</span>)}
                    {line(0, <span className="text-surface-500">12:04:13 </span>, <span className="text-emerald-400">INSERT</span>, <span className="text-surface-300"> orders/ORD-2026-0043</span>)}
                </div>
            </>
        )
    },
    {
        key: "vector",
        label: "Vector search",
        Icon: Search,
        title: "Vector similarity search",
        desc: "Native pgvector with cosine, L2 and inner-product distance. Query embeddings straight over REST — no separate vector database to run.",
        pills: ["pgvector", "cosine · L2 · inner product", "no extra service"],
        screen: "GET /api/data/docs",
        guardrailLabel: "Permission-Aware RAG",
        guardrailDetail: "Vector similarity queries run inside the same Postgres SELECT policy — an agent never retrieves embeddings for rows it cannot read",
        body: (
            <>
                {line(0, <span className="text-emerald-400">GET </span>, <span className="text-surface-300">/api/data/docs</span>)}
                {line(1, <span className="text-surface-500">?vector_search=</span>, <span className="text-amber-300">embedding</span>)}
                {line(1, <span className="text-surface-500">&vector=</span>, <span className="text-primary">[0.12, 0.98, …]</span>)}
                {line(1, <span className="text-surface-500">&vector_distance=</span>, <span className="text-cyan-300">cosine</span>)}
                <div className="mt-3 border-t border-hairline pt-3">
                    {line(0, <span className="text-surface-500">200 OK · 14ms</span>)}
                    {line(0, <span className="text-surface-400">[{"{"} "id": "d_91", "score": 0.94 {"}"}, …]</span>)}
                </div>
            </>
        )
    }
];

export function AgentConsoleDemo() {
    const [activeKey, setActiveKey] = useState(CAPABILITIES[0].key);
    const [paused, setPaused] = useState(false);
    const active = CAPABILITIES.find((c) => c.key === activeKey) ?? CAPABILITIES[0];

    useEffect(() => {
        if (paused) return;
        if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }
        const timer = window.setInterval(() => {
            setActiveKey((prev) => {
                const idx = CAPABILITIES.findIndex((c) => c.key === prev);
                const next = (idx + 1) % CAPABILITIES.length;
                return CAPABILITIES[next].key;
            });
        }, 4200);
        return () => window.clearInterval(timer);
    }, [paused]);

    return (
        <div
            className="frame overflow-hidden"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >

            {/* window chrome */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline bg-surface-well/70">
                <span className="font-mono text-[11px] text-surface-500">
                    agent · what it can reach
                </span>
                <span className="font-mono text-[10px] text-emerald-400/90 flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    RLS enforced on all 10 surfaces
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[248px_1fr]">

                {/* left rail */}
                <nav className="p-2 lg:border-r border-hairline flex lg:block gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {CAPABILITIES.map((cap) => {
                        const on = cap.key === activeKey;
                        return (
                            <button
                                key={cap.key}
                                type="button"
                                onClick={() => {
                                    setPaused(true);
                                    setActiveKey(cap.key);
                                }}
                                aria-pressed={on}
                                className={`flex-none lg:w-full flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-200 ${
                                    on
                                        ? "bg-surface-active text-white"
                                        : "text-surface-400 hover:text-surface-200 hover:bg-white/[0.03]"
                                }`}>
                                <cap.Icon size={15} className={on ? "text-primary" : "text-surface-500"}/>
                                <span className="whitespace-nowrap">{cap.label}</span>
                            </button>
                        );
                    })}
                </nav>

                {/* Detail pane */}
                <div className="p-6 sm:p-7 min-w-0 lg:h-[560px] lg:overflow-y-auto flex flex-col">
                    <h3 className="text-lg font-semibold text-white">{active.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-surface-400 max-w-2xl">{active.desc}</p>

                    {/* the mock surface */}
                    <div className="mt-5 rounded-xl border border-hairline bg-surface-well/85 overflow-hidden">
                        <div className="px-3.5 py-2.5 border-b border-hairline bg-surface-sheet flex items-center justify-between">
                            <span className="font-mono text-[10px] text-surface-400">{active.screen}</span>
                            <span className="font-mono text-[9.5px] text-emerald-400/80">postgres · rls active</span>
                        </div>
                        <div className="p-4 sm:p-5 font-mono text-[11.5px] leading-relaxed overflow-x-auto">
                            {active.body}
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                        {active.pills.map((p) => (
                            <span key={p}
                                  className="px-2.5 py-1 rounded-lg bg-surface-raised text-[11px] text-surface-300 ring-1 ring-inset ring-surface-700/50">
                                {p}
                            </span>
                        ))}
                    </div>

                    {/* Live Guardrail & Execution Trace footer — anchors the bottom of the 560px pane */}
                    <div className="mt-auto pt-4">
                        <div className="rounded-xl border border-emerald-500/20 bg-surface-well/60 px-4 py-3.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                                    <ShieldCheck size={13} />
                                    {active.guardrailLabel}
                                </span>
                                <span className="font-mono text-[10px] text-surface-500">enforced by construction</span>
                            </div>
                            <p className="mt-1.5 text-xs leading-relaxed text-surface-300">
                                {active.guardrailDetail}
                            </p>
                            <div className="mt-2.5 pt-2 border-t border-hairline flex items-center justify-between font-mono text-[10px] text-surface-400">
                                <span>tx · SET LOCAL role = &apos;rebase_authenticated&apos;</span>
                                <span className="text-emerald-400">✓ verified</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AgentConsoleDemo;
