import React, { useEffect, useState } from "react";

export function EditorPreviewDemo() {
    const [step, setStep] = useState(0);
    const [typingText, setTypingText] = useState("");

    useEffect(() => {
        let isMounted = true;
        const loop = async () => {
            while (isMounted) {
                setStep(0);
                setTypingText("");
                await new Promise(r => setTimeout(r, 1000));
                if (!isMounted) return;

                // Start typing
                setStep(1);
                const textToType = "## Welcome to the new Rebase editor\n\nIt supports **Markdown** out of the box!";
                for (let i = 1; i <= textToType.length; i++) {
                    if (!isMounted) return;
                    setTypingText(textToType.slice(0, i));
                    await new Promise(r => setTimeout(r, 40));
                }
                
                await new Promise(r => setTimeout(r, 500));
                if (!isMounted) return;

                // Select text and format
                setStep(2);
                await new Promise(r => setTimeout(r, 1500));
                if (!isMounted) return;

                // Toggle bold
                setStep(3);
                await new Promise(r => setTimeout(r, 3000));
            }
        };
        loop();
        return () => { isMounted = false; };
    }, []);

    // Split typingText for preview rendering
    const renderPreview = () => {
        const lines = typingText.split('\n');
        return lines.map((line, idx) => {
            if (line.startsWith('## ')) {
                return <h2 key={idx} className="text-2xl font-bold text-white mt-4 mb-2">{line.replace('## ', '')}</h2>;
            } else if (line.trim() === '') {
                return <br key={idx} />;
            } else {
                // simple markdown bold parsing for preview
                const parts = line.split('**');
                return (
                    <p key={idx} className="text-surface-300 text-sm leading-relaxed">
                        {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part)}
                    </p>
                );
            }
        });
    };

    return (
        <div className="w-full h-full min-h-[400px] bg-surface-950 flex font-sans select-none pointer-events-none border border-surface-800/60 rounded-2xl overflow-hidden">
            {/* Editor Side */}
            <div className="flex-1 flex flex-col border-r border-surface-800/60 relative">
                {/* Editor Header */}
                <div className="h-12 border-b border-surface-800/60 bg-surface-900/40 flex items-center px-4 gap-3 shrink-0">
                    <svg className="w-4 h-4 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7"/></svg>
                    <span className="text-xs font-semibold text-surface-300 uppercase tracking-wider">Markdown Editor</span>
                    
                    {/* Formatting Toolbar - pops up when text is selected */}
                    <div className={`absolute top-14 left-1/2 -translate-x-1/2 bg-surface-800 border border-surface-700 shadow-xl rounded-lg px-2 py-1 flex items-center gap-1 transition-all duration-300 ${step >= 2 ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'}`}>
                        <div className={`w-7 h-7 rounded flex items-center justify-center text-sm font-bold ${step === 3 ? 'bg-primary/20 text-primary' : 'text-surface-300'}`}>B</div>
                        <div className="w-7 h-7 rounded flex items-center justify-center text-sm italic text-surface-300">I</div>
                        <div className="w-7 h-7 rounded flex items-center justify-center text-sm line-through text-surface-300">S</div>
                        <div className="w-px h-4 bg-surface-700 mx-1"></div>
                        <div className="w-7 h-7 rounded flex items-center justify-center text-surface-300">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
                        </div>
                    </div>
                </div>

                {/* Editor Content */}
                <div className="flex-1 p-6 text-sm text-surface-300 font-mono leading-loose relative overflow-hidden">
                    {step === 0 && (
                        <div className="flex">
                            <div className="w-[2px] h-5 bg-primary animate-pulse"></div>
                        </div>
                    )}
                    {step >= 1 && (
                        <div className="whitespace-pre-wrap">
                            {step >= 2 ? (
                                <>
                                    ## Welcome to the new Rebase editor<br/><br/>
                                    It supports <span className="bg-primary/30 text-primary-light selection:bg-primary/30 px-0.5 rounded">**Markdown**</span> out of the box!
                                </>
                            ) : (
                                <>
                                    {typingText}
                                    <span className="inline-block w-[2px] h-4 bg-primary animate-pulse ml-[1px] align-middle"></span>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Preview Side */}
            <div className="flex-1 flex flex-col bg-[#0A0A0A] relative hidden sm:flex">
                <div className="h-12 border-b border-surface-800/60 bg-surface-900/20 flex items-center px-4 gap-3 shrink-0">
                    <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    <span className="text-xs font-semibold text-primary uppercase tracking-wider">Live Preview</span>
                </div>
                <div className="flex-1 p-8 overflow-hidden font-sans">
                    {renderPreview()}
                </div>
            </div>
        </div>
    );
}
