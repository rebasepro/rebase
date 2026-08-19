import React, { useState } from "react";

/**
 * "The backend an agent can't screw up" is the page's headline, so the page
 * should let you try to screw it up.
 *
 * Revoke a permission on the left and the same four MCP tool calls re-evaluate
 * on the right. Each call is checked twice — once against the key's permission
 * list, once by Postgres — and the figure shows both gates rather than asserting
 * them, because "enforced twice" is the only claim here that a competitor
 * cannot also make.
 *
 * Tool names are the real ones exported by @rebasepro/mcp. The permission shape
 * is ApiKeyPermission from @rebasepro/types: a collection, and any of
 * read/write/delete — plus a separate `admin` flag that grants the admin role.
 */

type Op = "read" | "write" | "delete";

interface Grant {
    collection: string;
    op: Op;
    /** Whether the reader currently grants it. */
    on: boolean;
}

interface Call {
    tool: string;
    args: string;
    /** Gate one. null = needs the admin flag rather than a collection grant. */
    needs: { collection: string; op: Op } | null;
    /**
     * Gate two, and genuinely independent of gate one: whether a policy on that
     * table names the `service` role for that operation. Granting the key a
     * permission does not create a policy, which is the whole point — turn on
     * orders:delete and the call still comes back having deleted nothing.
     */
    rlsAllows: boolean;
    /** What comes back when both gates pass. */
    ok: string;
    /** Why Postgres refuses, when it does. */
    rlsNote: string;
    /**
     * The wire answer when gate one passes and Postgres does not. Only the
     * delete row can reach that state here. Postgres does not raise for a
     * policy-filtered DELETE — it reports zero rows, exactly like a delete that
     * had nothing to do — so the driver re-reads the target on the same handle:
     * still visible means refused (403 WRITE_DENIED), gone means 404.
     */
    blocked?: string;
    /**
     * The `error.code` in the 403 body. Collection routes raise
     * API_KEY_FORBIDDEN from the permission guard; the admin surfaces
     * (`/admin/users`, which is what list_users calls) raise FORBIDDEN from
     * requireAdmin.
     */
    deniedCode: string;
}

const CALLS: Call[] = [
    {
        tool: "list_documents",
        args: `{ "collection": "products", "limit": 20 }`,
        needs: { collection: "products", op: "read" },
        rlsAllows: true,
        ok: `20 rows · id, title, price, stock`,
        rlsNote: `products has a select policy naming "service"`,
        deniedCode: "API_KEY_FORBIDDEN"
    },
    {
        tool: "update_document",
        args: `{ "collection": "orders", "id": "8f21", "data": { "status": "refunded" } }`,
        needs: { collection: "orders", op: "write" },
        rlsAllows: true,
        ok: `1 row updated · orders/8f21`,
        rlsNote: `orders grants update to "service"`,
        deniedCode: "API_KEY_FORBIDDEN"
    },
    {
        tool: "delete_document",
        args: `{ "collection": "orders", "id": "8f21" }`,
        needs: { collection: "orders", op: "delete" },
        rlsAllows: false,
        ok: `1 row deleted · orders/8f21`,
        rlsNote: `no delete policy on orders names "service", so 0 rows match`,
        blocked: `403  WRITE_DENIED · orders/8f21 is still there`,
        deniedCode: "API_KEY_FORBIDDEN"
    },
    {
        tool: "list_users",
        args: `{}`,
        needs: null,
        rlsAllows: false,
        ok: `142 users · id, email, roles`,
        rlsNote: `the users table is covered by default_admin, which the service role is not`,
        deniedCode: "FORBIDDEN"
    }
];

const INITIAL: Grant[] = [
    { collection: "products", op: "read", on: true },
    { collection: "orders", op: "read", on: true },
    { collection: "orders", op: "write", on: true },
    { collection: "orders", op: "delete", on: false }
];

export function McpSessionDemo() {
    const [grants, setGrants] = useState<Grant[]>(INITIAL);
    const [admin, setAdmin] = useState(false);

    const toggle = (i: number) =>
        setGrants((prev) => prev.map((g, j) => (j === i ? { ...g, on: !g.on } : g)));

    /** Gate one: the key's own permission list. */
    const keyAllows = (call: Call) =>
        call.needs === null
            ? admin
            : grants.some((g) => g.collection === call.needs!.collection && g.op === call.needs!.op && g.on);

    /** Gate two: what Postgres will return for the role this key carries. */
    const rlsAllows = (call: Call) => admin || call.rlsAllows;

    const denied = CALLS.filter((c) => !(keyAllows(c) && rlsAllows(c))).length;

    return (
        <div className="frame overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr]">

                {/* ── The key ───────────────────────────────────────── */}
                <div className="border-b border-surface-800/60 p-5 sm:p-6 lg:border-b-0 lg:border-r">
                    <div className="mb-1 flex items-center gap-2">
                        <Icon name="key"/>
                        <span className="font-mono text-sm text-surface-200">support-agent</span>
                    </div>
                    <p className="mb-5 text-[11px] text-surface-500">
                        The key you hand the agent. Revoke something and watch the session below.
                    </p>

                    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-500">
                        permissions
                    </p>
                    <ul className="space-y-1.5">
                        {grants.map((g, i) => (
                            <li key={`${g.collection}.${g.op}`}>
                                <button
                                    type="button"
                                    onClick={() => toggle(i)}
                                    aria-pressed={g.on}
                                    className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left font-mono text-[12.5px] transition-all duration-200 ${
                                        g.on
                                            ? "bg-primary/[0.07] text-surface-200 ring-1 ring-inset ring-primary/25"
                                            : "text-surface-600 ring-1 ring-inset ring-surface-800 hover:text-surface-400"
                                    }`}>
                                    <span className={g.on ? "" : "line-through decoration-surface-700"}>
                                        {g.collection}<span className="text-surface-500">:</span>{g.op}
                                    </span>
                                    <Switch on={g.on}/>
                                </button>
                            </li>
                        ))}
                    </ul>

                    <p className="mb-2.5 mt-5 text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-500">
                        admin flag
                    </p>
                    <button
                        type="button"
                        onClick={() => setAdmin((a) => !a)}
                        aria-pressed={admin}
                        className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left font-mono text-[12.5px] transition-all duration-200 ${
                            admin
                                ? "bg-amber-500/[0.08] text-amber-200 ring-1 ring-inset ring-amber-500/30"
                                : "text-surface-600 ring-1 ring-inset ring-surface-800 hover:text-surface-400"
                        }`}>
                        <span>admin: {admin ? "true" : "false"}</span>
                        <Switch on={admin} tone="amber"/>
                    </button>
                    <p className="mt-2.5 text-[11px] leading-relaxed text-surface-500">
                        Without it the key carries the <span className="font-mono text-surface-400">service</span> role,
                        and Postgres grants that role nothing unless a policy names it.
                    </p>
                </div>

                {/* ── The session ───────────────────────────────────── */}
                <div className="p-5 sm:p-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-500">
                            MCP session
                        </span>
                        <span className={`rounded-md px-2 py-0.5 text-[11px] transition-colors duration-300 ${
                            denied === 0
                                ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20"
                                : "bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/25"
                        }`}>
                            {denied === 0 ? "4 of 4 allowed" : `${denied} of 4 refused`}
                        </span>
                    </div>

                    <div className="space-y-3">
                        {CALLS.map((call) => {
                            const gateKey = keyAllows(call);
                            const gateRls = rlsAllows(call);
                            const pass = gateKey && gateRls;
                            return (
                                <div key={call.tool}
                                     className={`rounded-xl border p-3.5 transition-colors duration-300 ${
                                         pass ? "border-white/5 bg-surface-950/40" : "border-rose-500/20 bg-rose-500/[0.04]"
                                     }`}>
                                    <div className="flex items-start gap-2">
                                        <span className="mt-[3px] flex-none text-surface-600">
                                            <Icon name="tool"/>
                                        </span>
                                        <div className="min-w-0 font-mono text-[12.5px] leading-relaxed">
                                            <span className="text-surface-100">{call.tool}</span>
                                            <span className="ml-2 break-all text-surface-500">{call.args}</span>
                                        </div>
                                    </div>

                                    {/* Two gates, evaluated separately — that is the claim */}
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Gate label="API key permission" pass={gateKey}/>
                                        <Gate label="Postgres RLS" pass={gateRls}/>
                                    </div>

                                    <p className={`mt-2.5 font-mono text-[11.5px] leading-relaxed ${
                                        pass ? "text-emerald-300/90" : "text-rose-300/90"
                                    }`}>
                                        {pass
                                            ? `200  ${call.ok}`
                                            : gateKey
                                                ? call.blocked ?? `200  0 rows affected`
                                                : `403  ${call.deniedCode}`}
                                    </p>

                                    {!pass && (
                                        <p className="mt-1.5 border-l-2 border-rose-500/25 pl-2.5 text-[11px] leading-relaxed text-surface-500">
                                            {gateKey
                                                /* The most useful state in the figure: permission granted,
                                                   database unmoved. Granting a key does not write a policy. */
                                                ? <>The key permits this. Postgres does not — {call.rlsNote}, so the row survives and the write is reported as refused.</>
                                                : gateRls
                                                    ? <>Postgres would have allowed it; the key is what stopped it.</>
                                                    : <>Refused twice: the key has no such permission, and {call.rlsNote}.</>}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <p className="mt-4 text-[11px] leading-relaxed text-surface-500">
                        The two gates are independent, which is the part worth sitting with: grant
                        <span className="font-mono text-surface-400"> orders:delete</span> above and the call still
                        deletes nothing, because a key permission is not a policy — and it comes back 403 rather
                        than reporting a delete that never happened. No prompt, jailbreak or bug in the tool layer
                        widens what the database will return.
                    </p>
                </div>
            </div>
        </div>
    );
}

function Gate({ label, pass }: { label: string; pass: boolean }) {
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors duration-300 ${
            pass
                ? "bg-emerald-500/[0.08] text-emerald-300/90 ring-1 ring-inset ring-emerald-500/20"
                : "bg-rose-500/[0.08] text-rose-300/90 ring-1 ring-inset ring-rose-500/25"
        }`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                {pass ? <path d="m5 12 5 5L20 7"/> : <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>}
            </svg>
            {label}
        </span>
    );
}

function Switch({ on, tone = "primary" }: { on: boolean; tone?: "primary" | "amber" }) {
    return (
        <span className={`relative inline-flex h-4 w-7 flex-none rounded-full transition-colors duration-300 ${
            on ? (tone === "amber" ? "bg-amber-500" : "bg-primary") : "bg-surface-700"
        }`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-300 ${
                on ? "left-3.5" : "left-0.5 opacity-60"
            }`}/>
        </span>
    );
}

function Icon({ name }: { name: "key" | "tool" }) {
    const paths: Record<string, React.ReactNode> = {
        key: <><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></>,
        tool: <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></>
    };
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-surface-500">
            {paths[name]}
        </svg>
    );
}

export default McpSessionDemo;
