import React, { useState, useEffect } from "react";

interface EndpointSpec {
    method: "GET" | "POST" | "PUT" | "DEL";
    methodBadge: string;
    path: string;
    status: string;
    latency: string;
    rlsNote: string;
    body: React.ReactNode;
}

const ENDPOINTS: EndpointSpec[] = [
    {
        method: "GET",
        methodBadge: "text-green-400 bg-green-400/10",
        path: "/api/data/users?limit=2",
        status: "200 OK",
        latency: "8ms",
        rlsNote: "RLS · rebase.role() IN ('admin', 'editor')",
        body: (
            <>
                <span className="text-surface-500">[</span><br />
                &nbsp;&nbsp;<span className="text-surface-500">{"{"}</span><br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;id&quot;</span>: <span className="text-orange-300">1</span>,<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;name&quot;</span>: <span className="text-green-300">&quot;Alice Vance&quot;</span>,<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;role&quot;</span>: <span className="text-green-300">&quot;admin&quot;</span><br />
                &nbsp;&nbsp;<span className="text-surface-500">{"}"}</span>,<br />
                &nbsp;&nbsp;<span className="text-surface-500">{"{"}</span><br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;id&quot;</span>: <span className="text-orange-300">2</span>,<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;name&quot;</span>: <span className="text-green-300">&quot;Bob Chen&quot;</span>,<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;role&quot;</span>: <span className="text-green-300">&quot;editor&quot;</span><br />
                &nbsp;&nbsp;<span className="text-surface-500">{"}"}</span><br />
                <span className="text-surface-500">]</span>
            </>
        ),
    },
    {
        method: "POST",
        methodBadge: "text-blue-400 bg-blue-400/10",
        path: "/api/data/posts",
        status: "201 Created",
        latency: "11ms",
        rlsNote: "RLS · WITH CHECK (author = rebase.uid())",
        body: (
            <>
                <span className="text-surface-500">{"{"}</span><br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;id&quot;</span>: <span className="text-orange-300">42</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;title&quot;</span>: <span className="text-green-300">&quot;Postgres RLS for AI Agents&quot;</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;status&quot;</span>: <span className="text-green-300">&quot;draft&quot;</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;author&quot;</span>: <span className="text-orange-300">1</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;created_at&quot;</span>: <span className="text-green-300">&quot;2026-10-20T14:22:09Z&quot;</span><br />
                <span className="text-surface-500">{"}"}</span>
            </>
        ),
    },
    {
        method: "GET",
        methodBadge: "text-green-400 bg-green-400/10",
        path: "/api/data/posts?include=author",
        status: "200 OK",
        latency: "9ms",
        rlsNote: "RLS · USING (status = 'published')",
        body: (
            <>
                <span className="text-surface-500">[</span><br />
                &nbsp;&nbsp;<span className="text-surface-500">{"{"}</span><br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;id&quot;</span>: <span className="text-orange-300">41</span>,<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;title&quot;</span>: <span className="text-green-300">&quot;Why Middleware Fails&quot;</span>,<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;status&quot;</span>: <span className="text-green-300">&quot;published&quot;</span>,<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;author&quot;</span>: <span className="text-surface-500">{"{ "}</span><span className="text-blue-300">&quot;id&quot;</span>: <span className="text-orange-300">1</span>, <span className="text-blue-300">&quot;name&quot;</span>: <span className="text-green-300">&quot;Alice Vance&quot;</span><span className="text-surface-500">{" }"}</span><br />
                &nbsp;&nbsp;<span className="text-surface-500">{"}"}</span><br />
                <span className="text-surface-500">]</span>
            </>
        ),
    },
    {
        method: "PUT",
        methodBadge: "text-amber-400 bg-amber-400/10",
        path: "/api/data/posts/42",
        status: "200 OK",
        latency: "10ms",
        rlsNote: "RLS · USING (author = rebase.uid())",
        body: (
            <>
                <span className="text-surface-500">{"{"}</span><br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;id&quot;</span>: <span className="text-orange-300">42</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;status&quot;</span>: <span className="text-green-300">&quot;published&quot;</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;updated_at&quot;</span>: <span className="text-green-300">&quot;2026-10-20T14:23:01Z&quot;</span><br />
                <span className="text-surface-500">{"}"}</span>
            </>
        ),
    },
    {
        method: "DEL",
        methodBadge: "text-rose-400 bg-rose-400/10",
        path: "/api/data/posts/42",
        status: "403 Forbidden",
        latency: "4ms",
        rlsNote: "RLS · blocked (rebase.role() != 'admin')",
        body: (
            <>
                <span className="text-surface-500">{"{"}</span><br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;error&quot;</span>: <span className="text-rose-300">&quot;rls_policy_violation&quot;</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;table&quot;</span>: <span className="text-green-300">&quot;posts&quot;</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;operation&quot;</span>: <span className="text-green-300">&quot;DELETE&quot;</span>,<br />
                &nbsp;&nbsp;<span className="text-blue-300">&quot;policy&quot;</span>: <span className="text-green-300">&quot;posts_delete_admin_only&quot;</span><br />
                <span className="text-surface-500">{"}"}</span>
            </>
        ),
    },
];

export function ApiMiniDemo() {
    const [activeIdx, setActiveIdx] = useState(0);
    const [step, setStep] = useState(2);
    const [userSelected, setUserSelected] = useState(false);

    useEffect(() => {
        if (userSelected) return;
        let isMounted = true;
        const loop = async () => {
            let idx = 0;
            while (isMounted) {
                await new Promise(r => setTimeout(r, 2800));
                if (!isMounted) return;
                idx = (idx + 1) % ENDPOINTS.length;
                setActiveIdx(idx);
                setStep(1);
                await new Promise(r => setTimeout(r, 220));
                if (!isMounted) return;
                setStep(2);
            }
        };
        loop();
        return () => { isMounted = false; };
    }, [userSelected]);

    const handleSelect = (idx: number) => {
        setUserSelected(true);
        setActiveIdx(idx);
        setStep(1);
        window.setTimeout(() => setStep(2), 160);
    };

    const current = ENDPOINTS[activeIdx] ?? ENDPOINTS[0];

    return (
        <div className="h-full w-full bg-surface-frame flex select-none overflow-hidden relative">
            {/* Left panel — interactive endpoints list */}
            <div className="w-[46%] border-r border-hairline bg-[#161618] flex flex-col">
                <div className="px-3 py-1.5 border-b border-hairline text-[10px] font-semibold text-surface-500 uppercase tracking-wider flex items-center justify-between">
                    <span>Endpoints</span>
                    <span className="font-mono text-[9px] normal-case text-surface-400">click to send</span>
                </div>
                {ENDPOINTS.map((ep, idx) => {
                    const isOn = idx === activeIdx;
                    return (
                        <button
                            key={ep.path + ep.method}
                            type="button"
                            onClick={() => handleSelect(idx)}
                            className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 transition-colors cursor-pointer border-l-2 ${
                                isOn
                                    ? "bg-primary/10 border-primary"
                                    : "border-transparent hover:bg-white/[0.03]"
                            }`}
                        >
                            <span className={`text-[9px] font-semibold px-1 py-0.5 rounded shrink-0 ${ep.methodBadge}`}>
                                {ep.method}
                            </span>
                            <span className={`text-[10.5px] font-mono truncate ${isOn ? "text-white" : "text-surface-400"}`}>
                                {ep.path}
                            </span>
                        </button>
                    );
                })}
                {/* Request telemetry bar */}
                <div className="mt-auto px-3 py-1.5 border-t border-hairline bg-[#121214]">
                    <div className={`h-[1px] w-full bg-gradient-to-r ${current.status.startsWith("403") ? "from-rose-500/0 via-rose-500 to-rose-500/0" : "from-green-500/0 via-green-500 to-green-500/0"} transform origin-left transition-transform duration-200 ${step >= 1 ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"}`} />
                    <div className="flex items-center justify-between text-[10px] text-surface-400 mt-1 font-mono">
                        <span className={current.status.startsWith("403") ? "text-rose-400" : "text-emerald-400"}>{current.status}</span>
                        <span>{current.latency}</span>
                    </div>
                </div>
            </div>

            {/* Right panel — JSON response + RLS verification */}
            <div className="flex-1 bg-[#101012] font-mono text-[11px] relative overflow-hidden flex flex-col">
                <div className="px-3 py-1.5 border-b border-hairline text-[10px] font-semibold text-surface-500 uppercase tracking-wider flex items-center justify-between gap-2">
                    <span>Response</span>
                    <span className={`${current.status.startsWith("403") ? "text-rose-400" : "text-emerald-400"} text-[9px] font-mono font-normal normal-case truncate`}>
                        {current.rlsNote}
                    </span>
                </div>
                <div className="p-3 flex-1 overflow-hidden relative">
                    {step === 1 && (
                        <div className="absolute inset-0 bg-emerald-500/5 animate-pulse" />
                    )}
                    <div className={`text-surface-300 leading-relaxed transition-opacity duration-150 ${step === 1 ? "opacity-40" : "opacity-100"}`}>
                        {current.body}
                    </div>
                </div>
                <div className="px-3 py-1.5 border-t border-hairline bg-[#141417] flex items-center justify-between text-[9.5px] text-surface-400">
                    <span>OpenAPI 3.1 auto-generated</span>
                    <span className="text-surface-300">tx · SET LOCAL role</span>
                </div>
            </div>
        </div>
    );
}
