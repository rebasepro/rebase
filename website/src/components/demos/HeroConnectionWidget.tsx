import React, { useState, useEffect } from "react";
import { Database, Sparkles, Check, ArrowRight, TableProperties, Shield, Code, Terminal } from "lucide-react";

export default function HeroConnectionWidget() {
    const [state, setState] = useState<"input" | "connecting" | "success" | "morphed">("input");
    const [progress, setProgress] = useState(0);
    const [dbString, setDbString] = useState("postgres://admin:••••••••@db.yourhost.com:5432/production");

    useEffect(() => {
        if (state !== "connecting") return;

        let interval = setInterval(() => {
            setProgress((prev) => {
                if (prev >= 100) {
                    clearInterval(interval);
                    setState("success");
                    return 100;
                }
                return prev + 8;
            });
        }, 100);

        return () => clearInterval(interval);
    }, [state]);

    useEffect(() => {
        if (state === "success") {
            const timer = setTimeout(() => {
                setState("morphed");
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [state]);

    const handleConnect = (e: React.FormEvent) => {
        e.preventDefault();
        if (state === "input") {
            setState("connecting");
            setProgress(0);
        }
    };

    const handleReset = () => {
        setState("input");
        setProgress(0);
    };

    return (
        <div className="w-full max-w-xl mx-auto not-content">
            {/* Widget Container */}
            <div className="relative rounded-2xl border border-surface-700/80 bg-surface-900/60 shadow-[0_0_50px_rgba(0,112,244,0.15)] overflow-hidden transition-all duration-500 backdrop-blur-sm min-h-[350px] flex flex-col justify-between">
                
                {/* Window header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800 bg-surface-950/50">
                    <div className="flex items-center gap-1.5">
                    </div>
                    <div className="text-[11px] font-mono text-surface-500 flex items-center gap-1.5">
                        <Terminal size={12} className="text-surface-500" />
                        rebase-introspect
                    </div>
                    <div className="w-10"></div>
                </div>

                {/* Body */}
                <div className="flex-1 p-6 flex flex-col justify-center">
                    
                    {/* STATE 1: Database Input */}
                    {state === "input" && (
                        <form onSubmit={handleConnect} className="space-y-6 animate-fade-in">
                            <div className="text-center space-y-2">
                                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
                                    <Database size={24} />
                                </div>
                                <h3 className="text-white font-semibold text-base">Connect to Your Postgres Database</h3>
                                <p className="text-xs text-surface-400 max-w-sm mx-auto">
                                    Point Rebase at your connection string. Everything runs on your infrastructure.
                                </p>
                            </div>

                            <div className="space-y-3">
                                <div className="relative rounded-lg bg-surface-950 border border-surface-800 p-3 flex items-center gap-3">
                                    <span className="text-[10px] font-mono text-surface-500 uppercase tracking-wider select-none">DATABASE_URL</span>
                                    <input
                                        type="text"
                                        value={dbString}
                                        onChange={(e) => setDbString(e.target.value)}
                                        className="bg-transparent border-0 outline-0 p-0 text-white font-mono text-xs flex-1 min-w-0 focus:ring-0 focus:outline-none"
                                        placeholder="postgres://user:password@host:port/db"
                                    />
                                </div>

                                <button
                                    type="submit"
                                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark transition-all duration-200 cursor-pointer"
                                >
                                    Connect Database
                                    <ArrowRight size={16} />
                                </button>
                            </div>
                        </form>
                    )}

                    {/* STATE 2: Introspecting / Connecting */}
                    {state === "connecting" && (
                        <div className="space-y-6 text-center animate-fade-in">
                            <div className="relative inline-flex items-center justify-center">
                                <div className="h-16 w-16 rounded-full border-2 border-surface-800 flex items-center justify-center">
                                    <Database size={24} className="text-primary animate-pulse" />
                                </div>
                                <svg className="absolute top-0 left-0 w-16 h-16 transform -rotate-90">
                                    <circle
                                        cx="32"
                                        cy="32"
                                        r="30"
                                        className="stroke-primary fill-none"
                                        strokeWidth="2"
                                        strokeDasharray={188}
                                        strokeDashoffset={188 - (188 * progress) / 100}
                                        strokeLinecap="round"
                                        style={{ transition: "stroke-dashoffset 0.1s ease-out" }}
                                    />
                                </svg>
                            </div>

                            <div className="space-y-2 font-mono">
                                <div className="text-xs text-white">Introspecting schema...</div>
                                <div className="text-[10px] text-surface-500">
                                    {progress < 30 && "→ Connecting to socket..."}
                                    {progress >= 30 && progress < 60 && "→ Reading system catalogs & constraints..."}
                                    {progress >= 60 && progress < 90 && "→ Inffering relations & custom enums..."}
                                    {progress >= 90 && "→ Generating TypeScript AST code..."}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STATE 3: Success state */}
                    {state === "success" && (
                        <div className="space-y-4 text-center animate-fade-in">
                            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-950/40 border border-emerald-500/40 text-emerald-400">
                                <Check size={28} className="animate-bounce" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="text-white font-semibold text-sm">Schema Introspected!</h4>
                                <p className="text-xs text-emerald-400 font-mono">
                                    ✔ Generated 8 collections & types in 0.8s
                                </p>
                            </div>
                        </div>
                    )}

                    {/* STATE 4: Morphed Spreadsheet Admin Layout */}
                    {state === "morphed" && (
                        <div className="space-y-4 animate-fade-in w-full text-left">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-white font-sans">Products</span>
                                    <span className="text-[10px] bg-primary/20 text-primary-light border border-primary/30 px-1.5 py-0.5 rounded font-mono">8 rows</span>
                                </div>
                                <button
                                    onClick={handleReset}
                                    className="text-[10px] text-surface-500 hover:text-white transition-colors underline cursor-pointer"
                                >
                                    Reset Demo
                                </button>
                            </div>

                            {/* Spreadsheet Table layout */}
                            <div className="rounded-lg border border-surface-800 bg-surface-950 overflow-hidden text-xs">
                                {/* Header */}
                                <div className="grid grid-cols-4 bg-surface-900 border-b border-surface-800 px-3 py-2 text-surface-400 font-medium font-mono text-[9px] uppercase tracking-wider">
                                    <div>ID</div>
                                    <div>Name</div>
                                    <div>Category</div>
                                    <div className="text-right">Price</div>
                                </div>
                                {/* Rows */}
                                <div className="divide-y divide-surface-900">
                                    <div className="grid grid-cols-4 px-3 py-2.5 items-center hover:bg-surface-900/30">
                                        <div className="font-mono text-surface-500 text-[10px]">p19X</div>
                                        <div className="text-white font-medium truncate">Wireless Mic</div>
                                        <div><span className="bg-blue-950 text-blue-300 rounded px-1.5 py-0.5 text-[9px] font-medium border border-blue-900/40">Audio</span></div>
                                        <div className="text-right text-surface-300 font-mono">$89.00</div>
                                    </div>
                                    <div className="grid grid-cols-4 px-3 py-2.5 items-center hover:bg-surface-900/30">
                                        <div className="font-mono text-surface-500 text-[10px]">h38Y</div>
                                        <div className="text-white font-medium truncate">Studio Lights</div>
                                        <div><span className="bg-pink-950 text-pink-300 rounded px-1.5 py-0.5 text-[9px] font-medium border border-pink-900/40">Video</span></div>
                                        <div className="text-right text-surface-300 font-mono">$150.00</div>
                                    </div>
                                    <div className="grid grid-cols-4 px-3 py-2.5 items-center hover:bg-surface-900/30">
                                        <div className="font-mono text-surface-500 text-[10px]">k12Z</div>
                                        <div className="text-white font-medium truncate">4K Camera</div>
                                        <div><span className="bg-pink-950 text-pink-300 rounded px-1.5 py-0.5 text-[9px] font-medium border border-pink-900/40">Video</span></div>
                                        <div className="text-right text-surface-300 font-mono">$899.00</div>
                                    </div>
                                </div>
                            </div>

                            {/* Dynamic generated list badges */}
                            <div className="flex items-center gap-1.5 flex-wrap pt-2 justify-center">
                                <span className="flex items-center gap-1 text-[10px] text-surface-400 bg-surface-950 border border-surface-800 px-2 py-1 rounded-full">
                                    <TableProperties size={12} className="text-primary-light" />
                                    The panel
                                </span>
                                <span className="flex items-center gap-1 text-[10px] text-surface-400 bg-surface-950 border border-surface-800 px-2 py-1 rounded-full">
                                    <Code size={12} className="text-primary-light" />
                                    Typed SDK
                                </span>
                                <span className="flex items-center gap-1 text-[10px] text-surface-400 bg-surface-950 border border-surface-800 px-2 py-1 rounded-full">
                                    <Shield size={12} className="text-primary-light" />
                                    RLS Rules
                                </span>
                                <span className="flex items-center gap-1 text-[10px] text-surface-400 bg-surface-950 border border-surface-800 px-2 py-1 rounded-full">
                                    <Sparkles size={12} className="text-primary-light" />
                                    MCP Tools
                                </span>
                            </div>
                        </div>
                    )}

                </div>

                {/* Footer status bar */}
                <div className="px-4 py-2 border-t border-surface-800/40 bg-surface-950/20 text-[10px] text-surface-500 font-mono flex items-center justify-between">
                    <div>Status: Connected</div>
                    <div>v3.1.2</div>
                </div>

            </div>
            
            {/* Custom fade in animation stylesheet */}
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes widgetFadeIn {
                    from { opacity: 0; transform: translateY(4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in {
                    animation: widgetFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
            `}} />
        </div>
    );
}
