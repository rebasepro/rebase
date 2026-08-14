import React, { useState, useMemo } from "react";

const HOTSPOT_ZONES: Record<string, any[]> = {
    head_neck: [{ top: 4, left: 42, width: 16, height: 15, view: "front" }],
    shoulders: [
        { top: 19, left: 36, width: 10, height: 6, view: "front" },
        { top: 19, left: 54, width: 10, height: 6, view: "front" }
    ],
    chest: [{ top: 23, left: 37, width: 26, height: 10, view: "front" }],
    biceps: [
        { top: 26, left: 33, width: 6, height: 10, view: "front" },
        { top: 26, left: 61, width: 6, height: 10, view: "front" }
    ],
    triceps: [
        { top: 26, left: 33, width: 7, height: 10, view: "back" },
        { top: 26, left: 60, width: 7, height: 10, view: "back" }
    ],
    forearms: [
        { top: 37, left: 29, width: 8, height: 13, view: "front" },
        { top: 37, left: 63, width: 8, height: 13, view: "front" }
    ],
    abs: [{ top: 33, left: 43, width: 14, height: 12, view: "front" }],
    obliques: [
        { top: 33, left: 36, width: 8, height: 10, view: "front" },
        { top: 33, left: 56, width: 8, height: 10, view: "front" }
    ],
    upper_back: [{ top: 20, left: 38, width: 24, height: 14, view: "back" }],
    lower_back: [{ top: 34, left: 40, width: 20, height: 10, view: "back" }],
    hip_flexors: [{ top: 44, left: 40, width: 20, height: 7, view: "front" }],
    glutes: [{ top: 44, left: 40, width: 20, height: 10, view: "back" }],
    quads: [
        { top: 51, left: 39, width: 10, height: 16, view: "front" },
        { top: 51, left: 51, width: 10, height: 16, view: "front" }
    ],
    hamstrings: [
        { top: 54, left: 40, width: 10, height: 12, view: "back" },
        { top: 54, left: 50, width: 10, height: 12, view: "back" }
    ],
    calves: [
        { top: 68, left: 40, width: 8, height: 16, view: "front" },
        { top: 68, left: 52, width: 8, height: 16, view: "front" }
    ]
};

const ENUM_ENTRIES = [
    { id: "head_neck", label: "Head & Neck" },
    { id: "shoulders", label: "Shoulders" },
    { id: "chest", label: "Chest" },
    { id: "biceps", label: "Biceps" },
    { id: "triceps", label: "Triceps" },
    { id: "forearms", label: "Forearms" },
    { id: "abs", label: "Abs" },
    { id: "obliques", label: "Obliques" },
    { id: "upper_back", label: "Upper Back" },
    { id: "lower_back", label: "Lower Back" },
    { id: "hip_flexors", label: "Hip Flexors" },
    { id: "glutes", label: "Glutes" },
    { id: "quads", label: "Quads" },
    { id: "hamstrings", label: "Hamstrings" },
    { id: "calves", label: "Calves" }
];

export function BodyPartsDemo() {
    const [selected, setSelected] = useState<string[]>(["chest", "triceps", "abs"]);
    const [hoveredPart, setHoveredPart] = useState<string | null>(null);

    const toggle = (partId: string) => {
        setSelected((prev) =>
            prev.includes(partId)
                ? prev.filter((s) => s !== partId)
                : [...prev, partId]
        );
    };

    const labelMap = useMemo(() => {
        const m = new Map<string, string>();
        ENUM_ENTRIES.forEach((e) => m.set(e.id, e.label));
        return m;
    }, []);

    const renderBodyView = (view: "front" | "back", imgSrc: string) => (
        <div className="relative w-full max-w-[130px]">
            {/* `client:visible` defers hydration but not rendering, so this markup
                is in the initial HTML and was fetching two thirds of the way down
                the landing page while the render-blocking CSS was still in flight. */}
            <img
                src={imgSrc}
                width={1024}
                height={1024}
                alt={`Body ${view} view`}
                draggable={false}
                loading="lazy"
                decoding="async"
                className="w-full h-auto block select-none opacity-50 dark:invert dark:brightness-125"
            />

            {ENUM_ENTRIES.map((entry) => {
                const zones = HOTSPOT_ZONES[entry.id];
                if (!zones) return null;

                return zones
                    .filter((z) => z.view === view)
                    .map((zone, i) => {
                        const isActive = selected.includes(entry.id);
                        const isHovered = hoveredPart === entry.id;

                        let outlineClass = "outline-transparent";
                        let bgClass = "";
                        if (isActive) {
                            bgClass = "bg-primary/30";
                            outlineClass = "outline-primary/70";
                        } else if (isHovered) {
                            bgClass = "bg-primary/15";
                            outlineClass = "outline-primary/30";
                        }

                        return (
                            <div
                                key={`${entry.id}-${view}-${i}`}
                                onClick={() => toggle(entry.id)}
                                onMouseEnter={() => setHoveredPart(entry.id)}
                                onMouseLeave={() => setHoveredPart(null)}
                                title={entry.label}
                                className={`absolute rounded-md transition-all duration-150 outline outline-2 cursor-pointer ${bgClass} ${outlineClass}`}
                                style={{
                                    top: `${zone.top}%`,
                                    left: `${zone.left}%`,
                                    width: `${zone.width}%`,
                                    height: `${zone.height}%`,
                                    zIndex: 2
                                }}
                            />
                        );
                    });
            })}
        </div>
    );

    return (
        <div className="w-full h-full bg-surface-950 flex p-3 sm:p-4 font-sans select-none overflow-hidden no-scrollbar">
            <div className="flex flex-row gap-2 sm:gap-4 items-center justify-center w-full h-full max-w-full">
                {/* Diagrams */}
                <div className="rounded-xl border border-surface-800 bg-surface-900 p-2 flex-shrink-0">
                    <div className="flex gap-2">
                        <div className="flex flex-col items-center">
                            {renderBodyView("front", "/img/body_front.webp")}
                            <span className="mt-1 text-[9px] sm:text-[10px] uppercase tracking-wider text-surface-500">
                                Front
                            </span>
                        </div>
                        <div className="flex flex-col items-center">
                            {renderBodyView("back", "/img/body_back.webp")}
                            <span className="mt-1 text-[9px] sm:text-[10px] uppercase tracking-wider text-surface-500">
                                Back
                            </span>
                        </div>
                    </div>

                    <div className="h-4 sm:h-5 mt-1 flex items-center justify-center">
                        {hoveredPart && (
                            <span className="text-[10px] sm:text-[11px] font-semibold text-primary text-center">
                                {labelMap.get(hoveredPart) ?? hoveredPart}
                                {selected.includes(hoveredPart) ? " ✓" : ""}
                            </span>
                        )}
                    </div>
                </div>

                {/* Right panel: quick select grid */}
                <div className="flex-1 min-w-[180px] max-w-[240px] h-full py-1">
                    <div className="grid grid-cols-2 gap-1 h-full overflow-visible">
                        {ENUM_ENTRIES.map((entry) => {
                            const isActive = selected.includes(entry.id);
                            const isHovered = hoveredPart === entry.id;
                            
                            let btnClasses = "outline-transparent text-surface-400 hover:text-surface-200";
                            let dotClasses = "bg-surface-700";
                            
                            if (isActive) {
                                btnClasses = "outline-primary/50 bg-primary/10 text-primary font-semibold";
                                dotClasses = "bg-primary";
                            } else if (isHovered) {
                                btnClasses = "outline-primary/30 bg-primary/5 text-surface-300";
                            }

                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => toggle(entry.id)}
                                    onMouseEnter={() => setHoveredPart(entry.id)}
                                    onMouseLeave={() => setHoveredPart(null)}
                                    className={`flex items-center gap-1.5 px-2 py-1 text-[10px] sm:text-[11px] rounded-lg transition-all duration-150 text-left outline outline-1 cursor-pointer flex-shrink-0 ${btnClasses}`}
                                >
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-150 ${dotClasses}`} />
                                    <span className="truncate">{entry.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
