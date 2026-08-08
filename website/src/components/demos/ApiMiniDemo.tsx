import React, { useState, useEffect } from "react";

export function ApiMiniDemo() {
    const [step, setStep] = useState(0);

    useEffect(() => {
        let isMounted = true;
        const loop = async () => {
            while (isMounted) {
                setStep(0);
                await new Promise(r => setTimeout(r, 1000));
                if (!isMounted) return;
                setStep(1); // pulse request
                await new Promise(r => setTimeout(r, 400));
                if (!isMounted) return;
                setStep(2); // show json
                await new Promise(r => setTimeout(r, 2000));
            }
        };
        loop();
        return () => { isMounted = false; };
    }, []);

    return (
        <div className="h-full w-full bg-surface-950 flex pointer-events-none select-none overflow-hidden relative">
            {/* Left panel — endpoints list */}
            <div className="w-[45%] border-r border-surface-800/60 bg-[#161618] flex flex-col">
                {/* Endpoints header */}
                <div className="px-3 py-2 border-b border-surface-800/40 text-[8px] font-semibold text-surface-500 uppercase tracking-wider">
                    Endpoints
                </div>
                {/* Active endpoint */}
                <div className="px-3 py-2 bg-primary/5 border-l-2 border-primary flex items-center gap-1.5">
                    <span className="text-[8px] font-semibold text-green-400 bg-green-400/10 px-1 py-0.5 rounded">GET</span>
                    <span className="text-[9px] font-mono text-surface-300">/api/data/users</span>
                </div>
                {/* Other endpoints */}
                <div className="px-3 py-2 flex items-center gap-1.5">
                    <span className="text-[8px] font-semibold text-blue-400 bg-blue-400/10 px-1 py-0.5 rounded">POST</span>
                    <span className="text-[9px] font-mono text-surface-500">/api/data/users</span>
                </div>
                <div className="px-3 py-2 flex items-center gap-1.5">
                    <span className="text-[8px] font-semibold text-green-400 bg-green-400/10 px-1 py-0.5 rounded">GET</span>
                    <span className="text-[9px] font-mono text-surface-500">/api/data/posts</span>
                </div>
                <div className="px-3 py-2 flex items-center gap-1.5">
                    <span className="text-[8px] font-semibold text-amber-400 bg-amber-400/10 px-1 py-0.5 rounded">PUT</span>
                    <span className="text-[9px] font-mono text-surface-500">/api/data/posts/:id</span>
                </div>
                <div className="px-3 py-2 flex items-center gap-1.5">
                    <span className="text-[8px] font-semibold text-red-400 bg-red-400/10 px-1 py-0.5 rounded">DEL</span>
                    <span className="text-[9px] font-mono text-surface-500">/api/data/posts/:id</span>
                </div>
                {/* Animated request line */}
                <div className="mt-auto px-3 py-2 border-t border-surface-800/40">
                    <div className={`h-[1px] w-full bg-gradient-to-r from-green-500/0 via-green-500 to-green-500/0 transform origin-left transition-transform duration-300 ${step >= 1 ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"}`}/>
                    <div className="text-[8px] text-surface-500 mt-1">{step >= 1 ? "200 OK · 12ms" : "Ready"}</div>
                </div>
            </div>

            {/* Right panel — response */}
            <div className="flex-1 bg-[#101012] font-mono text-[9px] relative overflow-hidden flex flex-col">
                <div className="px-3 py-2 border-b border-surface-800/40 text-[8px] font-semibold text-surface-500 uppercase tracking-wider flex items-center gap-2">
                    Response
                    {step >= 2 && <span className="text-green-400 text-[7px] font-normal normal-case">200 OK</span>}
                </div>
                <div className="p-3 flex-1 overflow-hidden">
                    {step === 0 && <div className="text-surface-500 italic text-[8px]">Send a request...</div>}
                    {step === 1 && (
                        <div className="absolute inset-0 bg-green-500/5 animate-pulse"></div>
                    )}
                    {step >= 2 && (
                        <div className="text-surface-300 leading-relaxed animate-[fade-in_0.2s_ease-out]">
                            <span className="text-surface-500">[</span><br/>
                            &nbsp;&nbsp;<span className="text-surface-500">{"{"}</span><br/>
                            &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;id&quot;</span>: <span className="text-orange-300">1</span>,<br/>
                            &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;name&quot;</span>: <span className="text-green-300">&quot;Alice&quot;</span>,<br/>
                            &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;role&quot;</span>: <span className="text-green-300">&quot;admin&quot;</span><br/>
                            &nbsp;&nbsp;<span className="text-surface-500">{"}"}</span>,<br/>
                            &nbsp;&nbsp;<span className="text-surface-500">{"{"}</span><br/>
                            &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;id&quot;</span>: <span className="text-orange-300">2</span>,<br/>
                            &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;name&quot;</span>: <span className="text-green-300">&quot;Bob&quot;</span>,<br/>
                            &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-300">&quot;role&quot;</span>: <span className="text-green-300">&quot;editor&quot;</span><br/>
                            &nbsp;&nbsp;<span className="text-surface-500">{"}"}</span><br/>
                            <span className="text-surface-500">]</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
