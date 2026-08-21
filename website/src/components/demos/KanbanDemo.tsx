import React, { useEffect, useState } from "react";

export function KanbanDemo() {
    const [draggedCard, setDraggedCard] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState({ x: 0,
y: 0 });

    useEffect(() => {
        let isMounted = true;
        let timer: any;

        const loop = async () => {
            while (isMounted) {
                // Wait 2 seconds
                await new Promise(r => { timer = setTimeout(r, 2000); });
                if (!isMounted) return;

                // Pick up a card
                setDraggedCard("card-2");
                setDragOffset({ x: 0,
y: 0 });

                // Animate dragging
                const steps = 40;
                for (let i = 0; i <= steps; i++) {
                    const progress = i / steps;
                    const x = progress * 120; // Move right 120px
                    const y = Math.sin(progress * Math.PI) * -10; // Slight arc up

                    setDragOffset({ x,
y });

                    await new Promise(r => { timer = setTimeout(r, 16); }); // 60fps
                    if (!isMounted) return;
                }

                // Drop card
                await new Promise(r => { timer = setTimeout(r, 200); });
                if (!isMounted) return;
                setDraggedCard(null);

                // Wait 3 seconds
                await new Promise(r => { timer = setTimeout(r, 3000); });
            }
        };

        loop();

        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, []);

    return (
        <div className="w-full h-full bg-surface-950 overflow-hidden pointer-events-none select-none relative font-sans p-3">
            <div className="flex gap-3 h-full pointer-events-none">
                {/* Column 1: In Progress */}
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 px-1 py-0.5">
                        <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                        <span className="text-[10px] font-semibold text-surface-400 uppercase tracking-widest">In Progress</span>
                        <span className="ml-auto text-[10px] text-surface-600">2</span>
                    </div>
                    <div className="flex flex-col gap-2 relative">
                        <div className="bg-surface-900 rounded-xl p-3 border border-surface-700/60 shadow-md">
                            <div className="text-xs text-white font-medium mb-1 line-clamp-2">Homepage redesign mockup</div>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[9px] text-surface-500 font-mono">ui-32</span>
                                <div className="w-4 h-4 rounded-full bg-purple-500 text-[8px] flex items-center justify-center text-white font-semibold tracking-tighter">FK</div>
                            </div>
                        </div>

                        {draggedCard === "card-2" && (
                            <div className="h-[76px] rounded-lg border-2 border-dashed border-surface-700/50 bg-surface-800/10"/>
                        )}

                        <div
                            className={`bg-surface-900 rounded-xl p-3 border border-surface-700/60 shadow-md ${draggedCard === "card-2" ? "absolute z-10 w-full" : "relative"}`}
                            style={draggedCard === "card-2" ? {
                                transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(3deg)`,
                                transition: "none",
                                top: "84px",
                                boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5)",
                                borderColor: "rgba(255,255,255,0.1)"
                            } : {
                                transition: "transform 0.0s"
                            }}
                        >
                            <div className="text-xs text-white font-medium mb-1 line-clamp-2">Authentication flow API</div>
                            <div className="flex justify-between items-center mt-2">
                                <div className="flex gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                                </div>
                                <div className="w-4 h-4 rounded-full bg-emerald-500 text-[8px] flex items-center justify-center text-white font-semibold tracking-tighter">AJ</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Column 2: Review */}
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 px-1 py-0.5">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-[10px] font-semibold text-surface-400 uppercase tracking-widest">Review</span>
                        <span className="ml-auto text-[10px] text-surface-600">2</span>
                    </div>
                    <div className="flex flex-col gap-2 relative">
                        <div className="bg-surface-900 rounded-xl p-3 border border-surface-700/60 shadow-md">
                            <div className="text-xs text-white font-medium mb-1 line-clamp-2">Update privacy policy</div>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[9px] text-surface-500 font-mono">legal-4</span>
                            </div>
                        </div>
                        <div className="bg-surface-900 rounded-xl p-3 border border-surface-700/60 shadow-md">
                            <div className="text-xs text-white font-medium mb-1 line-clamp-2">Payment gateway tests</div>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[9px] text-surface-500 font-mono">pay-17</span>
                                <div className="w-4 h-4 rounded-full bg-sky-500 text-[8px] flex items-center justify-center text-white font-semibold tracking-tighter">MR</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Column 3: Done */}
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 px-1 py-0.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        <span className="text-[10px] font-semibold text-surface-400 uppercase tracking-widest">Done</span>
                        <span className="ml-auto text-[10px] text-surface-600">3</span>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="bg-surface-900 rounded-xl p-3 border border-surface-700/60 shadow-sm">
                            <div className="text-xs text-surface-400 font-medium mb-1 line-clamp-2">Database migration v2</div>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[9px] text-surface-600 font-mono">db-08</span>
                                <div className="w-4 h-4 rounded-full bg-orange-500 text-[8px] flex items-center justify-center text-white font-semibold tracking-tighter">LS</div>
                            </div>
                        </div>
                        <div className="bg-surface-900 rounded-xl p-3 border border-surface-700/60 shadow-sm">
                            <div className="text-xs text-surface-400 font-medium mb-1 line-clamp-2">Role permissions audit</div>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[9px] text-surface-600 font-mono">sec-11</span>
                                <div className="w-4 h-4 rounded-full bg-purple-500 text-[8px] flex items-center justify-center text-white font-semibold tracking-tighter">FK</div>
                            </div>
                        </div>
                        <div className="bg-surface-900 rounded-xl p-3 border border-surface-700/60 shadow-sm">
                            <div className="text-xs text-surface-400 font-medium mb-1 line-clamp-2">Email template setup</div>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[9px] text-surface-600 font-mono">msg-03</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
