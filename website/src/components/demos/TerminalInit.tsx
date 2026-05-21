import React, { useState } from "react";

export function TerminalInit() {
    const [copied, setCopied] = useState(false);
    const command = "pnpm dlx @rebasepro/cli init";

    const handleCopy = () => {
        navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="w-full max-w-lg mx-auto rounded-xl border border-surface-800 bg-[#0c0d10] shadow-2xl overflow-hidden font-mono text-xs select-none">
            {/* Terminal Top bar */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#14151a] border-b border-surface-800/80">
                <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
                </div>
                <span className="text-[10px] text-surface-500 font-semibold tracking-wide">zsh</span>
                <div className="w-6"></div>
            </div>

            {/* Terminal Body */}
            <div className="p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-surface-300">
                    <span className="text-primary font-bold select-none">&gt;</span>
                    <span className="text-white font-medium select-all">{command}</span>
                    <span className="w-1.5 h-4 bg-primary animate-pulse inline-block align-middle select-none"></span>
                </div>
                <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-md border text-[10px] font-bold tracking-wide uppercase transition-all duration-300 cursor-pointer ${
                        copied
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 ring-1 ring-emerald-500/20"
                            : "bg-surface-900 text-surface-400 border-surface-800 hover:text-white hover:border-surface-700 active:scale-95"
                    }`}
                >
                    {copied ? (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            Copied!
                        </>
                    ) : (
                        <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                            Copy
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
