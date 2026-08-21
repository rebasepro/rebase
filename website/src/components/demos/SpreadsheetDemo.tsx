import React, { useEffect, useState } from "react";

export function SpreadsheetDemo() {
    const [step, setStep] = useState(0);
    const [typingText, setTypingText] = useState("");

    // Simulate clicking a cell, typing "Premium Plan", and saving
    useEffect(() => {
        let isMounted = true;
        const loop = async () => {
            while (isMounted) {
                setStep(0);
                setTypingText("");
                await new Promise(r => setTimeout(r, 1500));
                if (!isMounted) return;

                // Select cell
                setStep(1);
                await new Promise(r => setTimeout(r, 800));
                if (!isMounted) return;

                // Start typing
                setStep(2);
                const textToType = "Premium Plan";
                for (let i = 1; i <= textToType.length; i++) {
                    if (!isMounted) return;
                    setTypingText(textToType.slice(0, i));
                    await new Promise(r => setTimeout(r, 100));
                }
                
                await new Promise(r => setTimeout(r, 600));
                if (!isMounted) return;

                // Save cell
                setStep(3);
                await new Promise(r => setTimeout(r, 3000));
            }
        };
        loop();
        return () => { isMounted = false; };
    }, []);

    const users = [
        { id: 1, name: "Alice Johnson", email: "alice@example.com", status: "Active", plan: "Basic Plan" },
        { id: 2, name: "Bob Smith", email: "bob@example.com", status: "Inactive", plan: "Pro Plan" },
        { id: 3, name: "Charlie Davis", email: "charlie@example.com", status: "Active", plan: step >= 3 ? "Premium Plan" : "Pro Plan" },
        { id: 4, name: "Diana Prince", email: "diana@example.com", status: "Active", plan: "Enterprise" },
        { id: 5, name: "Evan Wright", email: "evan@example.com", status: "Pending", plan: "Basic Plan" },
    ];

    return (
        <div className="w-full h-full min-h-[400px] bg-surface-950 text-surface-200 flex flex-col font-sans select-none pointer-events-none relative border border-surface-800/60 rounded-2xl overflow-hidden">
            {/* Toolbar */}
            <div className="h-12 border-b border-surface-800/60 bg-surface-900/40 flex items-center px-4 gap-4 shrink-0">
                <div className="flex gap-2">
                    <div className="h-2 w-2 rounded-full bg-surface-700"></div>
                    <div className="h-2 w-2 rounded-full bg-surface-700"></div>
                    <div className="h-2 w-2 rounded-full bg-surface-700"></div>
                </div>
                <div className="h-4 w-px bg-surface-700/50"></div>
                <div className="flex gap-4 text-surface-500 text-sm">
                    <div className="flex items-center gap-1.5 hover:text-surface-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
                        Filter
                    </div>
                    <div className="flex items-center gap-1.5 hover:text-surface-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"/></svg>
                        Sort
                    </div>
                </div>
                <div className="flex-1"></div>
                <div className="text-surface-500 hover:text-surface-300">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-hidden bg-surface-950 flex flex-col">
                <div className="grid grid-cols-[48px_minmax(150px,1fr)_minmax(200px,2fr)_120px_150px] border-b border-surface-800 text-xs font-semibold text-surface-400 bg-surface-900/20">
                    <div className="p-3 border-r border-surface-800 flex items-center justify-center">
                        <div className="w-3.5 h-3.5 rounded-sm border border-surface-600"></div>
                    </div>
                    <div className="p-3 border-r border-surface-800 flex items-center gap-2">Name</div>
                    <div className="p-3 border-r border-surface-800 flex items-center gap-2">Email</div>
                    <div className="p-3 border-r border-surface-800 flex items-center gap-2">Status</div>
                    <div className="p-3 flex items-center gap-2">Plan</div>
                </div>

                <div className="flex flex-col">
                    {users.map((user, idx) => {
                        const isTargetRow = idx === 2;
                        return (
                            <div key={user.id} className="grid grid-cols-[48px_minmax(150px,1fr)_minmax(200px,2fr)_120px_150px] border-b border-surface-800/50 text-sm text-surface-300 hover:bg-surface-900/30 transition-colors">
                                <div className="p-3 border-r border-surface-800/50 flex items-center justify-center">
                                    <span className="text-xs text-surface-600">{user.id}</span>
                                </div>
                                <div className="p-3 border-r border-surface-800/50 flex items-center truncate">
                                    {user.name}
                                </div>
                                <div className="p-3 border-r border-surface-800/50 flex items-center text-surface-400 truncate">
                                    {user.email}
                                </div>
                                <div className="p-3 border-r border-surface-800/50 flex items-center">
                                    {/* Chip: the product's rounded-lg fill, from CHIP_COLORS (dark).
                                        These were tinted `-500/10` pills with a border, which is a
                                        different shape and a different palette from an enum chip. */}
                                    <span className={`chip ${
                                        user.status === 'Active' ? 'chip-green' :
                                        user.status === 'Inactive' ? 'chip-gray' :
                                        'chip-yellow'
                                    }`}>
                                        {user.status}
                                    </span>
                                </div>
                                <div className="p-0 flex items-center relative">
                                    {isTargetRow ? (
                                        <div className={`w-full h-full px-3 flex items-center ${step >= 1 && step < 3 ? 'ring-2 ring-inset ring-primary bg-primary/5' : ''}`}>
                                            {step === 2 ? (
                                                <div className="flex items-center w-full">
                                                    <span>{typingText}</span>
                                                    <div className="w-[1px] h-4 bg-primary animate-pulse ml-[1px]"></div>
                                                </div>
                                            ) : (
                                                <span>{user.plan}</span>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="px-3">
                                            {user.plan}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            
            {/* Save indicator */}
            <div className={`absolute bottom-4 right-4 bg-surface-800 border border-surface-700 text-white text-xs px-3 py-1.5 rounded-md shadow-lg flex items-center gap-2 transition-all duration-300 ${step === 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                Saved to database
            </div>
        </div>
    );
}
