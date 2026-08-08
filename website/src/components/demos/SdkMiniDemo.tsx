import React, { useState, useEffect } from "react";

export function SdkMiniDemo() {
    const [step, setStep] = useState(0);

    useEffect(() => {
        let isMounted = true;
        const loop = async () => {
            while (isMounted) {
                setStep(0);
                await new Promise(r => setTimeout(r, 800));
                if (!isMounted) return;
                setStep(1); // type client.data.
                await new Promise(r => setTimeout(r, 600));
                if (!isMounted) return;
                setStep(2); // autocomplete for collection names
                await new Promise(r => setTimeout(r, 1400));
                if (!isMounted) return;
                setStep(3); // pick "posts", type .
                await new Promise(r => setTimeout(r, 600));
                if (!isMounted) return;
                setStep(4); // autocomplete for methods
                await new Promise(r => setTimeout(r, 1400));
                if (!isMounted) return;
                setStep(5); // pick "where", type args
                await new Promise(r => setTimeout(r, 800));
                if (!isMounted) return;
                setStep(6); // chain .orderBy + .find
                await new Promise(r => setTimeout(r, 800));
                if (!isMounted) return;
                setStep(7); // show return type tooltip
                await new Promise(r => setTimeout(r, 2500));
            }
        };
        loop();
        return () => { isMounted = false; };
    }, []);

    const cursor = <span className="w-0.5 h-3 bg-[#d4d4d4] animate-pulse ml-px inline-block align-middle"></span>;

    // Line numbers for the gutter
    const lineCount = step >= 6 ? 12 : step >= 5 ? 8 : step >= 3 ? 6 : step >= 1 ? 4 : 3;

    return (
        <div className="h-full w-full bg-[#1e1e1e] flex flex-col pointer-events-none select-none overflow-hidden relative font-mono text-[11px]">
            {/* Editor content with line numbers */}
            <div className="flex flex-1 overflow-hidden">
                {/* Line number gutter */}
                <div className="w-8 flex-shrink-0 bg-[#1e1e1e] border-r border-[#2d2d2d] pt-3 text-right pr-2 select-none">
                    {Array.from({ length: lineCount }, (_, i) => (
                        <div key={i} className="text-[10px] text-[#858585] leading-[1.4]">{i + 1}</div>
                    ))}
                </div>

                {/* Code area */}
                <div className="p-3 relative flex-1 overflow-hidden">
                    {/* Import line (always visible) */}
                    <div className="text-[#858585] mb-2 leading-[1.4]">
                        <span className="text-[#c586c0]">import</span> {"{"} <span className="text-[#9cdcfe]">createRebaseClient</span> {"}"} <span className="text-[#c586c0]">from</span> <span className="text-[#ce9178]">&apos;@rebasepro/client&apos;</span>;
                    </div>
                    <div className="text-[#858585] mb-3 leading-[1.4]">&nbsp;</div>

                    {/* Line 1: const data = await client.data. */}
                    <div className="text-[#d4d4d4] flex flex-wrap leading-[1.4]">
                        <span className="text-[#569cd6]">const</span>&nbsp;data&nbsp;=&nbsp;<span className="text-[#c586c0]">await</span>&nbsp;<span className="text-[#9cdcfe]">client</span>.<span className="text-[#9cdcfe]">data</span>.
                        {step === 0 && cursor}
                    </div>

                    {/* Line 2: posts (after autocomplete) */}
                    {step >= 1 && (
                        <div className="text-[#d4d4d4] ml-6 mt-0.5 relative leading-[1.4]">
                            {step === 1 && <>{cursor}</>}
                            {step >= 2 && (
                                <span className="relative">
                                    {step >= 3 ? <span className="text-[#9cdcfe]">posts</span> : ""}
                                    {step === 2 && cursor}
                                    {step === 2 && (
                                        <div className="absolute top-4 left-0 bg-[#252526] border border-[#454545] shadow-xl rounded-sm w-28 z-10 py-0.5">
                                            <div className="flex items-center px-1.5 py-0.5 bg-[#04395e] text-white">
                                                <span className="text-[#4fc1ff] mr-1 text-[8px]">⬡</span>
                                                posts
                                            </div>
                                            <div className="flex items-center px-1.5 py-0.5 text-[#cccccc]">
                                                <span className="text-[#4fc1ff] mr-1 text-[8px]">⬡</span>
                                                users
                                            </div>
                                            <div className="flex items-center px-1.5 py-0.5 text-[#cccccc]">
                                                <span className="text-[#4fc1ff] mr-1 text-[8px]">⬡</span>
                                                orders
                                            </div>
                                            <div className="flex items-center px-1.5 py-0.5 text-[#cccccc]">
                                                <span className="text-[#4fc1ff] mr-1 text-[8px]">⬡</span>
                                                categories
                                            </div>
                                        </div>
                                    )}
                                </span>
                            )}
                            {step === 3 && <>.</>}
                            {step === 3 && cursor}
                            {step >= 4 && (
                                <span className="relative">
                                    .{step >= 5 ? "where" : ""}
                                    {step === 4 && cursor}
                                    {step === 4 && (
                                        <div className="absolute top-4 left-0 bg-[#252526] border border-[#454545] shadow-xl rounded-sm w-32 z-10 py-0.5">
                                            <div className="flex items-center px-1.5 py-0.5 bg-[#04395e] text-white">
                                                <span className="text-[#dcdcaa] mr-1 text-[8px]">ƒ</span>
                                                where()
                                            </div>
                                            <div className="flex items-center px-1.5 py-0.5 text-[#cccccc]">
                                                <span className="text-[#dcdcaa] mr-1 text-[8px]">ƒ</span>
                                                orderBy()
                                            </div>
                                            <div className="flex items-center px-1.5 py-0.5 text-[#cccccc]">
                                                <span className="text-[#dcdcaa] mr-1 text-[8px]">ƒ</span>
                                                find()
                                            </div>
                                            <div className="flex items-center px-1.5 py-0.5 text-[#cccccc]">
                                                <span className="text-[#dcdcaa] mr-1 text-[8px]">ƒ</span>
                                                include()
                                            </div>
                                            <div className="flex items-center px-1.5 py-0.5 text-[#cccccc]">
                                                <span className="text-[#dcdcaa] mr-1 text-[8px]">ƒ</span>
                                                limit()
                                            </div>
                                        </div>
                                    )}
                                </span>
                            )}
                            {step >= 5 && (
                                <>(<span className="text-[#ce9178]">&apos;status&apos;</span>, <span className="text-[#ce9178]">&apos;eq&apos;</span>, <span className="text-[#ce9178]">&apos;active&apos;</span>)</>
                            )}
                            {step === 5 && cursor}
                        </div>
                    )}

                    {/* Line 3: .orderBy(...).find() */}
                    {step >= 6 && (
                        <div className="text-[#d4d4d4] ml-6 mt-0.5 leading-[1.4]">
                            .orderBy(<span className="text-[#ce9178]">&apos;createdAt&apos;</span>, <span className="text-[#ce9178]">&apos;desc&apos;</span>)
                            {step === 6 && cursor}
                        </div>
                    )}
                    {step >= 6 && (
                        <div className="text-[#d4d4d4] ml-6 mt-0.5 leading-[1.4]">
                            .limit(<span className="text-[#b5cea8]">25</span>)
                        </div>
                    )}
                    {step >= 6 && (
                        <div className="text-[#d4d4d4] ml-6 mt-0.5 leading-[1.4]">
                            .find();
                        </div>
                    )}

                    {/* Type annotation tooltip */}
                    {step >= 7 && (
                        <div className="mt-3 px-2 py-1.5 bg-[#252526] border border-[#454545] rounded-sm inline-block shadow-lg">
                            <div className="text-[9px] text-[#858585] mb-0.5">const data: FindResult&lt;Post&gt;</div>
                            <div className="text-[10px]"><span className="text-surface-500">{"{"}</span> <span className="text-[#9cdcfe]">data</span>: <span className="text-[#4ec9b0]">Entity&lt;Post&gt;</span>[], <span className="text-[#9cdcfe]">meta</span>: <span className="text-[#4ec9b0]">Meta</span> <span className="text-surface-500">{"}"}</span></div>
                        </div>
                    )}
                </div>
            </div>

            {/* Status bar */}
            <div className="h-5 bg-[#007acc] flex items-center px-2 gap-3 text-[9px] text-white/90 shrink-0">
                <span>TypeScript</span>
                <span className="ml-auto">UTF-8</span>
                <span>Ln {lineCount}, Col 1</span>
            </div>
        </div>
    );
}
