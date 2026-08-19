import React, { useState, useEffect } from "react";

export function RichTextEditorDemo() {
    const [step, setStep] = useState(0);

    useEffect(() => {
        let isMounted = true;
        const loop = async () => {
            while (isMounted) {
                setStep(0);
                await new Promise(r => setTimeout(r, 1000));
                if (!isMounted) return;

                // Type "/im"
                setStep(1);
                await new Promise(r => setTimeout(r, 400));
                if (!isMounted) return;

                // Show slash command menu
                setStep(2);
                await new Promise(r => setTimeout(r, 800));
                if (!isMounted) return;

                // Insert image block
                setStep(3);
                await new Promise(r => setTimeout(r, 1500));
                if (!isMounted) return;

                // Type caption
                setStep(4);
                await new Promise(r => setTimeout(r, 3000));
            }
        };
        loop();
        return () => { isMounted = false; };
    }, []);

    return (
        <div className="w-full h-[600px] bg-[#0A0A0A] text-surface-200 flex flex-col font-sans select-none pointer-events-none relative">
            {/* Fake toolbar */}
            <div className="h-12 border-b border-surface-800/60 bg-surface-900/40 flex items-center px-4 gap-4 shrink-0">
                <div className="flex gap-2">
                </div>
                <div className="h-4 w-px bg-surface-700"></div>
                <div className="flex gap-3 text-surface-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7"/></svg>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
                    <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </div>
                <div className="flex-1"></div>
                <div className="h-6 w-16 bg-primary/20 text-primary text-[11px] font-semibold flex items-center justify-center rounded-md border border-primary/30">
                    Publish
                </div>
            </div>

            {/* Editor body */}
            <div className="flex-1 p-8 lg:p-12 overflow-hidden flex flex-col gap-6 max-w-3xl mx-auto w-full relative">
                <div className="text-4xl font-semibold text-white tracking-tight">Product Update: Q3 Features</div>
                
                <p className="text-lg text-surface-400 leading-relaxed">
                    We've been working hard on the latest features for the Rebase editing experience. Here's a quick look at what's new.
                </p>

                <div className="flex gap-2 items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-surface-600"></div>
                    <p className="text-lg text-surface-300">Notion-style rich text with blocks</p>
                </div>
                <div className="flex gap-2 items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-surface-600"></div>
                    <p className="text-lg text-surface-300">Drag and drop Kanban boards</p>
                </div>

                {/* Animated slash command block */}
                <div className="relative mt-2">
                    {step === 0 && (
                        <div className="flex items-center h-8">
                            <div className="w-[2px] h-6 bg-primary animate-pulse"></div>
                            <span className="text-surface-600 ml-2 text-lg">Type '/' for commands</span>
                        </div>
                    )}

                    {step === 1 && (
                        <div className="flex items-center h-8 text-lg text-surface-300">
                            /im<div className="w-[2px] h-6 bg-primary animate-pulse ml-[1px]"></div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="relative">
                            <div className="flex items-center h-8 text-lg text-surface-300">
                                /image<div className="w-[2px] h-6 bg-primary animate-pulse ml-[1px]"></div>
                            </div>
                            
                            {/* Slash Command Dropdown */}
                            <div className="absolute top-10 left-0 bg-surface-800 border border-surface-700 rounded-xl shadow-2xl p-1.5 w-64 z-10 animate-in fade-in slide-in-from-top-2 duration-200">
                                <div className="px-3 py-2 text-xs font-semibold text-surface-500 uppercase tracking-wider">Basic Blocks</div>
                                
                                <div className="bg-surface-700/50 rounded-lg flex items-center p-2 gap-3 mb-1">
                                    <div className="bg-surface-900 rounded-md p-1.5 border border-surface-600 shadow-sm">
                                        <svg className="w-4 h-4 text-surface-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-white">Image</span>
                                        <span className="text-[11px] text-surface-400">Upload or embed an image</span>
                                    </div>
                                </div>
                                
                                <div className="rounded-lg flex items-center p-2 gap-3 opacity-50">
                                    <div className="bg-surface-900 rounded-md p-1.5 border border-surface-700">
                                        <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-white">Video</span>
                                        <span className="text-[11px] text-surface-400">Embed a YouTube or Vimeo video</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {(step >= 3) && (
                        <div className="flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-300">
                            <div className="w-full h-48 bg-surface-900 rounded-xl border border-surface-700 flex flex-col items-center justify-center relative overflow-hidden group">
                                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center opacity-80 mix-blend-luminosity transition-all duration-700"></div>
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                                
                                {step === 3 && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-surface-900/80 backdrop-blur-sm transition-opacity duration-500 opacity-100">
                                        <div className="flex flex-col items-center">
                                            <svg className="w-8 h-8 text-primary mb-3 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                                            <span className="text-sm text-white font-medium">Uploading image...</span>
                                            <div className="w-32 h-1.5 bg-surface-800 rounded-full mt-3 overflow-hidden">
                                                <div className="h-full bg-primary animate-[shimmer_1s_infinite]"></div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            {step === 4 && (
                                <div className="text-center text-sm text-surface-500 italic flex items-center justify-center gap-1">
                                    New dark mode UI showcase
                                    <div className="w-[1.5px] h-4 bg-primary animate-pulse"></div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
